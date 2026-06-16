const express = require('express');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Config ──────────────────────────────────────────────────────────────────
const CAL_API_KEY = process.env.CAL_API_KEY;
const NICCO_EMAIL = process.env.NICCO_EMAIL || 'niccolo@lemonsintheroom.com';
const BASE_URL = process.env.BASE_URL || 'https://tracker-production-348b.up.railway.app';

const SMTP = {
  host: process.env.SMTP_HOST || 'smtps.aruba.it',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

const transporter = nodemailer.createTransport(SMTP);

// ── Storage ──────────────────────────────────────────────────────────────────
const EVENTS_FILE = path.join(__dirname, 'events.jsonl');
const BOOKINGS_FILE = path.join(__dirname, 'bookings.json');
const REMINDERS_FILE = path.join(__dirname, 'reminders.json');

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function logEvent(obj) {
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(obj) + '\n');
}

// ── Mailer ───────────────────────────────────────────────────────────────────
async function sendMail({ to, subject, html, replyTo }) {
  return transporter.sendMail({
    from: `"Niccolò - Lemons in the room" <${SMTP.auth.user}>`,
    to,
    subject,
    html,
    replyTo,
  });
}

// ── Cal.com helpers ───────────────────────────────────────────────────────────
async function calAccept(bookingUid) {
  return axios.patch(
    `https://api.cal.com/v2/bookings/${bookingUid}/confirm`,
    {},
    {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        'cal-api-version': '2024-06-14',
        'Content-Type': 'application/json',
      },
    }
  );
}

async function calDecline(bookingUid, reason) {
  return axios.patch(
    `https://api.cal.com/v2/bookings/${bookingUid}`,
    { status: 'rejected', rejectionReason: reason },
    {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        'cal-api-version': '2024-06-14',
        'Content-Type': 'application/json',
      },
    }
  );
}

// ── Format date IT ────────────────────────────────────────────────────────────
function formatDateIT(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeIT(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Mail a Niccolò (con tasti accetta/rifiuta/CRM) ───────────────────────────
async function sendBookingNotificationToNicco(booking) {
  const token = booking.token;
  const acceptUrl = `${BASE_URL}/cal/accept?token=${token}`;
  const declineUrl = `${BASE_URL}/cal/decline?token=${token}`;
  const crmUrl = `${BASE_URL}/cal/crm?token=${token}`;

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <h2 style="color:#1a1a1a;">Nuova prenotazione in attesa</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr><td style="padding:6px 0;font-weight:bold;width:140px;">Nome</td><td>${booking.name}</td></tr>
    <tr><td style="padding:6px 0;font-weight:bold;">Email</td><td>${booking.email}</td></tr>
    <tr><td style="padding:6px 0;font-weight:bold;">Azienda</td><td>${booking.azienda || '—'}</td></tr>
    <tr><td style="padding:6px 0;font-weight:bold;">Ruolo</td><td>${booking.ruolo || '—'}</td></tr>
    <tr><td style="padding:6px 0;font-weight:bold;">Data</td><td>${formatDateIT(booking.startTime)}</td></tr>
    <tr><td style="padding:6px 0;font-weight:bold;">Meet</td><td><a href="${booking.meetUrl}">${booking.meetUrl}</a></td></tr>
    ${booking.notes ? `<tr><td style="padding:6px 0;font-weight:bold;vertical-align:top;">Note</td><td>${booking.notes}</td></tr>` : ''}
  </table>

  <table style="border-collapse:collapse;">
    <tr>
      <td style="padding-right:12px;">
        <a href="${acceptUrl}" style="background:#1a1a1a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:15px;display:inline-block;">Accetta</a>
      </td>
      <td style="padding-right:12px;">
        <a href="${declineUrl}" style="background:#fff;color:#1a1a1a;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:15px;display:inline-block;border:1px solid #1a1a1a;">Rifiuta</a>
      </td>
      <td>
        <a href="${crmUrl}" style="background:#fff;color:#555;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:15px;display:inline-block;border:1px solid #ccc;">+ Aggiungi al CRM</a>
      </td>
    </tr>
  </table>
</div>`;

  await sendMail({
    to: NICCO_EMAIL,
    subject: `Prenotazione in attesa: ${booking.name} — ${formatDateIT(booking.startTime)}`,
    html,
  });
}

// ── Mail di conferma al cliente ───────────────────────────────────────────────
async function sendConfirmationToClient(booking) {
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <p>Buongiorno ${booking.name},</p>
  <p>sono Niccolò di Lemons in the room. La ringrazio per aver prenotato una chiamata con noi.</p>
  <p>Ci sentiamo <strong>${formatDateIT(booking.startTime)}</strong> tramite Google Meet:<br>
  <a href="${booking.meetUrl}">${booking.meetUrl}</a></p>
  <p>Se avesse necessità di anticipare l'orario o se ci sono argomenti specifici di cui vorrebbe discutere, non esiti a rispondere a questa mail.</p>
  <p>A presto,<br>Niccolò<br>Lemons in the room</p>
</div>`;

  await sendMail({
    to: booking.email,
    replyTo: NICCO_EMAIL,
    subject: `Chiamata confermata — ${formatDateIT(booking.startTime)}`,
    html,
  });
}

// ── Mail di reminder (mattina stessa ore 8) ───────────────────────────────────
async function sendReminderToClient(booking) {
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <p>Buongiorno ${booking.name},</p>
  <p>come da accordi, ci sentiamo oggi alle <strong>${formatTimeIT(booking.startTime)}</strong> tramite Google Meet:<br>
  <a href="${booking.meetUrl}">${booking.meetUrl}</a></p>
  <p>A presto,<br>Niccolò<br>Lemons in the room</p>
</div>`;

  await sendMail({
    to: booking.email,
    replyTo: NICCO_EMAIL,
    subject: `Ci sentiamo oggi alle ${formatTimeIT(booking.startTime)}`,
    html,
  });
}

// ── Mail di rifiuto al cliente ────────────────────────────────────────────────
async function sendDeclineToClient(booking) {
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <p>Buongiorno ${booking.name},</p>
  <p>la ringrazio per aver richiesto una chiamata. Purtroppo non sono disponibile nell'orario indicato.</p>
  <p>Se lo desidera, può scegliere un altro momento direttamente da qui:<br>
  <a href="https://cal.com/lemons/vr">https://cal.com/lemons/vr</a></p>
  <p>A presto,<br>Niccolò<br>Lemons in the room</p>
</div>`;

  await sendMail({
    to: booking.email,
    replyTo: NICCO_EMAIL,
    subject: 'Richiesta di chiamata',
    html,
  });
}

// ── Webhook Cal.com ───────────────────────────────────────────────────────────
app.post('/cal-booking', async (req, res) => {
  res.sendStatus(200);

  const payload = req.body;
  const triggerEvent = payload.triggerEvent;

  if (triggerEvent !== 'BOOKING_REQUESTED') return;

  const data = payload.payload || {};
  const responses = data.responses || {};

  const booking = {
    uid: data.uid,
    token: crypto.randomBytes(24).toString('hex'),
    name: responses.name?.value || data.title || 'Cliente',
    email: responses.email?.value || '',
    azienda: responses.azienda?.value || '',
    ruolo: responses.ruolo?.value || '',
    notes: responses.notes?.value || '',
    startTime: data.startTime,
    endTime: data.endTime,
    meetUrl: data.metadata?.videoCallUrl || '',
    status: 'pending',
    crmAdded: false,
    createdAt: new Date().toISOString(),
  };

  const bookings = loadJSON(BOOKINGS_FILE, {});
  bookings[booking.token] = booking;
  saveJSON(BOOKINGS_FILE, bookings);

  logEvent({ type: 'booking_received', uid: booking.uid, at: booking.createdAt });

  try {
    await sendBookingNotificationToNicco(booking);
  } catch (err) {
    console.error('Errore invio mail a Niccolò:', err.message);
  }
});

// ── Accetta ───────────────────────────────────────────────────────────────────
app.get('/cal/accept', async (req, res) => {
  const { token } = req.query;
  const bookings = loadJSON(BOOKINGS_FILE, {});
  const booking = bookings[token];

  if (!booking) return res.status(404).send('Prenotazione non trovata.');
  if (booking.status !== 'pending') return res.send(`Già gestita (stato: ${booking.status}).`);

  try {
    await calAccept(booking.uid);
    booking.status = 'accepted';
    saveJSON(BOOKINGS_FILE, bookings);

    await sendConfirmationToClient(booking);
    scheduleReminder(booking);

    logEvent({ type: 'booking_accepted', uid: booking.uid, at: new Date().toISOString() });

    res.send(`
      <div style="font-family:Arial,sans-serif;padding:40px;max-width:500px;margin:0 auto;">
        <h2>Chiamata accettata</h2>
        <p>${booking.name} ha ricevuto la conferma. Il reminder è programmato per le 8:00 del giorno stesso.</p>
      </div>
    `);
  } catch (err) {
    console.error('Errore accettazione:', err.message);
    res.status(500).send('Errore durante l\'accettazione. Riprova.');
  }
});

// ── Rifiuta ───────────────────────────────────────────────────────────────────
app.get('/cal/decline', async (req, res) => {
  const { token } = req.query;
  const bookings = loadJSON(BOOKINGS_FILE, {});
  const booking = bookings[token];

  if (!booking) return res.status(404).send('Prenotazione non trovata.');
  if (booking.status !== 'pending') return res.send(`Già gestita (stato: ${booking.status}).`);

  try {
    await calDecline(booking.uid, 'Non disponibile in questo slot.');
    booking.status = 'declined';
    saveJSON(BOOKINGS_FILE, bookings);

    await sendDeclineToClient(booking);

    logEvent({ type: 'booking_declined', uid: booking.uid, at: new Date().toISOString() });

    res.send(`
      <div style="font-family:Arial,sans-serif;padding:40px;max-width:500px;margin:0 auto;">
        <h2>Chiamata rifiutata</h2>
        <p>${booking.name} ha ricevuto una mail con il link per ripianificare.</p>
      </div>
    `);
  } catch (err) {
    console.error('Errore rifiuto:', err.message);
    res.status(500).send('Errore durante il rifiuto. Riprova.');
  }
});

// ── Aggiungi al CRM ───────────────────────────────────────────────────────────
app.get('/cal/crm', async (req, res) => {
  const { token } = req.query;
  const bookings = loadJSON(BOOKINGS_FILE, {});
  const booking = bookings[token];

  if (!booking) return res.status(404).send('Prenotazione non trovata.');

  booking.crmAdded = true;
  saveJSON(BOOKINGS_FILE, bookings);
  logEvent({ type: 'crm_added', uid: booking.uid, at: new Date().toISOString() });

  res.send(`
    <div style="font-family:Arial,sans-serif;padding:40px;max-width:500px;margin:0 auto;">
      <h2>Aggiunto al CRM</h2>
      <p>${booking.name} (${booking.azienda}) salvato. Integrazione Notion da configurare.</p>
    </div>
  `);
});

// ── Reminder scheduler ────────────────────────────────────────────────────────
function scheduleReminder(booking) {
  const startDate = new Date(booking.startTime);
  const reminderDate = new Date(startDate);
  reminderDate.setUTCHours(6, 0, 0, 0); // 6 UTC = 8 CEST

  const now = new Date();
  if (reminderDate.getTime() <= now.getTime()) {
    console.log(`Reminder per ${booking.name} già passato, skip.`);
    return;
  }

  const reminders = loadJSON(REMINDERS_FILE, []);
  reminders.push({ token: booking.token, sendAt: reminderDate.toISOString(), sent: false });
  saveJSON(REMINDERS_FILE, reminders);

  console.log(`Reminder schedulato per ${booking.name} alle ${reminderDate.toISOString()}`);
}

cron.schedule('* * * * *', async () => {
  const reminders = loadJSON(REMINDERS_FILE, []);
  const now = new Date();
  let changed = false;

  for (const r of reminders) {
    if (r.sent) continue;
    if (new Date(r.sendAt) > now) continue;

    const bookings = loadJSON(BOOKINGS_FILE, {});
    const booking = bookings[r.token];

    if (!booking || booking.status !== 'accepted') {
      r.sent = true;
      changed = true;
      continue;
    }

    try {
      await sendReminderToClient(booking);
      r.sent = true;
      changed = true;
      logEvent({ type: 'reminder_sent', uid: booking.uid, at: now.toISOString() });
      console.log(`Reminder inviato a ${booking.email}`);
    } catch (err) {
      console.error('Errore reminder:', err.message);
    }
  }

  if (changed) saveJSON(REMINDERS_FILE, reminders);
});

function reloadPendingReminders() {
  const reminders = loadJSON(REMINDERS_FILE, []);
  const pending = reminders.filter(r => !r.sent).length;
  console.log(`Reminder pendenti all'avvio: ${pending}`);
}

// ── Endpoints tracker originali ───────────────────────────────────────────────
app.get('/track', (req, res) => {
  const { id, to } = req.query;
  logEvent({ type: 'open', id, to, at: new Date().toISOString() });
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.send(gif);
});

app.get('/click', (req, res) => {
  const { id, url, label } = req.query;
  logEvent({ type: 'click', id, url, label, at: new Date().toISOString() });
  res.redirect(url);
});

app.get('/opens', (req, res) => {
  if (!fs.existsSync(EVENTS_FILE)) return res.json([]);
  const lines = fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const map = {};
  for (const e of events) {
    if (e.type !== 'open' && e.type !== 'click') continue;
    const key = e.id;
    if (!map[key]) map[key] = { id: key, to: e.to, opens: 0, last_open: null, forwarded: false, clicks: [] };
    if (e.type === 'open') { map[key].opens++; map[key].last_open = e.at; }
    if (e.type === 'click') map[key].clicks.push({ url: e.url, label: e.label, at: e.at });
  }
  res.json(Object.values(map));
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato su porta ${PORT}`);
  reloadPendingReminders();
});

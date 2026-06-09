const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');

function appendEvent(data) {
  try {
    fs.appendFileSync(EVENTS_FILE, JSON.stringify({ ...data, at: new Date().toISOString() }) + '\n');
  } catch (e) { console.error('Write failed:', e.message); }
}

function readEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  return fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

const transporter = nodemailer.createTransport({
  host: 'smtp.resend.com', port: 587, secure: false,
  auth: { user: 'resend', pass: process.env.RESEND_API_KEY },
});

const sessions = new Map();

async function notify(subject, html) {
  try {
    await transporter.sendMail({
      from: '"Lemons Tracker 🍋" <onboarding@resend.dev>',
      to: 'niccolo@lemonsintheroom.com',
      subject, html,
    });
  } catch (err) { console.error('Notify failed:', err.message); }
}

function getIp(req) { return (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(); }
function formatTime(iso) { return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }); }
function extractForwarderHint(ua, headers) {
  const c = [headers['x-forwarded-email'], headers['x-original-to']].filter(Boolean);
  if (c.length) return c[0];
  const m = ua.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : null;
}

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

app.get('/track', async (req, res) => {
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.send(PIXEL);

  const { id, to } = req.query;
  if (!id) return;

  const ip = getIp(req), ua = req.headers['user-agent'] || '';
  let session = sessions.get(id);
  const isFirstOpen = !session;

  if (!session) { session = { firstIp: ip, opens: 0, forwarded: false }; sessions.set(id, session); }
  session.opens++;

  if (!isFirstOpen && ip !== session.firstIp && !session.forwarded) {
    session.forwarded = true;
    const hint = extractForwarderHint(ua, req.headers);
    appendEvent({ type: 'forward', id, to, ip, hint });
    const now = new Date().toISOString();
    await notify(
      `📨 ${id} ha inoltrato la tua mail`,
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#03091B;">
        <strong>📨 ${id}</strong> ha inoltrato la mail
        ${hint ? `<br><span style="color:#FF8731;">→ ${hint}</span>` : ''}
        <br><span style="color:#888;font-size:12px;">${formatTime(now)}</span>
      </div>`
    );
  }

  appendEvent({ type: 'open', id, to, ip });

  if (isFirstOpen || session.opens % 5 === 0) {
    const n = session.opens, label = to ? `${id} (${to})` : id;
    const now = new Date().toISOString();
    await notify(
      `👁 ${label} ha aperto la tua mail${n > 1 ? ` (${n}ª volta)` : ''}`,
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#03091B;">
        <strong>👁 ${label}</strong> ha aperto la tua mail
        ${n > 1 ? `<br><span style="color:#FF8731;">Già aperta ${n} volte</span>` : ''}
        <br><span style="color:#888;font-size:12px;">${formatTime(now)}</span>
      </div>`
    );
  }
});

app.get('/click', async (req, res) => {
  const { id, label, url } = req.query;
  if (!url) return res.redirect('https://lemonsintheroom.com');
  appendEvent({ type: 'click', id, ip: getIp(req), label, url });
  const now = new Date().toISOString();
  const emoji = url.includes('cal.com') ? '📅' : url.includes('linkedin') ? '💼' : '🌐';
  await notify(
    `${emoji} ${id} ha cliccato su "${label || url}"`,
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#03091B;">
      <strong>${emoji} ${id}</strong> ha cliccato su <strong>${label || url}</strong>
      <br><span style="color:#888;font-size:12px;">${formatTime(now)}</span>
    </div>`
  );
  res.redirect(url);
});

app.get('/opens', (req, res) => {
  const events = readEvents();
  const map = {};
  events.forEach(e => {
    if (!map[e.id]) map[e.id] = { id: e.id, to: e.to, opens: 0, last_open: null, forwarded: false, clicks: [] };
    if (e.type === 'open') { map[e.id].opens++; map[e.id].last_open = e.at; }
    if (e.type === 'forward') map[e.id].forwarded = true;
    if (e.type === 'click') map[e.id].clicks.push({ label: e.label, url: e.url, at: e.at });
  });
  res.json(Object.values(map).sort((a, b) => (b.last_open || '').localeCompare(a.last_open || '')));
});

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Tracker running on port ${PORT}`));

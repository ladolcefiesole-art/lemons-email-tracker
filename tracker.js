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

const sessions = new Map();

async function notify(subject, html) {
  try {
    console.log('Notify sending:', subject);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: '"Lemons Tracker 🍋" <tracker@lemonsintheroom.com>',
        to: 'niccolo@lemonsintheroom.com',
        subject,
        html,
      }),
    });
    const data = await res.json();
    if (res.ok) { console.log('Notify sent OK', data.id); }
    else { console.error('Notify failed:', JSON.stringify(data)); }
  } catch (err) { console.error('Notify error:', err.message); }
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

// Cal.com webhook — BOOKING_CREATED
app.post('/cal-booking', express.json(), async (req, res) => {
  res.sendStatus(200);
  try {
    const payload = req.body;
    const booking = payload?.payload || payload;

    const name    = booking?.attendees?.[0]?.name || booking?.responses?.name?.value || '';
    const email   = booking?.attendees?.[0]?.email || booking?.responses?.email?.value || '';
    const azienda = booking?.responses?.azienda?.value || '';
    const ruolo   = booking?.responses?.ruolo?.value || '';
    const title   = booking?.title || booking?.eventType?.title || '';
    const start   = booking?.startTime || booking?.responses?.startTime?.value || '';
    const meet    = booking?.metadata?.videoCallUrl || booking?.videoCallUrl || '';

    const notionToken = process.env.NOTION_TOKEN;
    const crmDb       = '68ab8708-9f38-4053-a0e4-0d08c79dec8d';
    const aziendaDb   = '1d5e69fb-b9e6-8001-ba04-eb705213fb30';
    const niccoloId   = '9d6e79b1-83bb-4b3e-a11a-f0a7a2060d44';

    // 1. Cerca azienda esistente nel db Notion, altrimenti la crea
    let aziendaRelation = [];
    if (azienda && notionToken) {
      const searchRes = await fetch(`https://api.notion.com/v1/databases/${aziendaDb}/query`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: { property: 'Nome Struttura', title: { equals: azienda } },
          page_size: 1
        })
      });
      const searchData = await searchRes.json();
      if (searchData.results?.length > 0) {
        // Azienda già esistente — usa quella
        aziendaRelation = [{ id: searchData.results[0].id }];
      } else {
        // Non esiste — crea nuova
        const aziendaRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parent: { database_id: aziendaDb },
            properties: { 'Nome Struttura': { title: [{ text: { content: azienda } }] } }
          })
        });
        const aziendaPage = await aziendaRes.json();
        if (aziendaPage.id) aziendaRelation = [{ id: aziendaPage.id }];
      }
    }

    // 2. Crea contatto nel CRM
    const bookingDate = start ? start.split('T')[0] : new Date().toISOString().split('T')[0];
    const crmProps = {
      'Persona':      { title: [{ text: { content: name } }] },
      'Mail':         { rich_text: [{ text: { content: email } }] },
      'Pipeline':     { status: { name: 'Lead Generation' } },
      'Channel':      { multi_select: [{ name: 'Cal.com' }] },
      'Origin':       { select: { name: 'Inbound' } },
      'Relathionship':{ multi_select: [{ name: 'Lead' }] },
      'PR Manager':   { people: [{ object: 'user', id: niccoloId }] },
      'Discovery':    { date: { start: bookingDate } },
      'Reminder':     { date: { start: bookingDate } },
      'Generation':   { date: { start: new Date().toISOString().split('T')[0] } },
    };
    if (ruolo) crmProps['Ruolo'] = { multi_select: [{ name: ruolo }] };
    if (aziendaRelation.length) crmProps['Azienda '] = { relation: aziendaRelation };

    if (notionToken) {
      const crmRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: { database_id: crmDb }, properties: crmProps })
      });
      const crmData = await crmRes.json();
      if (!crmRes.ok) console.error('CRM create error:', JSON.stringify(crmData));
      else console.log('CRM contact created:', crmData.id);
    }

    // 3. Ricerca info sull'azienda via DuckDuckGo Instant Answer
    let aziendaInfo = '';
    if (azienda) {
      try {
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(azienda)}&format=json&no_html=1&skip_disambig=1`;
        const ddgRes = await fetch(ddgUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const ddg = await ddgRes.json();
        const abstract = ddg.AbstractText || ddg.Answer || '';
        const related = (ddg.RelatedTopics || []).slice(0,2).map(t => t.Text || '').filter(Boolean).join(' ');
        aziendaInfo = (abstract || related).substring(0, 500);
      } catch(e) { /* silenzioso */ }
    }

    // 4. Email briefing a Niccolò
    const dateLabel = start ? new Date(start).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full', timeStyle: 'short' }) : bookingDate;
    await notify(
      `📅 Nuovo booking Cal.com — ${name}${azienda ? ', ' + azienda : ''}`,
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#03091B;line-height:1.6;">
        <h3 style="color:#FF8731;margin:0 0 12px;">📅 Nuova call prenotata</h3>
        <table cellpadding="4" cellspacing="0" border="0">
          <tr><td style="color:#888;width:100px;">Chi</td><td><strong>${name}</strong> — ${email}</td></tr>
          ${azienda ? `<tr><td style="color:#888;">Azienda</td><td>${azienda}</td></tr>` : ''}
          ${ruolo   ? `<tr><td style="color:#888;">Ruolo</td><td>${ruolo}</td></tr>` : ''}
          <tr><td style="color:#888;">Quando</td><td>${dateLabel}</td></tr>
          <tr><td style="color:#888;">Evento</td><td>${title}</td></tr>
          ${meet ? `<tr><td style="color:#888;">Meet</td><td><a href="${meet}">${meet}</a></td></tr>` : ''}
        </table>
        ${aziendaInfo ? `
        <div style="margin-top:16px;padding:12px;background:#f9f9f9;border-left:3px solid #FF8731;border-radius:4px;">
          <div style="font-size:12px;font-weight:bold;color:#FF8731;margin-bottom:6px;">📍 ${azienda}</div>
          <div style="font-size:13px;color:#444;">${aziendaInfo}</div>
        </div>` : ''}
        <p style="margin-top:16px;color:#888;font-size:12px;">Contatto aggiunto nel CRM Notion • Channel: Cal.com • Pipeline: Lead Generation</p>
      </div>`
    );

    appendEvent({ type: 'cal_booking', name, email, azienda, ruolo, start });
  } catch (err) {
    console.error('cal-booking error:', err.message);
  }
});

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Tracker running on port ${PORT}`));

const express = require('express');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const app = express();

const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DB_PATH = path.join(DB_DIR, 'tracker.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT,
    to_email TEXT,
    event TEXT,
    ip TEXT,
    hint TEXT,
    label TEXT,
    url TEXT,
    file_name TEXT,
    file_label TEXT,
    at TEXT DEFAULT (datetime('now'))
  )
`);

const insertEvent = db.prepare(`
  INSERT INTO events (contact_id, to_email, event, ip, hint, label, url, file_name, file_label)
  VALUES (@id, @to, @event, @ip, @hint, @label, @url, @file, @name)
`);

const transporter = nodemailer.createTransport({
  host: 'smtps.aruba.it', port: 465, secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const sessions = new Map();

async function notify(subject, html) {
  try {
    await transporter.sendMail({
      from: '"Lemons Tracker 🍋" <niccolo@lemonsintheroom.com>',
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

app.get('/track', async (req, res) => {
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));

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
    insertEvent.run({ id, to: to || null, event: 'forward', ip, hint: hint || null, label: null, url: null, file: null, name: null });
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

  insertEvent.run({ id, to: to || null, event: 'open', ip, hint: null, label: null, url: null, file: null, name: null });

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
  insertEvent.run({ id, to: null, event: 'click', ip: getIp(req), hint: null, label: label || null, url, file: null, name: null });
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
  const rows = db.prepare(`
    SELECT
      contact_id as id,
      to_email,
      COUNT(CASE WHEN event='open' THEN 1 END) as opens,
      MAX(CASE WHEN event='open' THEN at END) as last_open,
      MAX(CASE WHEN event='forward' THEN 1 ELSE 0 END) as forwarded
    FROM events
    GROUP BY contact_id, to_email
    ORDER BY last_open DESC
  `).all();

  const clicks = db.prepare(`SELECT contact_id, label, url, at FROM events WHERE event='click' ORDER BY at`).all();
  const clickMap = {};
  clicks.forEach(c => {
    if (!clickMap[c.contact_id]) clickMap[c.contact_id] = [];
    clickMap[c.contact_id].push({ label: c.label, url: c.url, at: c.at });
  });

  res.json(rows.map(r => ({ ...r, forwarded: !!r.forwarded, clicks: clickMap[r.id] || [] })));
});

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Tracker running on port ${PORT}`));

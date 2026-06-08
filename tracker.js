const express = require('express');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('.railway.internal') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});

const transporter = nodemailer.createTransport({
  host: 'smtps.aruba.it', port: 465, secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const sessions = new Map();

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      contact_id TEXT,
      to_email TEXT,
      event TEXT,
      ip TEXT,
      hint TEXT,
      label TEXT,
      url TEXT,
      file_name TEXT,
      file_label TEXT,
      at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function logEvent(data) {
  await pool.query(
    `INSERT INTO events (contact_id, to_email, event, ip, hint, label, url, file_name, file_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [data.id, data.to || null, data.event, data.ip || null, data.hint || null,
     data.label || null, data.url || null, data.file || null, data.name || null]
  );
}

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
  res.send(PIXEL);

  const { id, to } = req.query;
  if (!id) return;

  const ip = getIp(req), now = new Date().toISOString(), ua = req.headers['user-agent'] || '';
  let session = sessions.get(id);
  const isFirstOpen = !session;

  if (!session) { session = { firstIp: ip, opens: 0, forwarded: false }; sessions.set(id, session); }
  session.opens++;

  if (!isFirstOpen && ip !== session.firstIp && !session.forwarded) {
    session.forwarded = true;
    const hint = extractForwarderHint(ua, req.headers);
    await logEvent({ id, to, event: 'forward', ip, hint });
    await notify(
      `📨 ${id} ha inoltrato la tua mail`,
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#03091B;">
        <strong>📨 ${id}</strong> ha inoltrato la mail
        ${hint ? `<br><span style="color:#FF8731;">→ ${hint}</span>` : ''}
        <br><span style="color:#888;font-size:12px;">${formatTime(now)}</span>
      </div>`
    );
  }

  await logEvent({ id, to, event: 'open', ip });

  if (isFirstOpen || session.opens % 5 === 0) {
    const n = session.opens, label = to ? `${id} (${to})` : id;
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
  const now = new Date().toISOString();
  await logEvent({ id, event: 'click', label, url, ip: getIp(req) });
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

app.get('/opens', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT contact_id as id, to_email,
      COUNT(*) FILTER (WHERE event='open') as opens,
      BOOL_OR(event='forward') as forwarded,
      MAX(at) FILTER (WHERE event='open') as last_open,
      JSON_AGG(JSON_BUILD_OBJECT('label',label,'url',url,'at',at) ORDER BY at)
        FILTER (WHERE event='click') as clicks,
      JSON_AGG(JSON_BUILD_OBJECT('name',file_label,'at',at) ORDER BY at)
        FILTER (WHERE event='download') as downloads
    FROM events
    GROUP BY contact_id, to_email
    ORDER BY last_open DESC NULLS LAST
  `);
  res.json(rows);
});

app.get('/health', (_, res) => res.json({ ok: true }));

initDb()
  .then(() => {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => console.log(`Tracker running on port ${PORT}`));
  })
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });

const { kv } = require('@vercel/kv');
const crypto = require('crypto');
const { sendMail } = require('../lib/mailer');
const { formatDateIT } = require('../lib/dates');

const NICCO_EMAIL = process.env.NICCO_EMAIL || 'niccolo@lemonsintheroom.com';
const BASE_URL = process.env.BASE_URL;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  res.status(200).end();

  const payload = req.body;
  if (payload.triggerEvent !== 'BOOKING_REQUESTED') return;

  const data = payload.payload || {};
  const responses = data.responses || {};

  const booking = {
    uid: data.uid,
    token: crypto.randomBytes(24).toString('hex'),
    name: responses.name?.value || 'Cliente',
    email: responses.email?.value || '',
    azienda: responses.azienda?.value || '',
    ruolo: responses.ruolo?.value || '',
    notes: responses.notes?.value || '',
    startTime: data.startTime,
    meetUrl: data.metadata?.videoCallUrl || '',
    status: 'pending',
    crmAdded: false,
    createdAt: new Date().toISOString(),
  };

  await kv.set(`booking:${booking.token}`, booking, { ex: 60 * 60 * 24 * 60 }); // 60 giorni

  const acceptUrl = `${BASE_URL}/api/accept?token=${booking.token}`;
  const declineUrl = `${BASE_URL}/api/decline?token=${booking.token}`;
  const crmUrl = `${BASE_URL}/api/crm?token=${booking.token}`;

  await sendMail({
    to: NICCO_EMAIL,
    subject: `Prenotazione in attesa: ${booking.name} — ${formatDateIT(booking.startTime)}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <h2>Nuova prenotazione in attesa</h2>
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
</div>`,
  });
};

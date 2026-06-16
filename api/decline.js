const { kv } = require('@vercel/kv');
const axios = require('axios');
const { sendMail } = require('../lib/mailer');

const NICCO_EMAIL = process.env.NICCO_EMAIL || 'niccolo@lemonsintheroom.com';

module.exports = async function handler(req, res) {
  const { token } = req.query;
  const booking = await kv.get(`booking:${token}`);

  if (!booking) return res.status(404).send('Prenotazione non trovata.');
  if (booking.status !== 'pending') return res.send(`Già gestita (stato: ${booking.status}).`);

  await axios.patch(
    `https://api.cal.com/v2/bookings/${booking.uid}`,
    { status: 'rejected', rejectionReason: 'Non disponibile in questo slot.' },
    {
      headers: {
        Authorization: `Bearer ${process.env.CAL_API_KEY}`,
        'cal-api-version': '2024-06-14',
      },
    }
  );

  booking.status = 'declined';
  await kv.set(`booking:${token}`, booking, { ex: 60 * 60 * 24 * 60 });

  await sendMail({
    to: booking.email,
    replyTo: NICCO_EMAIL,
    subject: 'Richiesta di chiamata',
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <p>Buongiorno ${booking.name},</p>
  <p>la ringrazio per aver richiesto una chiamata. Purtroppo non sono disponibile nell'orario indicato.</p>
  <p>Se lo desidera, può scegliere un altro momento direttamente da qui:<br>
  <a href="https://cal.com/lemons/vr">https://cal.com/lemons/vr</a></p>
  <p>A presto,<br>Niccolò<br>Lemons in the room</p>
</div>`,
  });

  res.send(`
    <div style="font-family:Arial,sans-serif;padding:40px;max-width:500px;margin:0 auto;">
      <h2>Chiamata rifiutata</h2>
      <p>${booking.name} ha ricevuto una mail con il link per ripianificare.</p>
    </div>
  `);
};

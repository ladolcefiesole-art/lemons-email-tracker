const { kv } = require('@vercel/kv');
const axios = require('axios');
const { sendMail } = require('../lib/mailer');
const { formatDateIT } = require('../lib/dates');

const NICCO_EMAIL = process.env.NICCO_EMAIL || 'niccolo@lemonsintheroom.com';

module.exports = async function handler(req, res) {
  const { token } = req.query;
  const booking = await kv.get(`booking:${token}`);

  if (!booking) return res.status(404).send('Prenotazione non trovata.');
  if (booking.status !== 'pending') return res.send(`Già gestita (stato: ${booking.status}).`);

  await axios.patch(
    `https://api.cal.com/v2/bookings/${booking.uid}/confirm`,
    {},
    {
      headers: {
        Authorization: `Bearer ${process.env.CAL_API_KEY}`,
        'cal-api-version': '2024-06-14',
      },
    }
  );

  booking.status = 'accepted';
  await kv.set(`booking:${token}`, booking, { ex: 60 * 60 * 24 * 60 });

  await sendMail({
    to: booking.email,
    replyTo: NICCO_EMAIL,
    subject: `Chiamata confermata — ${formatDateIT(booking.startTime)}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <p>Buongiorno ${booking.name},</p>
  <p>sono Niccolò di Lemons in the room. La ringrazio per aver prenotato una chiamata con noi.</p>
  <p>Ci sentiamo <strong>${formatDateIT(booking.startTime)}</strong> tramite Google Meet:<br>
  <a href="${booking.meetUrl}">${booking.meetUrl}</a></p>
  <p>Se avesse necessità di anticipare l'orario o se ci sono argomenti specifici di cui vorrebbe discutere, non esiti a rispondere a questa mail.</p>
  <p>A presto,<br>Niccolò<br>Lemons in the room</p>
</div>`,
  });

  res.send(`
    <div style="font-family:Arial,sans-serif;padding:40px;max-width:500px;margin:0 auto;">
      <h2>Chiamata accettata</h2>
      <p>${booking.name} ha ricevuto la conferma. Il reminder partirà alle 8:00 del giorno stesso.</p>
    </div>
  `);
};

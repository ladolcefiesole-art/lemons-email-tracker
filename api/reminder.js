const { kv } = require('@vercel/kv');
const { sendMail } = require('../lib/mailer');
const { formatTimeIT } = require('../lib/dates');

const NICCO_EMAIL = process.env.NICCO_EMAIL || 'niccolo@lemonsintheroom.com';

module.exports = async function handler(req, res) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
  const keys = await kv.keys('booking:*');
  let sent = 0;

  for (const key of keys) {
    const booking = await kv.get(key);
    if (!booking || booking.status !== 'accepted') continue;

    const bookingDay = booking.startTime.slice(0, 10);
    if (bookingDay !== today) continue;

    await sendMail({
      to: booking.email,
      replyTo: NICCO_EMAIL,
      subject: `Ci sentiamo oggi alle ${formatTimeIT(booking.startTime)}`,
      html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <p>Buongiorno ${booking.name},</p>
  <p>come da accordi, ci sentiamo oggi alle <strong>${formatTimeIT(booking.startTime)}</strong> tramite Google Meet:<br>
  <a href="${booking.meetUrl}">${booking.meetUrl}</a></p>
  <p>A presto,<br>Niccolò<br>Lemons in the room</p>
</div>`,
    });

    sent++;
  }

  res.json({ ok: true, sent });
};

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtps.aruba.it',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail({ to, subject, html, replyTo }) {
  return transporter.sendMail({
    from: `"Niccolò - Lemons in the room" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
    replyTo,
  });
}

module.exports = { sendMail };

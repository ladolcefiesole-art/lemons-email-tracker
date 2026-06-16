const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  const { token } = req.query;
  const booking = await kv.get(`booking:${token}`);

  if (!booking) return res.status(404).send('Prenotazione non trovata.');

  booking.crmAdded = true;
  await kv.set(`booking:${token}`, booking, { ex: 60 * 60 * 24 * 60 });

  res.send(`
    <div style="font-family:Arial,sans-serif;padding:40px;max-width:500px;margin:0 auto;">
      <h2>Aggiunto al CRM</h2>
      <p>${booking.name} (${booking.azienda || 'azienda non specificata'}) salvato. Integrazione Notion da configurare.</p>
    </div>
  `);
};

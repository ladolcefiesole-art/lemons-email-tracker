function formatDateIT(isoString) {
  return new Date(isoString).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeIT(isoString) {
  return new Date(isoString).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
  });
}

module.exports = { formatDateIT, formatTimeIT };

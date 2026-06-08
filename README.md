# Lemons Email Tracker

Node.js server da deployare su lemonsintheroom.com.
Traccia: aperture mail, forwarding, click su sito/LinkedIn/cal.com, download PDF.
Invia notifica email a niccolo@lemonsintheroom.com ad ogni evento.

## Setup

```bash
npm install
SMTP_USER=niccolo@lemonsintheroom.com SMTP_PASS=*** node tracker.js
```

Gira su porta 3001.

## Nginx

Aggiungere al config di lemonsintheroom.com:

```nginx
location /track { proxy_pass http://localhost:3001; }
location /click  { proxy_pass http://localhost:3001; }
location /file   { proxy_pass http://localhost:3001; }
location /opens  { proxy_pass http://localhost:3001; }
```

## Endpoints

- `GET /track?id=X&to=EMAIL` — pixel apertura
- `GET /click?id=X&label=Y&url=DEST` — tracking click con redirect
- `GET /file?id=X&name=Y&file=FILENAME` — download PDF tracciato (file in /files/)
- `GET /opens` — dashboard JSON con tutti gli eventi

## Cartella files/

Mettere i PDF da inviare nelle mail in `email-tracker/files/`.
Verranno serviti via /file e tracciati al download.

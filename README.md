# Ardthon Billing System (ABS)

ISP billing + hotspot management + MikroTik control platform.

**Live:** https://billing.ardthonsolutions.com/

## Stack
- Node.js 22 + Express 4
- EJS templating
- MySQL 8 (mysql2)
- express-session + connect-flash
- bcryptjs
- web-push
- node-routeros
- Safaricom Daraja

## Phase status
- Phase 1 — Foundation, DB, migrations, seed, PWA shell (done)
- Phase 2 — Auth + dashboard + tenant management (next)

## Setup
    cp .env.example .env
    npm install
    node scripts/migrate.js
    node seeds/seed.js
    touch tmp/restart.txt

## Deploy
- Host: cPanel + CloudLinux Passenger
- Path: /home/yxmvmjxp/billingapp/
- Venv: /home/yxmvmjxp/nodevenv/billingapp/22/
- Restart: touch tmp/restart.txt

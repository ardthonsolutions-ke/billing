# HANDOFF — Ardthon Billing System

**Last updated:** 2026-10-06
**Host:** cPanel + CloudLinux Passenger at Truehost (`das115`)
**Domain:** https://billing.ardthonsolutions.com
**App:** `/home/yxmvmjxp/billingapp/`
**Venv:** `/home/yxmvmjxp/nodevenv/billingapp/22/`
**DB:** `yxmvmjxp_billing @ 127.0.0.1:3306` — user `yxmvmjxp_billinguser`
**GitHub:** https://github.com/ardthonsolutions-ke/billing — branch `main`
**SSH:** `yxmvmjxp@das115.truehost.cloud`

## Stack

- Node 22 + Express 4 + EJS + MySQL 8 (mysql2)
- `express-session` with MySQL store
- bcryptjs, multer, nodemailer (localhost:25), web-push (VAPID)
- `node-routeros` (MikroTik API client)
- Passenger proxying to app (port 3001)

## Credentials

- **Super admin:** `admin@billing.ardthonsolutions.com` / `ArdthonAdmin2026!`
- **ISP admin (Demo ISP):** `isp@demo.com` / `Test123!`
- **Subscriber portal:** `/t/demo-isp/portal/login` — phone `0712345678` / `test123`

## Architecture (as of 2026-10-06)

Routes are split into `routes/*.js`, NOT in `server.js`:

| File | Purpose |
|------|---------|
| `routes/auth.js` | login, register, logout |
| `routes/dashboard.js` | admin dashboard |
| `routes/network.js` | live router status, active sessions, disconnect, history, `/network/api/live` |
| `routes/routers.js` | router CRUD |
| `routes/subscribers.js` | subscriber CRUD |
| `routes/plans.js` | plan CRUD |
| `routes/payments.js` | payment list/detail/complete |
| `routes/reports.js` | revenue, subscriber, plan charts |
| `routes/tickets.js` | tickets + messages |
| `routes/leads.js` | lead capture + convert |
| `routes/tenants.js` | tenant CRUD (super admin) |
| `routes/users.js` | user CRUD |
| `routes/settings.js` | settings tabs + portal preview |
| `routes/captive.js` | public captive portal |
| `routes/portal.js` | subscriber portal |

All mounted with `app.use('/', require('./routes/X'))` in `server.js` (lines 94–109).

## Key services

- `services/mikrotikService.js` — RouterOS client, `getRouterFullStatus`, disconnect, PPPoE
- `services/pushService.js` — web-push notifications
- `services/expiryService.js` — subscriber expiry cron (5min interval)
- `services/broadcastEmail.js` — bulk email

## Middleware

- `middleware/auth.js` — `requireAuth`, `requireRole`, `requireSuperAdmin`
- `middleware/subscriberAuth.js` — portal session auth
- `middleware/tenantResolver.js` — sets `req.tenant` from host/path

## Migrations

`migrations/` — 001 through 007 applied. 001–006 are `.sql`, 007 is `.js`. Runner supports both.

Current tables: users, tenants, tenant_settings, sessions, audit_log, plans, routers, access_points, subscribers, subscriber_events, payments, portal_sessions, tickets, ticket_messages, leads, lead_events, plus CuePay tables.

## Frontend

- `public/css/dashboard.css` — admin shell (~2279 lines)
- `public/css/portal.css` — subscriber portal
- `public/css/mobile.css`, `reports.css`, `network.css`

**Sidebar flyout:** one source of truth now — HOVER FLYOUT block near line 2170 sets `.abs-sidebar` base + `body.flyout-open .abs-sidebar` open state (no `!important`). Mobile override at end of file resets `left: 0`.

**Rail health badge:** `public/js/rail-health.js` polls `/network/api/live` every 15s and updates `.rail-badge` elements on the desktop rail Network icon and mobile bottom-nav Network item. States: `ok` (green), `warn` (amber), `down` (red pulse), `unknown` (grey).

**Theme:** `public/js/theme.js` — dark/light/system toggle via `data-theme` on `<html>`.

**Command palette:** `public/js/command-palette.js` — Cmd+K.

## Environment notes

- Passenger restart: `pkill -9 -u yxmvmjxp lsnode && rm -rf tmp/* && mkdir -p tmp && sleep 3 && touch tmp/restart.txt && sleep 12`
- CloudLinux `nproc` limit ~20-30 — if you hit `fork: Resource temporarily unavailable`, wait 60s.
- `node --check` before restart on any edited `.js`.
- MySQL2 auto-parses JSON columns — never `JSON.parse()` a returned object.

## Pending / deferred

- M-PESA Daraja integration (sandbox keys from developer.safaricom.co.ke)
- SMS notifications (Africa's Talking account)
- WireGuard enrollment (needs $5 VPS endpoint)
- Wildcard DNS + SSL for tenant subdomains (Truehost ticket 7415330)
- Bulk actions on `/network/active`
- Subscriber timeline on detail page
- Cache-bust consistency across all `<link>` / `<script>` tags in `layouts/dashboard.ejs`

## Done recently

- 2026-10-06: Fixed unclosed `.cmdk-dialog {` brace at line 1082 that caused the CSS parser to swallow 1230 lines
- 2026-10-06: Consolidated sidebar flyout CSS — removed duplicate override blocks
- 2026-10-06: Rail health badge on desktop + mobile
- 2026-10-06: Mobile sidebar sliver fix (reset `left: 0`)

## Rules learned the hard way

- Never use `sed` to delete ranges without a backup
- Add ONE route at a time; verify `node --check` after each
- Emails must be plain text; no emojis in subject lines
- Never cache `/api/*`, `/auth/*`, `/orders/*` in service worker
- Heredocs >200 lines can truncate — split or use nano
- `!` inside double-quoted shell strings triggers history expansion — use single quotes or `set +H`

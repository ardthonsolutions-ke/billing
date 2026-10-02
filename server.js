require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const path = require('path');
const expressLayouts = require("express-ejs-layouts");
const rateLimit = require('express-rate-limit');

// ── Config ──
const db = require('./config/database');
const sessionConfig = require('./config/session');
const CONSTANTS = require('./config/constants');

// ── App ──
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// ── Security ──
app.use(helmet({
  contentSecurityPolicy: false, // disable for EJS + inline scripts; tighten in prod
  crossOriginEmbedderPolicy: false
}));

// ── Rate limiters ──
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Try again in 15 minutes.'
});

app.use(generalLimiter);

// ── Body parsing ──
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

// ── Session ──
app.use(session(sessionConfig()));
app.use(flash());

// ── Static ──
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// ── Views ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Layout engine ──
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ── Inject common locals ──
app.use((req, res, next) => {
  req.db = db;
  res.locals.currentUser = req.session.user || null;
  res.locals.currentTenant = req.session.tenant || null;
  res.locals.flash = {
    success: req.flash('success'),
    error: req.flash('error'),
    info: req.flash('info')
  };
  res.locals.APP_NAME = process.env.APP_NAME || 'Ardthon Billing System';
  res.locals.APP_URL = process.env.APP_URL || '';
  res.locals.currentPath = req.path;
  next();
});

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    name: process.env.APP_NAME,
    time: new Date().toISOString(),
    env: process.env.NODE_ENV
  });
});


// ── Routes ──
// ── Portal (public, no admin auth) ──
const tenantResolver = require('./middleware/tenantResolver');
app.use(tenantResolver);
app.use('/', require('./routes/portal'));

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/tenants'));
app.use('/', require('./routes/users'));
app.use('/', require('./routes/plans'));
app.use('/', require('./routes/subscribers'));
app.use('/', require('./routes/payments'));
app.use('/', require('./routes/routers'));

// ── Root redirect ──
app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).send('404 — Not Found');
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  console.error(err.stack);
  res.status(500).send('Internal Server Error');
});

// ── Start ──

// ═══════════════════════════════════════════════════════════
// EXPIRY CRON
// Every 5 minutes, mark expired subscribers
// ═══════════════════════════════════════════════════════════
const expiryService = require('./services/expiryService');

setInterval(async () => {
  try {
    const result = await expiryService.expireSubscribers();
    if (result.processed > 0) {
      console.log('[Expiry Cron] Processed ' + result.processed + ' expired subscriber(s)');
    }
  } catch (err) {
    console.error('[Expiry Cron] Error:', err.message);
  }
}, 5 * 60 * 1000); // 5 minutes

// Also run once ~30s after startup (catch any expired subs from downtime)
setTimeout(async () => {
  try {
    const result = await expiryService.expireSubscribers();
    if (result.processed > 0) {
      console.log('[Expiry Cron] Startup catch-up: ' + result.processed + ' expired');
    }
  } catch (err) {
    console.error('[Expiry Cron] Startup error:', err.message);
  }
}, 30 * 1000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ABS] Listening on port ${PORT}`);
  console.log(`[ABS] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[ABS] App URL: ${process.env.APP_URL}`);
});

module.exports = app;

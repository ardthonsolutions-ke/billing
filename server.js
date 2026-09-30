require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');

// ── Config ──
const db = require('./config/database');
const sessionConfig = require('./config/session');
const CONSTANTS = require('./config/constants');

// ── App ──
const app = express();
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
app.use(session(sessionConfig));
app.use(flash());

// ── Static ──
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// ── Views ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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

// ── Root redirect (placeholder until auth is built) ──
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>Ardthon Billing System</title>
    <style>body{font-family:system-ui;max-width:700px;margin:60px auto;padding:20px;color:#14171f;}
    h1{color:#1a4a8a;}code{background:#f1efea;padding:2px 6px;border-radius:4px;}
    .card{background:#f8f7f4;padding:24px;border-radius:12px;border:1px solid #e4e1d8;margin:20px 0;}</style>
    </head><body>
    <h1>Ardthon Billing System</h1>
    <p>Foundation is running. Modules are being built in phases.</p>
    <div class="card">
      <h3>Status</h3>
      <ul>
        <li>App: <strong>online</strong> at port ${PORT}</li>
        <li>Health check: <a href="/health">/health</a></li>
        <li>Environment: <code>${process.env.NODE_ENV || 'development'}</code></li>
      </ul>
    </div>
    <p>Next up: authentication, tenants, and dashboard.</p>
    </body></html>
  `);
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ABS] Listening on port ${PORT}`);
  console.log(`[ABS] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[ABS] App URL: ${process.env.APP_URL}`);
});

module.exports = app;

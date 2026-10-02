const express = require('express');

const router = express.Router();
const bcrypt = require('bcryptjs');
const { requireSubscriber, requireGuestSubscriber, portalPath } = require('../middleware/subscriberAuth');

// Helper: require a resolved tenant for portal routes
function ensureTenant(req, res, next) {
  if (!req.tenant) {
    return res.status(404).render('portal/no-tenant', {
      layout: false,
      tenant: null,
      slug: req.tenantSlug
    });
  }
  next();
}

// ─── Root: /portal → login or dashboard ───
router.get('/portal', ensureTenant, (req, res) => {
  if (req.session && req.session.subscriber && req.session.subscriber.tenant_id === req.tenant.id) {
    return res.redirect(portalPath(req, '/dashboard'));
  }
  res.redirect(portalPath(req, '/login'));
});

// ─── Login form ───
router.get('/portal/login', ensureTenant, requireGuestSubscriber, (req, res) => {
  res.render('portal/login', {
    layout: false,
    tenant: req.tenant,
    title: 'Sign In'
  });
});

// ─── Login POST ───
router.post('/portal/login', ensureTenant, requireGuestSubscriber, async (req, res) => {
  const { identifier, password } = req.body;
  const t = req.tenant;

  if (!identifier || !password) {
    req.flash('error', 'Phone/username and password are required.');
    return res.redirect(portalPath(req, '/login'));
  }

  try {
    const [rows] = await req.db.query(
      `SELECT * FROM subscribers
       WHERE tenant_id = ?
         AND (phone = ? OR username = ? OR account_number = ?)
       LIMIT 1`,
      [t.id, identifier.trim(), identifier.trim(), identifier.trim()]
    );

    if (!rows.length) {
      req.flash('error', 'Account not found.');
      return res.redirect(portalPath(req, '/login'));
    }

    const sub = rows[0];

    if (!sub.password_plain || sub.password_plain !== password) {
      req.flash('error', 'Invalid credentials.');
      return res.redirect(portalPath(req, '/login'));
    }

    // Set subscriber session
    req.session.subscriber = {
      id: sub.id,
      tenant_id: sub.tenant_id,
      username: sub.username,
      full_name: sub.full_name,
      phone: sub.phone
    };

    // Update last login
    await req.db.query(
      'UPDATE subscribers SET last_login_at = NOW(), login_count = login_count + 1 WHERE id = ?',
      [sub.id]
    );

    req.flash('success', 'Welcome, ' + sub.full_name + '!');
    res.redirect(portalPath(req, '/dashboard'));
  } catch (err) {
    console.error('[Portal] login error:', err.message);
    req.flash('error', 'Login failed. Try again.');
    res.redirect(portalPath(req, '/login'));
  }
});

// ─── Logout ───
router.get('/portal/logout', (req, res) => {
  const slug = req.tenantSlug;
  if (req.session) req.session.subscriber = null;
  const dest = slug ? '/t/' + slug + '/portal/login' : '/portal/login';
  res.redirect(dest);
});

// ─── Dashboard ───
router.get('/portal/dashboard', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;

  const [rows] = await req.db.query(`
    SELECT s.*, p.name AS plan_name, p.price AS plan_price, p.duration_hours,
           p.data_cap_mb, p.speed_down_kbps, p.speed_up_kbps
    FROM subscribers s
    LEFT JOIN plans p ON s.plan_id = p.id
    WHERE s.id = ?
  `, [sid]);

  if (!rows.length) {
    req.session.subscriber = null;
    return res.redirect(portalPath(req, '/login'));
  }

  const subscriber = rows[0];

  // Recent payments
  const [payments] = await req.db.query(
    `SELECT id, amount, method, status, reference, created_at, completed_at
     FROM payments
     WHERE subscriber_id = ?
     ORDER BY created_at DESC
     LIMIT 5`,
    [sid]
  );

  res.render('portal/dashboard', {
    layout: false,
    title: 'Dashboard',
    tenant: req.tenant,
    subscriber,
    payments
  });
});

// ─── Plans ───
router.get('/portal/plans', ensureTenant, requireSubscriber, async (req, res) => {
  const [plans] = await req.db.query(
    `SELECT id, name, type, price, duration_hours, data_cap_mb,
            speed_down_kbps, speed_up_kbps, description
     FROM plans
     WHERE tenant_id = ? AND is_active = 1
     ORDER BY sort_order, price`,
    [req.tenant.id]
  );

  res.render('portal/plans', {
    subscriber: req.session.subscriber,
    layout: false,
    title: 'Plans',
    tenant: req.tenant,
    plans
  });
});

// ─── Buy page ───
router.get('/portal/buy/:planId', ensureTenant, requireSubscriber, async (req, res) => {
  const [plans] = await req.db.query(
    `SELECT * FROM plans WHERE id = ? AND tenant_id = ? AND is_active = 1`,
    [req.params.planId, req.tenant.id]
  );
  if (!plans.length) {
    req.flash('error', 'Plan not found.');
    return res.redirect(portalPath(req, '/plans'));
  }

  const [subs] = await req.db.query(
    'SELECT * FROM subscribers WHERE id = ?',
    [req.session.subscriber.id]
  );

  res.render('portal/buy', {
    layout: false,
    title: 'Buy ' + plans[0].name,
    tenant: req.tenant,
    plan: plans[0],
    subscriber: subs[0]
  });
});

// ─── Buy POST — creates pending payment ───
router.post('/portal/buy/:planId', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;

  const [plans] = await req.db.query(
    `SELECT * FROM plans WHERE id = ? AND tenant_id = ? AND is_active = 1`,
    [req.params.planId, req.tenant.id]
  );
  if (!plans.length) {
    req.flash('error', 'Plan not found.');
    return res.redirect(portalPath(req, '/plans'));
  }

  const plan = plans[0];

  try {
    const [result] = await req.db.query(
      `INSERT INTO payments
        (tenant_id, subscriber_id, plan_id, amount, method, status, reference)
       VALUES (?, ?, ?, ?, 'manual', 'pending', ?)`,
      [req.tenant.id, sid, plan.id, plan.price, 'PLAN-' + plan.id + '-SUB-' + sid + '-' + Date.now()]
    );

    await req.db.query(
      'INSERT INTO subscriber_events (tenant_id, subscriber_id, event_type, details) VALUES (?, ?, ?, ?)',
      [req.tenant.id, sid, 'payment_requested', JSON.stringify({ plan_id: plan.id, amount: plan.price, payment_id: result.insertId })]
    );

    req.flash('info', 'Payment request created. Complete payment at the ISP office or via M-PESA when enabled.');
    res.redirect(portalPath(req, '/history'));
  } catch (err) {
    console.error('[Portal] buy error:', err.message);
    req.flash('error', 'Failed to create payment request.');
    res.redirect(portalPath(req, '/plans'));
  }
});

// ─── History ───
router.get('/portal/history', ensureTenant, requireSubscriber, async (req, res) => {
  const [payments] = await req.db.query(
    `SELECT pay.id, pay.amount, pay.method, pay.status, pay.reference,
            pay.mpesa_receipt, pay.created_at, pay.completed_at,
            p.name AS plan_name
     FROM payments pay
     LEFT JOIN plans p ON pay.plan_id = p.id
     WHERE pay.subscriber_id = ?
     ORDER BY pay.created_at DESC
     LIMIT 50`,
    [req.session.subscriber.id]
  );

  res.render('portal/history', {
    subscriber: req.session.subscriber,
    layout: false,
    title: 'Payment History',
    tenant: req.tenant,
    payments
  });
});

// ─── No tenant (fallback page) ───
router.get('/portal/no-tenant', (req, res) => {
  res.status(404).render('portal/no-tenant', { layout: false, tenant: null, slug: null });
});

module.exports = router;

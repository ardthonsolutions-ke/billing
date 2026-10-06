const express = require('express');

const router = express.Router();
const bcrypt = require('bcryptjs');
const { requireSubscriber, requireGuestSubscriber, portalPath } = require('../middleware/subscriberAuth');

// Compute the base URL for the current portal request
function portalBase(req) {
  if (req.tenantSlug) return '/t/' + req.tenantSlug + '/portal';
  return '/portal';
}

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
    portalBase: portalBase(req),
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
    portalBase: portalBase(req),
    layout: false,
    title: 'Dashboard',
    tenant: req.tenant,
    subscriber,
    payments,
    connection: subscriber,
    currentPath: portalBase(req) + '/dashboard'
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
    portalBase: portalBase(req),
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
    portalBase: portalBase(req),
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
    portalBase: portalBase(req),
    subscriber: req.session.subscriber,
    layout: false,
    title: 'Payment History',
    tenant: req.tenant,
    payments,
    currentPath: portalBase(req) + '/history'
  });
});

// ─── No tenant (fallback page) ───


// ═══════════════════════════════════════════════════════════
// SUBSCRIBER CONNECTION / PPPoE SELF-SERVICE
// ═══════════════════════════════════════════════════════════

// ─── Connection dashboard ───
router.get('/portal/network', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;

  const [rows] = await req.db.query(`
    SELECT s.*, p.name AS plan_name, p.price AS plan_price, p.duration_hours,
           p.data_cap_mb, p.speed_down_kbps, p.speed_up_kbps,
           r.id AS router_id, r.name AS router_name, r.host AS router_host,
           r.port AS router_port, r.username AS router_user, r.password_encrypted AS router_pass,
           r.site_name, r.status AS router_status
    FROM subscribers s
    LEFT JOIN plans p ON s.plan_id = p.id
    LEFT JOIN routers r ON s.router_id = r.id
    WHERE s.id = ?
  `, [sid]);

  if (!rows.length) {
    req.session.subscriber = null;
    return res.redirect(portalPath(req, '/login'));
  }

  const subscriber = rows[0];

  // Attempt to fetch live PPPoE status if this is a PPPoE subscriber and router is set
  let pppoeStatus = null;
  let pppoeError = null;

  if (subscriber.type === 'pppoe' && subscriber.router_id && subscriber.router_pass) {
    try {
      const mikrotik = require('../services/mikrotikService');
      const result = await mikrotik.getPppoeStatus(
        {
          host: subscriber.router_host,
          port: subscriber.router_port,
          username: subscriber.router_user,
          password_encrypted: subscriber.router_pass
        },
        subscriber.username
      );
      if (result.ok) {
        pppoeStatus = result;
      } else {
        pppoeError = result.error;
      }
    } catch (e) {
      pppoeError = e.message;
    }
  }

  // Recent events for this subscriber
  const [events] = await req.db.query(
    `SELECT event_type, details, created_at
     FROM subscriber_events
     WHERE subscriber_id = ?
     ORDER BY created_at DESC
     LIMIT 10`,
    [sid]
  );

  res.render('portal/network', {
    layout: false,
    title: 'My Connection',
    tenant: req.tenant,
    subscriber: req.session.subscriber,
    portalBase: portalBase(req),
    connection: subscriber,
    pppoeStatus,
    pppoeError,
    events
  });
});

// ─── Change PPPoE password form ───
router.get('/portal/network/change-password', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;

  const [rows] = await req.db.query(
    `SELECT s.type, s.username, r.id AS router_id, r.name AS router_name
     FROM subscribers s
     LEFT JOIN routers r ON s.router_id = r.id
     WHERE s.id = ?`,
    [sid]
  );

  if (!rows.length) return res.redirect(portalPath(req, '/login'));

  const s = rows[0];
  const canChange = s.type === 'pppoe' && s.router_id;

  res.render('portal/network-change-pass', {
    layout: false,
    title: 'Change Password',
    tenant: req.tenant,
    subscriber: req.session.subscriber,
    portalBase: portalBase(req),
    connection: s,
    canChange
  });
});

// ─── Handle password change ───
router.post('/portal/network/change-password', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    req.flash('error', 'All fields required.');
    return res.redirect(portalBase(req) + '/network/change-password');
  }

  if (new_password !== confirm_password) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect(portalBase(req) + '/network/change-password');
  }

  if (new_password.length < 6) {
    req.flash('error', 'Password must be at least 6 characters.');
    return res.redirect(portalBase(req) + '/network/change-password');
  }

  try {
    const [rows] = await req.db.query(`
      SELECT s.id, s.type, s.username, s.password_plain,
             r.host AS router_host, r.port AS router_port,
             r.username AS router_user, r.password_encrypted AS router_pass
      FROM subscribers s
      LEFT JOIN routers r ON s.router_id = r.id
      WHERE s.id = ?
    `, [sid]);

    if (!rows.length) return res.redirect(portalPath(req, '/login'));
    const sub = rows[0];

    if (sub.type !== 'pppoe') {
      req.flash('error', 'Password change is only available for PPPoE accounts.');
      return res.redirect(portalBase(req) + '/network');
    }

    if (!sub.router_host) {
      req.flash('error', 'Your account is not linked to a router. Contact support.');
      return res.redirect(portalBase(req) + '/network');
    }

    // Verify current password matches what we have stored
    if (sub.password_plain !== current_password) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect(portalBase(req) + '/network/change-password');
    }

    // Push the new password to the router
    const mikrotik = require('../services/mikrotikService');
    const result = await mikrotik.changePppoeSecret(
      {
        host: sub.router_host,
        port: sub.router_port,
        username: sub.router_user,
        password_encrypted: sub.router_pass
      },
      sub.username,
      new_password
    );

    if (!result.ok) {
      console.error('[Portal Network] Router update failed:', result.error);
      req.flash('error', 'Could not update on the router. Contact support. (' + result.error + ')');
      return res.redirect(portalBase(req) + '/network/change-password');
    }

    // Update local DB
    await req.db.query(
      'UPDATE subscribers SET password_plain = ? WHERE id = ?',
      [new_password, sid]
    );

    // Log event
    try {
      await req.db.query(
        `INSERT INTO subscriber_events (tenant_id, subscriber_id, event_type, details)
         VALUES (?, ?, 'pppoe_password_changed', ?)`,
        [req.tenant.id, sid, JSON.stringify({ via: 'self_service', disconnected: result.disconnected })]
      );
    } catch (e) { /* silent */ }

    req.flash('success', 'Password updated. Your connection will reconnect in a few seconds.');
    res.redirect(portalBase(req) + '/network');
  } catch (err) {
    console.error('[Portal Network] change-password error:', err.message);
    req.flash('error', 'Failed: ' + err.message);
    res.redirect(portalBase(req) + '/network/change-password');
  }
});

// ─── Force reconnect (disconnect PPPoE session) ───
router.post('/portal/network/reconnect', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;

  try {
    const [rows] = await req.db.query(`
      SELECT s.username, s.type,
             r.host AS router_host, r.port AS router_port,
             r.username AS router_user, r.password_encrypted AS router_pass
      FROM subscribers s
      LEFT JOIN routers r ON s.router_id = r.id
      WHERE s.id = ?
    `, [sid]);

    if (!rows.length) return res.redirect(portalPath(req, '/login'));
    const sub = rows[0];

    if (sub.type !== 'pppoe' || !sub.router_host) {
      req.flash('error', 'Reconnect is only available for PPPoE accounts linked to a router.');
      return res.redirect(portalBase(req) + '/network');
    }

    const mikrotik = require('../services/mikrotikService');
    const result = await mikrotik.disconnectPppoeSession(
      {
        host: sub.router_host,
        port: sub.router_port,
        username: sub.router_user,
        password_encrypted: sub.router_pass
      },
      sub.username
    );

    if (!result.ok) {
      req.flash('error', 'Reconnect failed: ' + result.error);
      return res.redirect(portalBase(req) + '/network');
    }

    try {
      await req.db.query(
        `INSERT INTO subscriber_events (tenant_id, subscriber_id, event_type, details)
         VALUES (?, ?, 'reconnect_requested', ?)`,
        [req.tenant.id, sid, JSON.stringify({ disconnected: result.disconnected })]
      );
    } catch (e) { /* silent */ }

    req.flash('success', 'Reconnect signal sent. Your router will dial again in a few seconds.');
    res.redirect(portalBase(req) + '/network');
  } catch (err) {
    console.error('[Portal Network] reconnect error:', err.message);
    req.flash('error', 'Failed: ' + err.message);
    res.redirect(portalBase(req) + '/network');
  }
});
// ═══════════════════════════════════════════════════════════
// SUBSCRIBER TICKETS
// ═══════════════════════════════════════════════════════════

// ─── List my tickets ───
router.get('/portal/tickets', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;

  const [tickets] = await req.db.query(`
    SELECT id, ticket_number, subject, category, priority, status,
           created_at, updated_at
    FROM tickets
    WHERE subscriber_id = ?
    ORDER BY updated_at DESC
    LIMIT 100
  `, [sid]);

  res.render('portal/tickets', {
    layout: false,
    title: 'Support',
    tenant: req.tenant,
    subscriber: req.session.subscriber,
    portalBase: portalBase(req),
    tickets
  });
});

// ─── New ticket form ───
router.get('/portal/tickets/new', ensureTenant, requireSubscriber, (req, res) => {
  res.render('portal/ticket-new', {
    layout: false,
    title: 'New Support Request',
    tenant: req.tenant,
    subscriber: req.session.subscriber,
    portalBase: portalBase(req)
  });
});

// ─── Create ticket ───
router.post('/portal/tickets/new', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;
  const tenantId = req.tenant.id;
  const { subject, category, message } = req.body;

  if (!subject || !subject.trim()) {
    req.flash('error', 'Subject is required.');
    return res.redirect(portalBase(req) + '/tickets/new');
  }

  try {
    // Generate ticket number
    const ym = new Date().toISOString().slice(0,7).replace('-', '');
    const [c] = await req.db.query(
      "SELECT COUNT(*) + 1 AS n FROM tickets WHERE tenant_id = ? AND ticket_number LIKE ?",
      [tenantId, 'TKT-' + ym + '-%']
    );
    const ticketNumber = 'TKT-' + ym + '-' + String(c[0].n).padStart(4, '0');

    // Get subscriber details for contact info
    const [subs] = await req.db.query(
      'SELECT full_name, phone, email FROM subscribers WHERE id = ?',
      [sid]
    );
    const sub = subs[0];

    const [result] = await req.db.query(
      `INSERT INTO tickets
        (tenant_id, subscriber_id, ticket_number, subject, category, priority,
         contact_name, contact_phone, contact_email, created_by)
       VALUES (?, ?, ?, ?, ?, 'normal', ?, ?, ?, NULL)`,
      [tenantId, sid, ticketNumber, subject.trim(), category || 'general',
       sub.full_name, sub.phone, sub.email || null]
    );

    // Initial message
    if (message && message.trim()) {
      await req.db.query(
        `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, sender_name, body)
         VALUES (?, 'subscriber', ?, ?, ?)`,
        [result.insertId, sid, sub.full_name, message.trim()]
      );
    }

    req.flash('success', 'Ticket ' + ticketNumber + ' opened. Our team will respond shortly.');
    res.redirect(portalBase(req) + '/tickets/' + result.insertId);
  } catch (err) {
    console.error('[Portal Tickets] create error:', err.message);
    req.flash('error', 'Failed to open ticket. Please try again.');
    res.redirect(portalBase(req) + '/tickets/new');
  }
});

// ─── View ticket + thread ───
router.get('/portal/tickets/:id', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;

  const [rows] = await req.db.query(
    `SELECT * FROM tickets WHERE id = ? AND subscriber_id = ?`,
    [req.params.id, sid]
  );
  if (!rows.length) {
    req.flash('error', 'Ticket not found.');
    return res.redirect(portalBase(req) + '/tickets');
  }

  // Only show non-internal messages to subscriber
  const [messages] = await req.db.query(
    `SELECT id, sender_type, sender_name, body, created_at
     FROM ticket_messages
     WHERE ticket_id = ? AND is_internal = 0
     ORDER BY created_at`,
    [req.params.id]
  );

  res.render('portal/ticket-detail', {
    layout: false,
    title: 'Ticket ' + rows[0].ticket_number,
    tenant: req.tenant,
    subscriber: req.session.subscriber,
    portalBase: portalBase(req),
    ticket: rows[0],
    messages
  });
});

// ─── Reply to ticket ───
router.post('/portal/tickets/:id/reply', ensureTenant, requireSubscriber, async (req, res) => {
  const sid = req.session.subscriber.id;
  const { body } = req.body;

  if (!body || !body.trim()) {
    req.flash('error', 'Message cannot be empty.');
    return res.redirect(portalBase(req) + '/tickets/' + req.params.id);
  }

  try {
    // Verify ownership
    const [rows] = await req.db.query(
      'SELECT id, status FROM tickets WHERE id = ? AND subscriber_id = ?',
      [req.params.id, sid]
    );
    if (!rows.length) {
      req.flash('error', 'Ticket not found.');
      return res.redirect(portalBase(req) + '/tickets');
    }

    if (rows[0].status === 'closed') {
      req.flash('error', 'This ticket is closed. Please open a new one.');
      return res.redirect(portalBase(req) + '/tickets/' + req.params.id);
    }

    const subName = req.session.subscriber.full_name;

    await req.db.query(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, sender_name, body)
       VALUES (?, 'subscriber', ?, ?, ?)`,
      [req.params.id, sid, subName, body.trim()]
    );

    // Move status back to open if it was resolved
    if (rows[0].status === 'resolved' || rows[0].status === 'pending') {
      await req.db.query(
        "UPDATE tickets SET status = 'open', updated_at = NOW() WHERE id = ?",
        [req.params.id]
      );
    } else {
      await req.db.query(
        'UPDATE tickets SET updated_at = NOW() WHERE id = ?',
        [req.params.id]
      );
    }

    req.flash('success', 'Reply sent.');
    res.redirect(portalBase(req) + '/tickets/' + req.params.id);
  } catch (err) {
    console.error('[Portal Tickets] reply error:', err.message);
    req.flash('error', 'Failed to send reply.');
    res.redirect(portalBase(req) + '/tickets/' + req.params.id);
  }
});
router.get('/portal/no-tenant', (req, res) => {
  res.status(404).render('portal/no-tenant', { layout: false, tenant: null, slug: null });
});

module.exports = router;

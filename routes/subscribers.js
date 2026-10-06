const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function tenantId(req) {
  const u = req.session.user;
  return u.role === 'super_admin' && req.query.tenant ? req.query.tenant : u.tenant_id;
}

// List with search + filter
router.get('/subscribers', async (req, res) => {
  const u = req.session.user;
  const tFilter = u.role === 'super_admin' ? '' : 'AND s.tenant_id = ' + req.db.escape(u.tenant_id);
  const search = (req.query.q || '').trim();
  const status = req.query.status || '';
  const type = req.query.type || '';

  let where = '1=1 ' + tFilter;
  const params = [];

  if (search) {
    where += ' AND (s.full_name LIKE ? OR s.phone LIKE ? OR s.username LIKE ? OR s.account_number LIKE ?)';
    const like = '%' + search + '%';
    params.push(like, like, like, like);
  }
  if (status) { where += ' AND s.status = ?'; params.push(status); }
  if (type)   { where += ' AND s.type = ?';   params.push(type); }

  const [subscribers] = await req.db.query(`
    SELECT s.*, p.name AS plan_name, p.price AS plan_price, r.name AS router_name
    FROM subscribers s
    LEFT JOIN plans p ON s.plan_id = p.id
    LEFT JOIN routers r ON s.router_id = r.id
    WHERE ${where}
    ORDER BY s.created_at DESC
    LIMIT 200
  `, params);

  res.render('subscribers/index', {
    title: 'Subscribers',
    layout: 'layouts/dashboard',
    subscribers,
    search,
    filterStatus: status,
    filterType: type
  });
});

// New form
router.get('/subscribers/new', async (req, res) => {
  const u = req.session.user;
  const tId = u.tenant_id || 0;
  const [plans] = await req.db.query('SELECT id, name, type, price FROM plans WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order, name', [tId]);
  const [routers] = await req.db.query('SELECT id, name FROM routers WHERE tenant_id = ? AND is_active = 1 ORDER BY name', [tId]);
  res.render('subscribers/form', {
    title: 'New Subscriber',
    layout: 'layouts/dashboard',
    subscriber: null,
    plans,
    routers
  });
});

// Create
router.post('/subscribers', async (req, res) => {
  const u = req.session.user;
  const tId = u.tenant_id;
  if (!tId) {
    req.flash('error', 'You must belong to a tenant to add subscribers.');
    return res.redirect('/subscribers');
  }

  const { full_name, phone, email, type, plan_id, router_id, username, password_plain, mac_address, notes } = req.body;

  // Generate account number if not provided
  let account_number = req.body.account_number;
  if (!account_number) {
    const [r] = await req.db.query('SELECT COUNT(*) + 1 AS n FROM subscribers WHERE tenant_id = ?', [tId]);
    account_number = 'S' + String(r[0].n).padStart(5, '0');
  }

  try {
    const [result] = await req.db.query(
      `INSERT INTO subscribers
        (tenant_id, account_number, full_name, phone, email, type, plan_id, router_id,
         username, password_plain, mac_address, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [tId, account_number, full_name, phone, email || null, type,
       plan_id || null, router_id || null,
       username, password_plain || null, mac_address || null,
       notes || null, u.id]
    );

    await req.db.query(
      'INSERT INTO subscriber_events (tenant_id, subscriber_id, event_type, details) VALUES (?, ?, ?, ?)',
      [tId, result.insertId, 'created', JSON.stringify({ by_user: u.id })]
    );

    req.flash('success', 'Subscriber created: ' + account_number);
    res.redirect('/subscribers/' + result.insertId);
  } catch (err) {
    console.error('[Subscribers] create error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'That username or account number already exists.');
    } else {
      req.flash('error', 'Failed to create subscriber: ' + err.message);
    }
    res.redirect('/subscribers/new');
  }
});

// Detail page
router.get('/subscribers/:id', async (req, res) => {
  const [rows] = await req.db.query(`
    SELECT s.*, p.name AS plan_name, p.price AS plan_price, p.duration_hours, p.data_cap_mb,
           r.name AS router_name, r.host AS router_host
    FROM subscribers s
    LEFT JOIN plans p ON s.plan_id = p.id
    LEFT JOIN routers r ON s.router_id = r.id
    WHERE s.id = ?
  `, [req.params.id]);
  if (!rows.length) { req.flash('error', 'Subscriber not found.'); return res.redirect('/subscribers'); }

  const [events] = await req.db.query(
    'SELECT * FROM subscriber_events WHERE subscriber_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.params.id]
  );

  const [payments] = await req.db.query(
    `SELECT id, amount, currency, status, method, created_at, completed_at
     FROM payments WHERE subscriber_id = ? ORDER BY created_at DESC LIMIT 50`,
    [req.params.id]
  );

  const [tickets] = await req.db.query(
    `SELECT id, subject, status, priority, created_at
     FROM tickets WHERE subscriber_id = ? ORDER BY created_at DESC LIMIT 50`,
    [req.params.id]
  );

  const timeline = [];
  events.forEach(function (e) {
    let body = '';
    try {
      const d = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
      if (d && Object.keys(d).length) body = JSON.stringify(d);
    } catch (_) {}
    timeline.push({
      kind: 'event',
      ts: e.created_at,
      title: e.event_type,
      body: body,
      link: null
    });
  });

  payments.forEach(function (p) {
    timeline.push({
      kind: 'payment',
      ts: p.completed_at || p.created_at,
      title: 'Payment ' + p.status,
      body: (p.currency || 'KES') + ' ' + Number(p.amount).toLocaleString() + (p.method ? ' · ' + p.method : ''),
      link: '/payments/' + p.id
    });
  });

  tickets.forEach(function (t) {
    timeline.push({
      kind: 'ticket',
      ts: t.created_at,
      title: t.subject,
      body: 'Status: ' + t.status + (t.priority ? ' · ' + t.priority : ''),
      link: '/tickets/' + t.id
    });
  });
  timeline.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
  const topTimeline = timeline.slice(0, 60);

  res.render('subscribers/detail', {
    title: rows[0].full_name,
    layout: 'layouts/dashboard',
    subscriber: rows[0],
    events,
    timeline: topTimeline
  });
});

// Edit form
router.get('/subscribers/:id/edit', async (req, res) => {
  const u = req.session.user;
  const [rows] = await req.db.query('SELECT * FROM subscribers WHERE id = ?', [req.params.id]);
  if (!rows.length) { req.flash('error', 'Subscriber not found.'); return res.redirect('/subscribers'); }
  const [plans] = await req.db.query('SELECT id, name, type, price FROM plans WHERE tenant_id = ? AND is_active = 1 ORDER BY name', [rows[0].tenant_id]);
  const [routers] = await req.db.query('SELECT id, name FROM routers WHERE tenant_id = ? AND is_active = 1 ORDER BY name', [rows[0].tenant_id]);
  res.render('subscribers/form', {
    title: 'Edit Subscriber',
    layout: 'layouts/dashboard',
    subscriber: rows[0],
    plans,
    routers
  });
});

// Update
router.post('/subscribers/:id', async (req, res) => {
  const { full_name, phone, email, type, plan_id, router_id, username, password_plain, mac_address, notes } = req.body;
  try {
    await req.db.query(
      `UPDATE subscribers SET full_name=?, phone=?, email=?, type=?, plan_id=?, router_id=?,
       username=?, password_plain=?, mac_address=?, notes=? WHERE id=?`,
      [full_name, phone, email || null, type, plan_id || null, router_id || null,
       username, password_plain || null, mac_address || null, notes || null, req.params.id]
    );
    req.flash('success', 'Subscriber updated.');
    res.redirect('/subscribers/' + req.params.id);
  } catch (err) {
    console.error('[Subscribers] update error:', err.message);
    req.flash('error', 'Failed to update.');
    res.redirect('/subscribers/' + req.params.id + '/edit');
  }
});

// Activate
router.post('/subscribers/:id/activate', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT s.*, p.duration_hours FROM subscribers s
       LEFT JOIN plans p ON s.plan_id = p.id WHERE s.id = ?`,
      [req.params.id]
    );
    if (!rows.length) { req.flash('error', 'Not found.'); return res.redirect('/subscribers'); }

    const hours = rows[0].duration_hours || 24;
    await req.db.query(
      `UPDATE subscribers SET status='active', activated_at=NOW(),
       expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR) WHERE id = ?`,
      [hours, req.params.id]
    );
    await req.db.query(
      'INSERT INTO subscriber_events (tenant_id, subscriber_id, event_type, details) VALUES (?, ?, ?, ?)',
      [rows[0].tenant_id, req.params.id, 'activated', JSON.stringify({ hours })]
    );
    req.flash('success', 'Subscriber activated for ' + hours + ' hours.');
  } catch (err) {
    console.error('[Subscribers] activate error:', err.message);
    req.flash('error', 'Failed to activate.');
  }
  res.redirect('/subscribers/' + req.params.id);
});

// Suspend
router.post('/subscribers/:id/suspend', async (req, res) => {
  try {
    const [rows] = await req.db.query('SELECT tenant_id FROM subscribers WHERE id = ?', [req.params.id]);
    if (!rows.length) { req.flash('error', 'Not found.'); return res.redirect('/subscribers'); }
    await req.db.query("UPDATE subscribers SET status='suspended' WHERE id = ?", [req.params.id]);
    await req.db.query(
      'INSERT INTO subscriber_events (tenant_id, subscriber_id, event_type, details) VALUES (?, ?, ?, ?)',
      [rows[0].tenant_id, req.params.id, 'suspended', '{}']
    );
    req.flash('success', 'Subscriber suspended.');
  } catch (err) {
    req.flash('error', 'Failed to suspend.');
  }
  res.redirect('/subscribers/' + req.params.id);
});

module.exports = router;

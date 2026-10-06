const express = require('express');
const router = express.Router();
require('../middleware/wrapRouter')(router);
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function scope(user) {
  if (user.role === 'super_admin') return { clause: '', params: [] };
  return { clause: 'AND l.tenant_id = ?', params: [user.tenant_id] };
}

// ─── List ───
router.get('/leads', async (req, res) => {
  const user = req.session.user;
  const s = scope(user);
  const status = req.query.status || 'all';
  const search = (req.query.q || '').trim();

  let sql = `
    SELECT l.*, u.full_name AS assigned_name
    FROM leads l
    LEFT JOIN users u ON l.assigned_to = u.id
    WHERE 1=1 ${s.clause}
  `;
  const params = [...s.params];

  if (status !== 'all') { sql += ' AND l.status = ?'; params.push(status); }
  if (search) {
    sql += ' AND (l.full_name LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)';
    const like = '%' + search + '%';
    params.push(like, like, like);
  }

  sql += ' ORDER BY l.updated_at DESC LIMIT 200';

  const [leads] = await req.db.query(sql, params);

  // Counts
  const cWhere = user.role === 'super_admin' ? '' : 'WHERE tenant_id = ?';
  const cParams = user.role === 'super_admin' ? [] : [user.tenant_id];
  const [counts] = await req.db.query(`
    SELECT
      SUM(status='new') AS new_count,
      SUM(status='contacted') AS contacted_count,
      SUM(status='qualified') AS qualified_count,
      SUM(status='converted') AS converted_count,
      SUM(status='lost') AS lost_count
    FROM leads ${cWhere}
  `, cParams);

  res.render('leads/index', {
    title: 'Leads',
    layout: 'layouts/dashboard',
    leads,
    counts: counts[0] || {},
    filterStatus: status,
    search
  });
});

// ─── New form ───
router.get('/leads/new', (req, res) => {
  res.render('leads/form', {
    title: 'New Lead',
    layout: 'layouts/dashboard',
    lead: null
  });
});

// ─── Create ───
router.post('/leads', async (req, res) => {
  const user = req.session.user;
  const tenantId = user.tenant_id || 1;
  const { full_name, phone, email, location, source, interest, priority, notes, follow_up_at } = req.body;

  if (!full_name || !phone) {
    req.flash('error', 'Name and phone are required.');
    return res.redirect('/leads/new');
  }

  try {
    const [result] = await req.db.query(
      `INSERT INTO leads
        (tenant_id, full_name, phone, email, location, source, interest, priority, notes, follow_up_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, full_name, phone, email || null, location || null,
       source || 'walk-in', interest || null, priority || 'normal',
       notes || null, follow_up_at || null, user.id]
    );

    await req.db.query(
      'INSERT INTO lead_events (lead_id, event_type, user_id) VALUES (?, ?, ?)',
      [result.insertId, 'created', user.id]
    );

    req.flash('success', 'Lead "' + full_name + '" added.');
    res.redirect('/leads/' + result.insertId);
  } catch (err) {
    console.error('[Leads] create error:', err.message);
    req.flash('error', 'Failed to create lead.');
    res.redirect('/leads/new');
  }
});

// ─── Detail ───
router.get('/leads/:id', async (req, res) => {
  const user = req.session.user;
  const s = scope(user);

  const [rows] = await req.db.query(
    'SELECT l.*, u.full_name AS assigned_name FROM leads l LEFT JOIN users u ON l.assigned_to = u.id WHERE l.id = ? ' + s.clause,
    [req.params.id, ...s.params]
  );

  if (!rows.length) {
    req.flash('error', 'Lead not found.');
    return res.redirect('/leads');
  }

  const [events] = await req.db.query(
    'SELECT * FROM lead_events WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.params.id]
  );

  res.render('leads/detail', {
    title: 'Lead — ' + rows[0].full_name,
    layout: 'layouts/dashboard',
    lead: rows[0],
    events
  });
});

// ─── Update ───
router.post('/leads/:id', async (req, res) => {
  const user = req.session.user;
  const s = scope(user);
  const { status, notes, follow_up_at, priority } = req.body;

  try {
    // Verify ownership
    const [rows] = await req.db.query(
      'SELECT id, status AS old_status FROM leads l WHERE l.id = ? ' + s.clause,
      [req.params.id, ...s.params]
    );
    if (!rows.length) { req.flash('error', 'Not found.'); return res.redirect('/leads'); }

    await req.db.query(
      `UPDATE leads SET status = ?, notes = ?, follow_up_at = ?, priority = ?, updated_at = NOW() WHERE id = ?`,
      [status, notes || null, follow_up_at || null, priority || 'normal', req.params.id]
    );

    if (status && status !== rows[0].old_status) {
      await req.db.query(
        'INSERT INTO lead_events (lead_id, event_type, notes, user_id) VALUES (?, ?, ?, ?)',
        [req.params.id, 'status_changed', 'From ' + rows[0].old_status + ' to ' + status, user.id]
      );
    }

    req.flash('success', 'Lead updated.');
  } catch (err) {
    console.error('[Leads] update error:', err.message);
    req.flash('error', 'Update failed.');
  }
  res.redirect('/leads/' + req.params.id);
});

// ─── Quick status toggle ───
router.post('/leads/:id/status', async (req, res) => {
  const user = req.session.user;
  const s = scope(user);
  const { status } = req.body;

  try {
    await req.db.query(
      'UPDATE leads l SET status = ?, updated_at = NOW() WHERE l.id = ? ' + s.clause,
      [status, req.params.id, ...s.params]
    );
    await req.db.query(
      'INSERT INTO lead_events (lead_id, event_type, notes, user_id) VALUES (?, ?, ?, ?)',
      [req.params.id, 'status_changed', 'Changed to ' + status, user.id]
    );
    req.flash('success', 'Status updated.');
  } catch (err) {
    req.flash('error', 'Failed to update status.');
  }
  res.redirect('/leads/' + req.params.id);
});

// ─── Convert lead to subscriber ───
router.post('/leads/:id/convert', async (req, res) => {
  const user = req.session.user;
  const tenantId = user.tenant_id || 1;
  const s = scope(user);

  try {
    const [rows] = await req.db.query(
      'SELECT * FROM leads l WHERE l.id = ? ' + s.clause,
      [req.params.id, ...s.params]
    );
    if (!rows.length) { req.flash('error', 'Lead not found.'); return res.redirect('/leads'); }

    const lead = rows[0];

    // Generate account number
    const [c] = await req.db.query('SELECT COUNT(*) + 1 AS n FROM subscribers WHERE tenant_id = ?', [tenantId]);
    const accountNumber = 'S' + String(c[0].n).padStart(5, '0');

    const username = 'u' + Date.now().toString().slice(-8);

    const [result] = await req.db.query(
      `INSERT INTO subscribers
        (tenant_id, account_number, full_name, phone, email, type, username, password_plain, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'hotspot', ?, ?, 'pending', ?)`,
      [tenantId, accountNumber, lead.full_name, lead.phone, lead.email || null,
       username, username + '123', user.id]
    );

    await req.db.query(
      `UPDATE leads SET status = 'converted', converted_subscriber_id = ?, updated_at = NOW() WHERE id = ?`,
      [result.insertId, lead.id]
    );

    await req.db.query(
      'INSERT INTO lead_events (lead_id, event_type, notes, user_id) VALUES (?, ?, ?, ?)',
      [lead.id, 'converted', 'Subscriber #' + result.insertId + ' (' + accountNumber + ')', user.id]
    );

    req.flash('success', 'Lead converted to subscriber ' + accountNumber + '.');
    res.redirect('/subscribers/' + result.insertId);
  } catch (err) {
    console.error('[Leads] convert error:', err.message);
    req.flash('error', 'Conversion failed: ' + err.message);
    res.redirect('/leads/' + req.params.id);
  }
});

module.exports = router;

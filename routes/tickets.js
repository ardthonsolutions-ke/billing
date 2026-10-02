const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function scope(user) {
  if (user.role === 'super_admin') return { clause: '', params: [] };
  return { clause: 'AND t.tenant_id = ?', params: [user.tenant_id] };
}

// Generate ticket number like TKT-202610-0001
async function generateTicketNumber(db, tenantId) {
  const ym = new Date().toISOString().slice(0,7).replace('-', '');
  const [rows] = await db.query(
    "SELECT COUNT(*) + 1 AS n FROM tickets WHERE tenant_id = ? AND ticket_number LIKE ?",
    [tenantId, 'TKT-' + ym + '-%']
  );
  return 'TKT-' + ym + '-' + String(rows[0].n).padStart(4, '0');
}

// ─── List ───
router.get('/tickets', async (req, res) => {
  const user = req.session.user;
  const s = scope(user);
  const status = req.query.status || 'open';
  const priority = req.query.priority || '';
  const search = (req.query.q || '').trim();

  let sql = `
    SELECT t.id, t.ticket_number, t.subject, t.category, t.priority, t.status,
           t.created_at, t.updated_at,
           s.full_name AS subscriber_name, s.phone AS subscriber_phone,
           s.account_number
    FROM tickets t
    LEFT JOIN subscribers s ON t.subscriber_id = s.id
    WHERE 1=1 ${s.clause}
  `;
  const params = [...s.params];

  if (status !== 'all') { sql += ' AND t.status = ?'; params.push(status); }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority); }
  if (search) {
    sql += ' AND (t.subject LIKE ? OR t.ticket_number LIKE ? OR s.full_name LIKE ? OR s.phone LIKE ?)';
    const like = '%' + search + '%';
    params.push(like, like, like, like);
  }

  sql += ' ORDER BY t.updated_at DESC LIMIT 200';

  const [tickets] = await req.db.query(sql, params);

  // Counts
  const countWhere = user.role === 'super_admin' ? '' : 'WHERE tenant_id = ?';
  const countParams = user.role === 'super_admin' ? [] : [user.tenant_id];
  const [counts] = await req.db.query(`
    SELECT
      SUM(status='open') AS open_count,
      SUM(status='pending') AS pending_count,
      SUM(status='resolved') AS resolved_count,
      SUM(priority IN ('high','urgent') AND status IN ('open','pending')) AS urgent_count
    FROM tickets ${countWhere}
  `, countParams);

  res.render('tickets/index', {
    title: 'Support Tickets',
    layout: 'layouts/dashboard',
    tickets,
    counts: counts[0] || {},
    filterStatus: status,
    filterPriority: priority,
    search
  });
});

// ─── New form ───
router.get('/tickets/new', async (req, res) => {
  const user = req.session.user;
  const tenantId = user.tenant_id || 1;

  const [subs] = await req.db.query(
    'SELECT id, full_name, phone, account_number FROM subscribers WHERE tenant_id = ? ORDER BY full_name LIMIT 500',
    [tenantId]
  );

  res.render('tickets/form', {
    title: 'New Ticket',
    layout: 'layouts/dashboard',
    ticket: null,
    subscribers: subs
  });
});

// ─── Create ───
router.post('/tickets', async (req, res) => {
  const user = req.session.user;
  const tenantId = user.tenant_id || 1;

  const { subscriber_id, subject, category, priority, contact_name, contact_phone, contact_email, message } = req.body;

  if (!subject) {
    req.flash('error', 'Subject is required.');
    return res.redirect('/tickets/new');
  }

  try {
    const ticketNumber = await generateTicketNumber(req.db, tenantId);

    const [result] = await req.db.query(
      `INSERT INTO tickets
        (tenant_id, subscriber_id, ticket_number, subject, category, priority,
         contact_name, contact_phone, contact_email, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, subscriber_id || null, ticketNumber, subject, category || 'general',
       priority || 'normal', contact_name || null, contact_phone || null,
       contact_email || null, user.id]
    );

    if (message) {
      await req.db.query(
        `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, sender_name, body)
         VALUES (?, 'staff', ?, ?, ?)`,
        [result.insertId, user.id, user.full_name, message]
      );
    }

    req.flash('success', 'Ticket ' + ticketNumber + ' created.');
    res.redirect('/tickets/' + result.insertId);
  } catch (err) {
    console.error('[Tickets] create error:', err.message);
    req.flash('error', 'Failed to create ticket.');
    res.redirect('/tickets/new');
  }
});

// ─── Detail ───
router.get('/tickets/:id', async (req, res) => {
  const user = req.session.user;
  const s = scope(user);

  const [rows] = await req.db.query(`
    SELECT t.*, sb.full_name AS subscriber_name, sb.phone AS subscriber_phone,
           sb.account_number, sb.id AS sub_id
    FROM tickets t
    LEFT JOIN subscribers sb ON t.subscriber_id = sb.id
    WHERE t.id = ? ${s.clause}
  `, [req.params.id, ...s.params]);

  if (!rows.length) {
    req.flash('error', 'Ticket not found.');
    return res.redirect('/tickets');
  }

  const [messages] = await req.db.query(
    'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at',
    [req.params.id]
  );

  res.render('tickets/detail', {
    title: 'Ticket ' + rows[0].ticket_number,
    layout: 'layouts/dashboard',
    ticket: rows[0],
    messages
  });
});

// ─── Reply ───
router.post('/tickets/:id/reply', async (req, res) => {
  const user = req.session.user;
  const { body, is_internal, new_status } = req.body;

  if (!body || !body.trim()) {
    req.flash('error', 'Message body required.');
    return res.redirect('/tickets/' + req.params.id);
  }

  try {
    // Verify ticket belongs to user's tenant
    const s = scope(user);
    const [rows] = await req.db.query(
      'SELECT id FROM tickets t WHERE t.id = ? ' + s.clause,
      [req.params.id, ...s.params]
    );
    if (!rows.length) { req.flash('error', 'Not found.'); return res.redirect('/tickets'); }

    await req.db.query(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, sender_name, body, is_internal)
       VALUES (?, 'staff', ?, ?, ?, ?)`,
      [req.params.id, user.id, user.full_name, body, is_internal ? 1 : 0]
    );

    // Update status if changed
    if (new_status) {
      const resolvedAt = (new_status === 'resolved' || new_status === 'closed') ? 'NOW()' : 'NULL';
      await req.db.query(
        `UPDATE tickets SET status = ?, updated_at = NOW(),
         resolved_at = ${resolvedAt} WHERE id = ?`,
        [new_status, req.params.id]
      );
    } else {
      await req.db.query('UPDATE tickets SET updated_at = NOW() WHERE id = ?', [req.params.id]);
    }

    req.flash('success', 'Reply sent.');
    res.redirect('/tickets/' + req.params.id);
  } catch (err) {
    console.error('[Tickets] reply error:', err.message);
    req.flash('error', 'Failed to send reply.');
    res.redirect('/tickets/' + req.params.id);
  }
});

// ─── Update status/priority ───
router.post('/tickets/:id/update', async (req, res) => {
  const user = req.session.user;
  const s = scope(user);
  const { status, priority } = req.body;

  try {
    await req.db.query(
      'UPDATE tickets t SET status = ?, priority = ?, updated_at = NOW() WHERE t.id = ? ' + s.clause,
      [status, priority, req.params.id, ...s.params]
    );
    req.flash('success', 'Ticket updated.');
  } catch (err) {
    req.flash('error', 'Update failed.');
  }
  res.redirect('/tickets/' + req.params.id);
});

module.exports = router;

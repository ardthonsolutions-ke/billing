const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Helper: tenant scope
function tenantClause(user) {
  if (user.role === 'super_admin') {
    return { where: '', params: [] };
  }
  return { where: 'AND p.tenant_id = ?', params: [user.tenant_id] };
}

// ─── List payments ───
router.get('/payments', async (req, res) => {
  const user = req.session.user;
  const { where, params } = tenantClause(user);
  const status = req.query.status || 'pending'; // default to pending — the ones admins care about
  const search = (req.query.q || '').trim();

  let sql = `
    SELECT p.id, p.tenant_id, p.subscriber_id, p.plan_id,
           p.amount, p.method, p.status, p.reference,
           p.mpesa_receipt, p.notes, p.created_at, p.completed_at,
           s.full_name AS subscriber_name,
           s.phone AS subscriber_phone,
           s.account_number,
           pl.name AS plan_name,
           t.name AS tenant_name
    FROM payments p
    LEFT JOIN subscribers s ON p.subscriber_id = s.id
    LEFT JOIN plans pl ON p.plan_id = pl.id
    LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE 1=1 ${where}
  `;
  const sqlParams = [...params];

  if (status && status !== 'all') {
    sql += ' AND p.status = ?';
    sqlParams.push(status);
  }

  if (search) {
    sql += ' AND (s.full_name LIKE ? OR s.phone LIKE ? OR s.account_number LIKE ? OR p.reference LIKE ?)';
    const like = '%' + search + '%';
    sqlParams.push(like, like, like, like);
  }

  sql += ' ORDER BY p.created_at DESC LIMIT 200';

  const [payments] = await req.db.query(sql, sqlParams);

  // Summary counts
  const countWhere = user.role === 'super_admin' ? '' : 'WHERE tenant_id = ?';
  const countParams = user.role === 'super_admin' ? [] : [user.tenant_id];

  const [summary] = await req.db.query(`
    SELECT
      SUM(status = 'pending')   AS pending_count,
      SUM(status = 'completed') AS completed_count,
      SUM(status = 'failed')    AS failed_count,
      IFNULL(SUM(CASE WHEN status = 'completed' AND DATE(completed_at) = CURDATE() THEN amount END), 0) AS today_revenue
    FROM payments
    ${countWhere}
  `, countParams);

  res.render('payments/index', {
    title: 'Payments',
    layout: 'layouts/dashboard',
    payments,
    summary: summary[0] || { pending_count: 0, completed_count: 0, failed_count: 0, today_revenue: 0 },
    filterStatus: status,
    search
  });
});

// ─── Payment detail ───
router.get('/payments/:id', async (req, res) => {
  const user = req.session.user;

  let sql = `
    SELECT p.*, s.full_name AS subscriber_name, s.phone AS subscriber_phone,
           s.account_number, s.status AS subscriber_status,
           s.expires_at AS subscriber_expires_at,
           pl.name AS plan_name, pl.duration_hours, pl.data_cap_mb,
           t.name AS tenant_name
    FROM payments p
    LEFT JOIN subscribers s ON p.subscriber_id = s.id
    LEFT JOIN plans pl ON p.plan_id = pl.id
    LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE p.id = ?
  `;
  const params = [req.params.id];

  if (user.role !== 'super_admin') {
    sql += ' AND p.tenant_id = ?';
    params.push(user.tenant_id);
  }

  const [rows] = await req.db.query(sql, params);
  if (!rows.length) {
    req.flash('error', 'Payment not found.');
    return res.redirect('/payments');
  }

  res.render('payments/detail', {
    title: 'Payment #' + rows[0].id,
    layout: 'layouts/dashboard',
    payment: rows[0]
  });
});

// ─── Mark completed → activate subscriber ───
router.post('/payments/:id/complete', async (req, res) => {
  const user = req.session.user;
  const db = req.db;

  try {
    // Load payment
    let selectSql = 'SELECT * FROM payments WHERE id = ?';
    const selectParams = [req.params.id];
    if (user.role !== 'super_admin') {
      selectSql += ' AND tenant_id = ?';
      selectParams.push(user.tenant_id);
    }

    const [rows] = await db.query(selectSql, selectParams);
    if (!rows.length) {
      req.flash('error', 'Payment not found.');
      return res.redirect('/payments');
    }

    const p = rows[0];
    if (p.status === 'completed') {
      req.flash('info', 'Payment already marked completed.');
      return res.redirect('/payments/' + p.id);
    }

    // Get plan duration
    let durationHours = 24; // default
    if (p.plan_id) {
      const [planRows] = await db.query('SELECT duration_hours FROM plans WHERE id = ?', [p.plan_id]);
      if (planRows.length && planRows[0].duration_hours) {
        durationHours = planRows[0].duration_hours;
      }
    }

    // Mark payment completed
    await db.query(
      `UPDATE payments SET status = 'completed', completed_at = NOW(),
       notes = CONCAT(IFNULL(notes,''), IF(notes IS NULL,'','\n'), ?) WHERE id = ?`,
      ['Completed by ' + user.full_name + ' at ' + new Date().toISOString(), p.id]
    );

    // Activate subscriber
    if (p.subscriber_id) {
      // If subscriber currently has time remaining, extend from that; else from now
      const [subRows] = await db.query(
        'SELECT status, expires_at FROM subscribers WHERE id = ?',
        [p.subscriber_id]
      );

      let baseTime = 'NOW()';
      if (subRows.length && subRows[0].status === 'active' && subRows[0].expires_at) {
        // Extend from existing expiry if still in the future
        const currentExpiry = new Date(subRows[0].expires_at);
        if (currentExpiry > new Date()) {
          baseTime = 'GREATEST(expires_at, NOW())';
        }
      }

      await db.query(
        `UPDATE subscribers
         SET status = 'active',
             activated_at = IFNULL(activated_at, NOW()),
             last_payment_at = NOW(),
             expires_at = DATE_ADD(${baseTime}, INTERVAL ? HOUR),
             plan_id = IFNULL(?, plan_id)
         WHERE id = ?`,
        [durationHours, p.plan_id, p.subscriber_id]
      );

      // Log event
      try {
        await db.query(
          'INSERT INTO subscriber_events (tenant_id, subscriber_id, event_type, details) VALUES (?, ?, ?, ?)',
          [p.tenant_id, p.subscriber_id, 'payment_completed',
           JSON.stringify({ payment_id: p.id, amount: p.amount, plan_id: p.plan_id, duration_hours: durationHours, by: user.id })]
        );
      } catch (e) {
        console.error('[Payments] subscriber_events insert failed:', e.message);
      }
    }

    req.flash('success', 'Payment marked completed. Subscriber activated for ' + durationHours + ' hours.');
    res.redirect('/payments/' + p.id);

  } catch (err) {
    console.error('[Payments] complete error:', err.message);
    req.flash('error', 'Failed to complete payment: ' + err.message);
    res.redirect('/payments');
  }
});

// ─── Mark failed ───
router.post('/payments/:id/fail', async (req, res) => {
  const user = req.session.user;
  try {
    let sql = 'UPDATE payments SET status = ? WHERE id = ?';
    const params = ['failed', req.params.id];
    if (user.role !== 'super_admin') {
      sql = 'UPDATE payments SET status = ? WHERE id = ? AND tenant_id = ?';
      params.push(user.tenant_id);
    }
    await req.db.query(sql, params);
    req.flash('success', 'Payment marked as failed.');
  } catch (err) {
    console.error('[Payments] fail error:', err.message);
    req.flash('error', 'Failed to update payment.');
  }
  res.redirect('/payments/' + req.params.id);
});

// ─── Cancel ───
router.post('/payments/:id/cancel', async (req, res) => {
  const user = req.session.user;
  try {
    let sql = 'UPDATE payments SET status = ? WHERE id = ?';
    const params = ['cancelled', req.params.id];
    if (user.role !== 'super_admin') {
      sql = 'UPDATE payments SET status = ? WHERE id = ? AND tenant_id = ?';
      params.push(user.tenant_id);
    }
    await req.db.query(sql, params);
    req.flash('success', 'Payment cancelled.');
  } catch (err) {
    console.error('[Payments] cancel error:', err.message);
    req.flash('error', 'Failed to cancel payment.');
  }
  res.redirect('/payments/' + req.params.id);
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Scope helper — for super_admin, no filter; for others, their tenant
function scope(user, table = '') {
  if (user.role === 'super_admin') return { clause: '', params: [] };
  const prefix = table ? table + '.' : '';
  return { clause: prefix + 'tenant_id = ?', params: [user.tenant_id] };
}

// ─── Main dashboard ───
router.get('/reports', async (req, res) => {
  const user = req.session.user;
  const s = scope(user, 'payments');

  try {
    // Revenue today / 7-day / 30-day
    const whereClause = s.clause ? 'AND ' + s.clause : '';
    const [revenue] = await req.db.query(`
      SELECT
        IFNULL(SUM(CASE WHEN DATE(completed_at) = CURDATE() AND status='completed' THEN amount END), 0) AS today,
        IFNULL(SUM(CASE WHEN completed_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND status='completed' THEN amount END), 0) AS week,
        IFNULL(SUM(CASE WHEN completed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND status='completed' THEN amount END), 0) AS month,
        IFNULL(SUM(CASE WHEN status='completed' THEN amount END), 0) AS all_time
      FROM payments
      WHERE 1=1 ${whereClause}
    `, s.params);

    // Subscriber status counts
    const subScope = scope(user, 's');
    const subWhere = subScope.clause ? 'WHERE ' + subScope.clause : '';
    const [subCounts] = await req.db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
      FROM subscribers s
      ${subWhere}
    `, subScope.params);

    // Revenue by plan (top 5)
    const [revenueByPlan] = await req.db.query(`
      SELECT p.name AS plan_name, COUNT(pay.id) AS count, IFNULL(SUM(pay.amount), 0) AS total
      FROM payments pay
      LEFT JOIN plans p ON pay.plan_id = p.id
      WHERE pay.status = 'completed' ${s.clause ? 'AND ' + s.clause : ''}
      GROUP BY pay.plan_id, p.name
      ORDER BY total DESC
      LIMIT 5
    `, s.params);

    // Payment status counts
    const [paymentCounts] = await req.db.query(`
      SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'failed' OR status = 'cancelled' THEN 1 ELSE 0 END) AS failed
      FROM payments
      WHERE 1=1 ${whereClause}
    `, s.params);

    // Daily revenue — last 14 days
    const [dailyRevenue] = await req.db.query(`
      SELECT DATE(completed_at) AS day, SUM(amount) AS total, COUNT(*) AS count
      FROM payments
      WHERE status = 'completed' AND completed_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) ${whereClause}
      GROUP BY DATE(completed_at)
      ORDER BY day
    `, s.params);

    // New subscribers — last 14 days
    const [dailySubs] = await req.db.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM subscribers s
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) ${subScope.clause ? 'AND ' + subScope.clause : ''}
      GROUP BY DATE(created_at)
      ORDER BY day
    `, subScope.params);

    // Routers
    const routerScope = scope(user, 'r');
    const [routers] = await req.db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) AS online,
        SUM(CASE WHEN status='offline' THEN 1 ELSE 0 END) AS offline
      FROM routers r
      ${routerScope.clause ? 'WHERE ' + routerScope.clause : ''}
    `, routerScope.params);

    // Tenants (super admin only)
    let tenants = [];
    if (user.role === 'super_admin') {
      const [t] = await req.db.query(`
        SELECT t.id, t.name, t.slug,
               (SELECT COUNT(*) FROM subscribers s WHERE s.tenant_id = t.id) AS sub_count,
               (SELECT IFNULL(SUM(amount),0) FROM payments p WHERE p.tenant_id = t.id AND p.status='completed') AS revenue
        FROM tenants t
        WHERE t.is_active = 1
        ORDER BY revenue DESC
      `);
      tenants = t;
    }

    res.render('reports/index', {
      title: 'Reports',
      layout: 'layouts/dashboard',
      revenue: revenue[0],
      subCounts: subCounts[0],
      paymentCounts: paymentCounts[0],
      revenueByPlan,
      dailyRevenue,
      dailySubs,
      routers: routers[0],
      tenants
    });

  } catch (err) {
    console.error('[Reports] error:', err.message);
    req.flash('error', 'Failed to load reports: ' + err.message);
    res.redirect('/dashboard');
  }
});

// ─── Revenue detail page ───
router.get('/reports/revenue', async (req, res) => {
  const user = req.session.user;
  const s = scope(user, 'p');
  const whereClause = s.clause ? 'AND ' + s.clause : '';

  const [daily] = await req.db.query(`
    SELECT DATE(completed_at) AS day, SUM(amount) AS total, COUNT(*) AS count
    FROM payments p
    WHERE status='completed' AND completed_at >= DATE_SUB(CURDATE(), INTERVAL 60 DAY) ${whereClause}
    GROUP BY DATE(completed_at)
    ORDER BY day DESC
  `, s.params);

  const [byMethod] = await req.db.query(`
    SELECT method, COUNT(*) AS count, IFNULL(SUM(amount),0) AS total
    FROM payments p
    WHERE status='completed' ${whereClause}
    GROUP BY method
  `, s.params);

  res.render('reports/revenue', {
    title: 'Revenue Report',
    layout: 'layouts/dashboard',
    daily,
    byMethod
  });
});

// ─── Subscriber detail page ───
router.get('/reports/subscribers', async (req, res) => {
  const user = req.session.user;
  const s = scope(user, 's');
  const whereClause = s.clause ? 'WHERE ' + s.clause : '';

  const [byStatus] = await req.db.query(`
    SELECT status, COUNT(*) AS count FROM subscribers s ${whereClause} GROUP BY status
  `, s.params);

  const [byType] = await req.db.query(`
    SELECT type, COUNT(*) AS count FROM subscribers s ${whereClause} GROUP BY type
  `, s.params);

  const [byPlan] = await req.db.query(`
    SELECT p.name AS plan_name, COUNT(s.id) AS count
    FROM subscribers s
    LEFT JOIN plans p ON s.plan_id = p.id
    ${whereClause}
    GROUP BY s.plan_id, p.name
    ORDER BY count DESC
    LIMIT 10
  `, s.params);

  const [recent] = await req.db.query(`
    SELECT s.account_number, s.full_name, s.phone, s.status, s.created_at,
           p.name AS plan_name
    FROM subscribers s
    LEFT JOIN plans p ON s.plan_id = p.id
    ${whereClause}
    ORDER BY s.created_at DESC
    LIMIT 20
  `, s.params);

  res.render('reports/subscribers', {
    title: 'Subscriber Report',
    layout: 'layouts/dashboard',
    byStatus, byType, byPlan, recent
  });
});

// ─── JSON API for live refresh ───
router.get('/api/reports/summary', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const s = scope(user, 'payments');
  const whereClause = s.clause ? 'AND ' + s.clause : '';

  try {
    const [revenue] = await req.db.query(`
      SELECT
        IFNULL(SUM(CASE WHEN DATE(completed_at) = CURDATE() AND status='completed' THEN amount END), 0) AS today,
        IFNULL(SUM(CASE WHEN completed_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND status='completed' THEN amount END), 0) AS week,
        IFNULL(SUM(CASE WHEN completed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND status='completed' THEN amount END), 0) AS month
      FROM payments WHERE 1=1 ${whereClause}
    `, s.params);

    const subScope = scope(user, 's');
    const [subs] = await req.db.query(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active
      FROM subscribers s ${subScope.clause ? 'WHERE ' + subScope.clause : ''}
    `, subScope.params);

    res.json({ revenue: revenue[0], subscribers: subs[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

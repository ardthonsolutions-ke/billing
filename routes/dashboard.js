const express = require('express');
const router = express.Router();
require('../middleware/wrapRouter')(router);
const { requireAuth } = require('../middleware/auth');

router.get('/dashboard', requireAuth, async (req, res) => {
  const user = req.session.user;

  let stats = {
    totalSubscribers: 0,
    activeSubscribers: 0,
    totalRouters: 0,
    revenueToday: 0,
    openTickets: 0
  };

  try {
    // These will work once Phase 3 adds the tables.
    // For now, wrap in try/catch so missing tables don't break the dashboard.
    const filter = user.role === 'super_admin' ? '' : 'WHERE tenant_id = ?';
    const params = user.role === 'super_admin' ? [] : [user.tenant_id];

    try {
      const [r1] = await req.db.query(`SELECT COUNT(*) AS c FROM subscribers ${filter}`, params);
      stats.totalSubscribers = r1[0].c;
    } catch (e) { /* table doesn't exist yet */ }

    try {
      const [r2] = await req.db.query(
        `SELECT COUNT(*) AS c FROM subscribers ${filter ? filter + ' AND' : 'WHERE'} status = 'active'`,
        params
      );
      stats.activeSubscribers = r2[0].c;
    } catch (e) { /* */ }

    try {
      const [r3] = await req.db.query(`SELECT COUNT(*) AS c FROM routers ${filter}`, params);
      stats.totalRouters = r3[0].c;
    } catch (e) { /* */ }

    try {
      const [r4] = await req.db.query(
        `SELECT IFNULL(SUM(amount),0) AS s FROM payments ${filter ? filter + ' AND' : 'WHERE'} status = 'completed' AND DATE(completed_at) = CURDATE()`,
        params
      );
      stats.revenueToday = parseFloat(r4[0].s) || 0;
    } catch (e) { /* */ }

    try {
      const [r5] = await req.db.query(
        `SELECT COUNT(*) AS c FROM tickets ${filter ? filter + ' AND' : 'WHERE'} status IN ('open','pending')`,
        params
      );
      stats.openTickets = r5[0].c;
    } catch (e) { /* */ }
  } catch (outerErr) {
    console.error('[Dashboard] error:', outerErr.message);
  }

  // If super-admin, get tenant count
  let tenantCount = 0;
  if (user.role === 'super_admin') {
    try {
      const [tr] = await req.db.query('SELECT COUNT(*) AS c FROM tenants WHERE is_active = 1');
      tenantCount = tr[0].c;
    } catch (e) { /* */ }
  }

  res.render('dashboard/home', {
    title: 'Dashboard',
    layout: 'layouts/dashboard',
    stats,
    tenantCount
  });
});

module.exports = router;

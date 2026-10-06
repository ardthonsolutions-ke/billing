const express = require('express');
const router = express.Router();
const mikrotik = require('../services/mikrotikService');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function tenantFilter(user) {
  if (user.role === 'super_admin') {
    return { clause: '', params: [] };
  }
  return { clause: 'WHERE tenant_id = ?', params: [user.tenant_id] };
}

function tenantFilterAlias(user, alias) {
  if (user.role === 'super_admin') {
    return { clause: '', params: [] };
  }
  return { clause: 'WHERE ' + alias + '.tenant_id = ?', params: [user.tenant_id] };
}

// ─── Main network dashboard ───
router.get('/network', async (req, res) => {
  const user = req.session.user;
  const t = tenantFilter(user);

  // 1. Load routers
  const [routers] = await req.db.query(
    `SELECT id, name, host, port, username, password_encrypted, status, last_seen, site_name
     FROM routers ${t.clause}
     ORDER BY name`,
    t.params
  );

  // 2. Query each router's status in parallel (with graceful failure)
  const routerStatuses = await Promise.all(
    routers.map(async (r) => {
      if (!r.password_encrypted) {
        return { router: r, status: { ok: false, error: 'No credentials' }, sessions: [] };
      }
      const status = await mikrotik.getRouterFullStatus(r);
      return { router: r, status, sessions: status.activeSessions || [] };
    })
  );

  // 3. Total active sessions across all routers
  const totalActive = routerStatuses.reduce((sum, r) => sum + (r.sessions.length || 0), 0);

  // 4. Subscriber counts
  const tSub = tenantFilterAlias(user, 's');
  const [subCounts] = await req.db.query(
    `SELECT
       SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) AS expired,
       COUNT(*) AS total
     FROM subscribers s ${tSub.clause}`,
    tSub.params
  );

  // 5. Recent payments
  const tPay = tenantFilterAlias(user, 'p');
  const [recentPayments] = await req.db.query(
    `SELECT p.id, p.amount, p.method, p.status, p.created_at, p.completed_at,
            p.mpesa_phone, p.reference,
            s.full_name AS subscriber_name, s.phone AS subscriber_phone
     FROM payments p
     LEFT JOIN subscribers s ON p.subscriber_id = s.id
     ${tPay.clause}
     ORDER BY p.created_at DESC
     LIMIT 10`,
    tPay.params
  );

  // 6. Recent subscriber events
  const tEv = tenantFilterAlias(user, 'e');
  const [recentEvents] = await req.db.query(
    `SELECT e.event_type, e.details, e.created_at,
            s.full_name AS subscriber_name
     FROM subscriber_events e
     LEFT JOIN subscribers s ON e.subscriber_id = s.id
     ${tEv.clause}
     ORDER BY e.created_at DESC
     LIMIT 10`,
    tEv.params
  );

  // 7. Payments summary today
  const [todaySum] = await req.db.query(
    `SELECT
       SUM(CASE WHEN status='completed' AND DATE(completed_at) = CURDATE() THEN amount ELSE 0 END) AS today_revenue,
       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_count
     FROM payments p ${tPay.clause}`,
    tPay.params
  );

  res.render('network/index', {
    title: 'Network',
    layout: 'layouts/dashboard',
    routerStatuses,
    totalActive,
    subCounts: subCounts[0],
    recentPayments,
    recentEvents,
    todaySum: todaySum[0]
  });
});

// ─── API for live refresh (polled every 10s) ───
router.get('/network/api/live', async (req, res) => {
  const user = req.session.user;
  const t = tenantFilter(user);

  try {
    const [routers] = await req.db.query(
      `SELECT id, name, host, port, username, password_encrypted, status
       FROM routers ${t.clause}`,
      t.params
    );

    const statuses = await Promise.all(
      routers.map(async (r) => {
        if (!r.password_encrypted) return { id: r.id, name: r.name, ok: false, sessions: [] };
        const s = await mikrotik.getRouterFullStatus(r);
        return {
          id: r.id,
          name: r.name,
          ok: s.ok,
          version: s.version,
          uptime: s.uptime,
          cpuLoad: s.cpuLoad,
          activeCount: (s.activeSessions || []).length + (s.pppoeSessions || []).length,
          sessions: (s.activeSessions || []).slice(0, 20),
          error: s.error || null
        };
      })
    );

    const totalActive = statuses.reduce((sum, s) => sum + (s.activeCount || 0), 0);

    const tPay = tenantFilterAlias(user, 'p');
    const [todaySum] = await req.db.query(
      `SELECT
         SUM(CASE WHEN status='completed' AND DATE(completed_at) = CURDATE() THEN amount ELSE 0 END) AS today_revenue,
         SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_count
       FROM payments p ${tPay.clause}`,
      tPay.params
    );

    res.json({
      time: new Date().toISOString(),
      totalActive,
      routers: statuses,
      today: todaySum[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── All active sessions across all routers ───
router.get('/network/active', async (req, res) => {
  const user = req.session.user;
  const t = tenantFilter(user);

  const [routers] = await req.db.query(
    `SELECT id, name, host, port, username, password_encrypted FROM routers ${t.clause} ORDER BY name`,
    t.params
  );

  const allSessions = [];
  for (const r of routers) {
    if (!r.password_encrypted) continue;
    const status = await mikrotik.getRouterFullStatus(r);
    if (status.ok) {
      (status.activeSessions || []).forEach((s) => {
        allSessions.push({ router_id: r.id, router_name: r.name, kind: 'hotspot', session: s });
      });
      (status.pppoeSessions || []).forEach((s) => {
        allSessions.push({ router_id: r.id, router_name: r.name, kind: 'pppoe', session: s });
      });
    }
  }

  res.render('network/active', {
    title: 'Active Sessions',
    layout: 'layouts/dashboard',
    sessions: allSessions
  });
});

// ─── Disconnect a session ───
router.post('/network/disconnect', async (req, res) => {
  const user = req.session.user;
  const { router_id, session_id, kind } = req.body;

  if (!router_id || !session_id) {
    req.flash('error', 'Router ID and session ID required.');
    return res.redirect('/network/active');
  }

  try {
    const t = tenantFilter(user);
    const [routers] = await req.db.query(
      `SELECT * FROM routers ${t.clause ? t.clause + ' AND' : 'WHERE'} id = ?`,
      [...t.params, router_id]
    );
    if (!routers.length) {
      req.flash('error', 'Router not found.');
      return res.redirect('/network/active');
    }

    const r = routers[0];
    let result;

    if (kind === 'pppoe') {
      // PPPoE — remove from /ppp/active
      result = await (async () => {
        const conn = await mikrotik.connect(r);
        try {
          await conn.write('/ppp/active/remove', ['=.id=' + session_id]);
          return { ok: true };
        } finally {
          conn.close();
        }
      })().catch(e => ({ ok: false, error: e.message }));
    } else {
      // Hotspot — use the helper
      result = await mikrotik.disconnectActiveSession(r, session_id);
    }

    if (result.ok) {
      req.flash('success', 'User disconnected from ' + r.name + '.');
    } else {
      req.flash('error', 'Failed to disconnect: ' + (result.error || 'unknown error'));
    }
  } catch (err) {
    console.error('[Network] disconnect error:', err.message);
    req.flash('error', 'Failed: ' + err.message);
  }

  res.redirect('/network/active');
});

// ─── Session history (from portal_sessions + subscriber_events) ───
router.get('/network/history', async (req, res) => {
  const user = req.session.user;
  const t = tenantFilterAlias(user, 'ps');

  const [sessions] = await req.db.query(
    `SELECT ps.id, ps.visitor_mac, ps.visitor_ip, ps.stage, ps.phone, ps.created_at,
            t.name AS tenant_name
     FROM portal_sessions ps
     LEFT JOIN tenants t ON ps.tenant_id = t.id
     ${t.clause}
     ORDER BY ps.created_at DESC
     LIMIT 200`,
    t.params
  );

  res.render('network/history', {
    title: 'Network History',
    layout: 'layouts/dashboard',
    sessions
  });
});

// ─── Test a specific router connection ───
router.post('/network/router/:id/test', async (req, res) => {
  const user = req.session.user;
  const t = tenantFilter(user);

  try {
    const [routers] = await req.db.query(
      `SELECT * FROM routers ${t.clause ? t.clause + ' AND' : 'WHERE'} id = ?`,
      [...t.params, req.params.id]
    );
    if (!routers.length) { req.flash('error', 'Router not found.'); return res.redirect('/network'); }

    const result = await mikrotik.testConnection(routers[0]);
    if (result.ok) {
      await req.db.query(
        "UPDATE routers SET status='online', last_seen=NOW(), routeros_version=?, model=? WHERE id = ?",
        [result.version, result.board, req.params.id]
      );
      req.flash('success', 'Connected: RouterOS ' + result.version);
    } else {
      await req.db.query("UPDATE routers SET status='offline' WHERE id = ?", [req.params.id]);
      req.flash('error', 'Connection failed: ' + result.error);
    }
  } catch (err) {
    req.flash('error', 'Failed: ' + err.message);
  }

  res.redirect('/network');
});

module.exports = router;

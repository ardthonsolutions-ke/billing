const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const mikrotik = require('../services/mikrotikService');

router.use(requireAuth);

// List
router.get('/routers', async (req, res) => {
  const u = req.session.user;
  const tFilter = u.role === 'super_admin' ? '' : 'WHERE tenant_id = ' + req.db.escape(u.tenant_id);
  const [routers] = await req.db.query(`SELECT * FROM routers ${tFilter} ORDER BY name`);
  res.render('routers/index', {
    title: 'Routers',
    layout: 'layouts/dashboard',
    routers
  });
});

// New form
router.get('/routers/new', (req, res) => {
  res.render('routers/form', {
    title: 'New Router',
    layout: 'layouts/dashboard',
    router: null,
    testResult: null
  });
});

// Create
router.post('/routers', async (req, res) => {
  const u = req.session.user;
  const tId = u.tenant_id;
  if (!tId) {
    req.flash('error', 'You must belong to a tenant to add routers.');
    return res.redirect('/routers');
  }

  const { name, model, host, port, username, password, api_type, site_name, location, wireguard_enabled, wireguard_ip, notes } = req.body;

  try {
    await req.db.query(
      `INSERT INTO routers
        (tenant_id, name, model, host, port, username, password_encrypted, api_type,
         site_name, location, wireguard_enabled, wireguard_ip, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tId, name, model || null, host, port || 8728, username, password,
       api_type || 'api', site_name || null, location || null,
       wireguard_enabled ? 1 : 0, wireguard_ip || null, notes || null]
    );
    req.flash('success', 'Router added.');
    res.redirect('/routers');
  } catch (err) {
    console.error('[Routers] create error:', err.message);
    req.flash('error', 'Failed to add router.');
    res.redirect('/routers/new');
  }
});

// Test connection endpoint (AJAX)
router.post('/routers/test', async (req, res) => {
  const { host, port, username, password } = req.body;
  const result = await mikrotik.testConnection({
    host, port: port || 8728, username, password_encrypted: password
  });
  res.json(result);
});

// Sync / view active sessions
router.get('/routers/:id/sessions', async (req, res) => {
  const [rows] = await req.db.query('SELECT * FROM routers WHERE id = ?', [req.params.id]);
  if (!rows.length) { req.flash('error', 'Router not found.'); return res.redirect('/routers'); }

  const result = await mikrotik.listHotspotActive(rows[0]);

  res.render('routers/sessions', {
    title: rows[0].name + ' — Active Sessions',
    layout: 'layouts/dashboard',
    router: rows[0],
    sessions: result.ok ? result.sessions : [],
    error: result.ok ? null : result.error
  });
});

// Test saved router connection
router.post('/routers/:id/test', async (req, res) => {
  const [rows] = await req.db.query('SELECT * FROM routers WHERE id = ?', [req.params.id]);
  if (!rows.length) { req.flash('error', 'Router not found.'); return res.redirect('/routers'); }

  const result = await mikrotik.testConnection(rows[0]);
  if (result.ok) {
    await req.db.query("UPDATE routers SET status='online', last_seen=NOW(), routeros_version=?, model=? WHERE id = ?",
      [result.version || null, result.board || null, req.params.id]);
    req.flash('success', 'Connection OK — RouterOS ' + result.version + ', board ' + (result.board || 'unknown'));
  } else {
    await req.db.query("UPDATE routers SET status='offline' WHERE id = ?", [req.params.id]);
    req.flash('error', 'Connection failed: ' + result.error);
  }
  res.redirect('/routers');
});

// Edit form
router.get('/routers/:id/edit', async (req, res) => {
  const [rows] = await req.db.query('SELECT * FROM routers WHERE id = ?', [req.params.id]);
  if (!rows.length) { req.flash('error', 'Router not found.'); return res.redirect('/routers'); }
  res.render('routers/form', {
    title: 'Edit Router',
    layout: 'layouts/dashboard',
    router: rows[0],
    testResult: null
  });
});

// Update
router.post('/routers/:id', async (req, res) => {
  const { name, model, host, port, username, password, api_type, site_name, location, wireguard_enabled, wireguard_ip, notes } = req.body;
  try {
    const params = [name, model || null, host, port || 8728, username, api_type || 'api',
                    site_name || null, location || null,
                    wireguard_enabled ? 1 : 0, wireguard_ip || null, notes || null];
    let query = `UPDATE routers SET name=?, model=?, host=?, port=?, username=?, api_type=?,
                 site_name=?, location=?, wireguard_enabled=?, wireguard_ip=?, notes=?`;
    if (password) {
      query += ', password_encrypted=?';
      params.push(password);
    }
    query += ' WHERE id=?';
    params.push(req.params.id);

    await req.db.query(query, params);
    req.flash('success', 'Router updated.');
    res.redirect('/routers');
  } catch (err) {
    console.error('[Routers] update error:', err.message);
    req.flash('error', 'Failed to update.');
    res.redirect('/routers/' + req.params.id + '/edit');
  }
});

// Delete
router.post('/routers/:id/delete', async (req, res) => {
  try {
    await req.db.query('DELETE FROM routers WHERE id = ?', [req.params.id]);
    req.flash('success', 'Router deleted.');
  } catch (err) {
    req.flash('error', 'Failed to delete.');
  }
  res.redirect('/routers');
});

module.exports = router;

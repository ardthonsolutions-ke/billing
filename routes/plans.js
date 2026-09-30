const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function tenantFilter(req) {
  const u = req.session.user;
  if (u.role === 'super_admin') return { where: '', params: [] };
  return { where: 'WHERE tenant_id = ?', params: [u.tenant_id] };
}

// List
router.get('/plans', async (req, res) => {
  const { where, params } = tenantFilter(req);
  const [plans] = await req.db.query(`SELECT * FROM plans ${where} ORDER BY sort_order, price`, params);
  res.render('plans/index', {
    title: 'Plans',
    layout: 'layouts/dashboard',
    plans
  });
});

// New form
router.get('/plans/new', (req, res) => {
  res.render('plans/form', {
    title: 'New Plan',
    layout: 'layouts/dashboard',
    plan: null
  });
});

// Create
router.post('/plans', async (req, res) => {
  const u = req.session.user;
  const tenantId = u.role === 'super_admin' && req.body.tenant_id ? req.body.tenant_id : u.tenant_id;
  if (!tenantId) {
    req.flash('error', 'Tenant required.');
    return res.redirect('/plans/new');
  }
  const { name, type, price, duration_hours, data_cap_mb, speed_down_kbps, speed_up_kbps, description } = req.body;
  try {
    await req.db.query(
      `INSERT INTO plans (tenant_id, name, type, price, duration_hours, data_cap_mb, speed_down_kbps, speed_up_kbps, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, name, type, price || 0,
       duration_hours || null, data_cap_mb || null,
       speed_down_kbps || null, speed_up_kbps || null,
       description || null]
    );
    req.flash('success', 'Plan created.');
    res.redirect('/plans');
  } catch (err) {
    console.error('[Plans] create error:', err.message);
    req.flash('error', 'Failed to create plan.');
    res.redirect('/plans/new');
  }
});

// Edit form
router.get('/plans/:id/edit', async (req, res) => {
  const [rows] = await req.db.query('SELECT * FROM plans WHERE id = ?', [req.params.id]);
  if (!rows.length) { req.flash('error', 'Plan not found.'); return res.redirect('/plans'); }
  res.render('plans/form', {
    title: 'Edit Plan',
    layout: 'layouts/dashboard',
    plan: rows[0]
  });
});

// Update
router.post('/plans/:id', async (req, res) => {
  const { name, type, price, duration_hours, data_cap_mb, speed_down_kbps, speed_up_kbps, description, is_active } = req.body;
  try {
    await req.db.query(
      `UPDATE plans SET name=?, type=?, price=?, duration_hours=?, data_cap_mb=?,
       speed_down_kbps=?, speed_up_kbps=?, description=?, is_active=? WHERE id=?`,
      [name, type, price || 0, duration_hours || null, data_cap_mb || null,
       speed_down_kbps || null, speed_up_kbps || null, description || null,
       is_active ? 1 : 0, req.params.id]
    );
    req.flash('success', 'Plan updated.');
    res.redirect('/plans');
  } catch (err) {
    console.error('[Plans] update error:', err.message);
    req.flash('error', 'Failed to update plan.');
    res.redirect('/plans/' + req.params.id + '/edit');
  }
});

// Toggle
router.post('/plans/:id/toggle', async (req, res) => {
  try {
    await req.db.query('UPDATE plans SET is_active = 1 - is_active WHERE id = ?', [req.params.id]);
    req.flash('success', 'Plan toggled.');
  } catch (err) {
    req.flash('error', 'Failed to toggle.');
  }
  res.redirect('/plans');
});

module.exports = router;

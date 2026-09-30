const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

router.use(requireAuth);

// List users
router.get('/users', async (req, res) => {
  const user = req.session.user;
  let query = `SELECT u.id, u.tenant_id, u.email, u.full_name, u.role, u.is_active, u.last_login, u.created_at, t.name AS tenant_name
               FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id`;
  let params = [];
  if (user.role !== 'super_admin') {
    query += ' WHERE u.tenant_id = ?';
    params.push(user.tenant_id);
  }
  query += ' ORDER BY u.created_at DESC';

  const [users] = await req.db.query(query, params);

  let tenants = [];
  if (user.role === 'super_admin') {
    const [tr] = await req.db.query('SELECT id, name FROM tenants WHERE is_active = 1 ORDER BY name');
    tenants = tr;
  }

  res.render('users/index', {
    title: 'Users',
    layout: 'layouts/dashboard',
    users,
    tenants
  });
});

// New user form
router.get('/users/new', async (req, res) => {
  const user = req.session.user;
  let tenants = [];
  if (user.role === 'super_admin') {
    const [tr] = await req.db.query('SELECT id, name FROM tenants WHERE is_active = 1 ORDER BY name');
    tenants = tr;
  }
  res.render('users/form', {
    title: 'New User',
    layout: 'layouts/dashboard',
    targetUser: null,
    tenants
  });
});

// Create user
router.post('/users', async (req, res) => {
  const me = req.session.user;
  const { email, full_name, password, role, tenant_id } = req.body;

  if (!email || !full_name || !password) {
    req.flash('error', 'Email, name, and password are required.');
    return res.redirect('/users/new');
  }

  let effectiveTenantId = tenant_id || null;
  if (me.role !== 'super_admin') effectiveTenantId = me.tenant_id;

  const allowedRoles = me.role === 'super_admin'
    ? ['super_admin','isp_admin','reseller','staff','accountant']
    : ['isp_admin','reseller','staff','accountant'];

  if (!allowedRoles.includes(role)) {
    req.flash('error', 'Invalid role.');
    return res.redirect('/users/new');
  }

  try {
    const [existing] = await req.db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length) {
      req.flash('error', 'That email is already in use.');
      return res.redirect('/users/new');
    }

    const hash = await bcrypt.hash(password, 10);
    await req.db.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
       VALUES (?, ?, ?, ?, ?)`,
      [effectiveTenantId, email.toLowerCase(), hash, full_name, role]
    );

    req.flash('success', 'User "' + full_name + '" created.');
    res.redirect('/users');
  } catch (err) {
    console.error('[Users] create error:', err.message);
    req.flash('error', 'Failed to create user.');
    res.redirect('/users/new');
  }
});

// Edit user form
router.get('/users/:id/edit', async (req, res) => {
  const me = req.session.user;
  const [rows] = await req.db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) {
    req.flash('error', 'User not found.');
    return res.redirect('/users');
  }
  const targetUser = rows[0];

  if (me.role !== 'super_admin' && targetUser.tenant_id !== me.tenant_id) {
    req.flash('error', 'You cannot edit that user.');
    return res.redirect('/users');
  }

  let tenants = [];
  if (me.role === 'super_admin') {
    const [tr] = await req.db.query('SELECT id, name FROM tenants WHERE is_active = 1 ORDER BY name');
    tenants = tr;
  }
  res.render('users/form', {
    title: 'Edit User',
    layout: 'layouts/dashboard',
    targetUser,
    tenants
  });
});

// Update user
router.post('/users/:id', async (req, res) => {
  const me = req.session.user;
  const { full_name, role, tenant_id, is_active, password } = req.body;

  const [rows] = await req.db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) {
    req.flash('error', 'User not found.');
    return res.redirect('/users');
  }
  const target = rows[0];

  if (me.role !== 'super_admin' && target.tenant_id !== me.tenant_id) {
    req.flash('error', 'You cannot edit that user.');
    return res.redirect('/users');
  }

  let effectiveTenantId = tenant_id || target.tenant_id;
  if (me.role !== 'super_admin') effectiveTenantId = me.tenant_id;

  try {
    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      await req.db.query(
        `UPDATE users SET full_name=?, role=?, tenant_id=?, is_active=?, password_hash=? WHERE id=?`,
        [full_name, role, effectiveTenantId, is_active ? 1 : 0, hash, req.params.id]
      );
    } else {
      await req.db.query(
        `UPDATE users SET full_name=?, role=?, tenant_id=?, is_active=? WHERE id=?`,
        [full_name, role, effectiveTenantId, is_active ? 1 : 0, req.params.id]
      );
    }

    req.flash('success', 'User updated.');
    res.redirect('/users');
  } catch (err) {
    console.error('[Users] update error:', err.message);
    req.flash('error', 'Failed to update user.');
    res.redirect('/users/' + req.params.id + '/edit');
  }
});

// Toggle active
router.post('/users/:id/toggle', async (req, res) => {
  const me = req.session.user;
  try {
    const [rows] = await req.db.query('SELECT tenant_id FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length) { req.flash('error', 'User not found.'); return res.redirect('/users'); }
    if (me.role !== 'super_admin' && rows[0].tenant_id !== me.tenant_id) {
      req.flash('error', 'Not allowed.');
      return res.redirect('/users');
    }
    await req.db.query('UPDATE users SET is_active = 1 - is_active WHERE id = ?', [req.params.id]);
    req.flash('success', 'User status toggled.');
  } catch (err) {
    req.flash('error', 'Failed to toggle.');
  }
  res.redirect('/users');
});

module.exports = router;

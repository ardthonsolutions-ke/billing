const express = require('express');
const router = express.Router();
require('../middleware/wrapRouter')(router);
const bcrypt = require('bcryptjs');
const { requireGuest, requireAuth } = require('../middleware/auth');

// GET /login
router.get('/login', requireGuest, (req, res) => {
  res.render('auth/login', { title: 'Sign In', layout: 'layouts/main' });
});

// POST /login
router.post('/login', requireGuest, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash('error', 'Email and password are required.');
    return res.redirect('/login');
  }

  try {
    const [rows] = await req.db.query(
      'SELECT id, tenant_id, email, password_hash, full_name, role, is_active FROM users WHERE email = ? LIMIT 1',
      [email.trim().toLowerCase()]
    );

    if (rows.length === 0) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }

    const user = rows[0];

    if (!user.is_active) {
      req.flash('error', 'Your account has been disabled. Contact your administrator.');
      return res.redirect('/login');
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }

    // Load tenant if user belongs to one
    let tenant = null;
    if (user.tenant_id) {
      const [tr] = await req.db.query(
        'SELECT id, name, slug, logo_url, primary_color, accent_color, currency FROM tenants WHERE id = ? AND is_active = 1 LIMIT 1',
        [user.tenant_id]
      );
      if (tr.length) tenant = tr[0];
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      tenant_id: user.tenant_id
    };
    req.session.tenant = tenant;

    await req.db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    req.flash('success', 'Welcome back, ' + user.full_name + '!');
    res.redirect('/dashboard');
  } catch (err) {
    console.error('[Auth] login error:', err.message);
    req.flash('error', 'Login failed. Try again.');
    res.redirect('/login');
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;

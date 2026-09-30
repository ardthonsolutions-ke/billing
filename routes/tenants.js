const express = require('express');
const router = express.Router();
const { requireSuperAdmin } = require('../middleware/auth');

router.use(requireSuperAdmin);

// List tenants
router.get('/tenants', async (req, res) => {
  const [tenants] = await req.db.query(`
    SELECT t.*,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count
    FROM tenants t
    ORDER BY t.created_at DESC
  `);

  res.render('tenants/index', {
    title: 'Tenants',
    layout: 'layouts/dashboard',
    tenants
  });
});

// New tenant form
router.get('/tenants/new', (req, res) => {
  res.render('tenants/form', {
    title: 'New Tenant',
    layout: 'layouts/dashboard',
    tenant: null
  });
});

// Create tenant
router.post('/tenants', async (req, res) => {
  const { name, slug, contact_email, contact_phone, primary_color, accent_color } = req.body;

  if (!name || !slug) {
    req.flash('error', 'Name and slug are required.');
    return res.redirect('/tenants/new');
  }

  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  try {
    const [existing] = await req.db.query('SELECT id FROM tenants WHERE slug = ?', [cleanSlug]);
    if (existing.length) {
      req.flash('error', 'That slug is already taken.');
      return res.redirect('/tenants/new');
    }

    await req.db.query(
      `INSERT INTO tenants (name, slug, contact_email, contact_phone, primary_color, accent_color)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, cleanSlug, contact_email || null, contact_phone || null,
       primary_color || '#1a4a8a', accent_color || '#e85d2c']
    );

    req.flash('success', 'Tenant "' + name + '" created.');
    res.redirect('/tenants');
  } catch (err) {
    console.error('[Tenants] create error:', err.message);
    req.flash('error', 'Failed to create tenant.');
    res.redirect('/tenants/new');
  }
});

// Edit tenant form
router.get('/tenants/:id/edit', async (req, res) => {
  const [rows] = await req.db.query('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
  if (!rows.length) {
    req.flash('error', 'Tenant not found.');
    return res.redirect('/tenants');
  }
  res.render('tenants/form', {
    title: 'Edit Tenant',
    layout: 'layouts/dashboard',
    tenant: rows[0]
  });
});

// Update tenant
router.post('/tenants/:id', async (req, res) => {
  const { name, slug, contact_email, contact_phone, primary_color, accent_color, is_active } = req.body;
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  try {
    await req.db.query(
      `UPDATE tenants SET name=?, slug=?, contact_email=?, contact_phone=?, primary_color=?, accent_color=?, is_active=?
       WHERE id=?`,
      [name, cleanSlug, contact_email || null, contact_phone || null,
       primary_color || '#1a4a8a', accent_color || '#e85d2c',
       is_active ? 1 : 0, req.params.id]
    );
    req.flash('success', 'Tenant updated.');
    res.redirect('/tenants');
  } catch (err) {
    console.error('[Tenants] update error:', err.message);
    req.flash('error', 'Failed to update tenant.');
    res.redirect('/tenants/' + req.params.id + '/edit');
  }
});

// Toggle active
router.post('/tenants/:id/toggle', async (req, res) => {
  try {
    await req.db.query('UPDATE tenants SET is_active = 1 - is_active WHERE id = ?', [req.params.id]);
    req.flash('success', 'Tenant status toggled.');
  } catch (err) {
    req.flash('error', 'Failed to toggle status.');
  }
  res.redirect('/tenants');
});

module.exports = router;

const express = require('express');
const router = express.Router();
require('../middleware/wrapRouter')(router);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireSuperAdmin } = require('../middleware/auth');

// Multer storage for branding assets
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'branding');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const tenantSlug = (req.body.slug || 'tenant').replace(/[^a-z0-9-]/g, '-');
    const kind = file.fieldname; // 'logo' or 'favicon'
    cb(null, `${tenantSlug}-${kind}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only PNG, JPG, SVG, or WebP allowed'));
  }
});

const brandingUpload = upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'favicon', maxCount: 1 }
]);

router.use(requireSuperAdmin);

// List tenants
router.get('/tenants', async (req, res) => {
  const [tenants] = await req.db.query(`
    SELECT t.*,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
      (SELECT COUNT(*) FROM subscribers s WHERE s.tenant_id = t.id) AS subscriber_count
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
router.post('/tenants', brandingUpload, async (req, res) => {
  const {
    name, slug, tagline, contact_email, contact_phone, website,
    primary_color, accent_color,
    address_line1, address_line2, city, country_code,
    facebook_url, twitter_url, instagram_url, whatsapp_number,
    invoice_footer
  } = req.body;

  if (!name || !slug) {
    req.flash('error', 'Name and slug are required.');
    return res.redirect('/tenants/new');
  }

  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const logoUrl = req.files && req.files.logo ? '/uploads/branding/' + req.files.logo[0].filename : null;
  const faviconUrl = req.files && req.files.favicon ? '/uploads/branding/' + req.files.favicon[0].filename : null;

  try {
    const [existing] = await req.db.query('SELECT id FROM tenants WHERE slug = ?', [cleanSlug]);
    if (existing.length) {
      req.flash('error', 'That slug is already taken.');
      return res.redirect('/tenants/new');
    }

    await req.db.query(
      `INSERT INTO tenants
       (name, slug, tagline, logo_url, favicon_url, contact_email, contact_phone, website,
        primary_color, accent_color,
        address_line1, address_line2, city, country_code,
        facebook_url, twitter_url, instagram_url, whatsapp_number,
        invoice_footer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, cleanSlug, tagline || null, logoUrl, faviconUrl,
       contact_email || null, contact_phone || null, website || null,
       primary_color || '#1a4a8a', accent_color || '#e85d2c',
       address_line1 || null, address_line2 || null, city || null, country_code || 'KE',
       facebook_url || null, twitter_url || null, instagram_url || null, whatsapp_number || null,
       invoice_footer || null]
    );

    req.flash('success', 'Tenant "' + name + '" created.');
    res.redirect('/tenants');
  } catch (err) {
    console.error('[Tenants] create error:', err.message);
    req.flash('error', 'Failed to create tenant: ' + err.message);
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
router.post('/tenants/:id', brandingUpload, async (req, res) => {
  const {
    name, slug, tagline, contact_email, contact_phone, website,
    primary_color, accent_color, is_active,
    address_line1, address_line2, city, country_code,
    facebook_url, twitter_url, instagram_url, whatsapp_number,
    invoice_footer
  } = req.body;

  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  try {
    // Get current logo/favicon URLs
    const [current] = await req.db.query('SELECT logo_url, favicon_url FROM tenants WHERE id = ?', [req.params.id]);
    if (!current.length) { req.flash('error', 'Not found.'); return res.redirect('/tenants'); }

    let logoUrl = current[0].logo_url;
    let faviconUrl = current[0].favicon_url;

    if (req.files && req.files.logo) {
      logoUrl = '/uploads/branding/' + req.files.logo[0].filename;
    }
    if (req.files && req.files.favicon) {
      faviconUrl = '/uploads/branding/' + req.files.favicon[0].filename;
    }

    // Allow removing logo (checkbox)
    if (req.body.remove_logo === '1') logoUrl = null;
    if (req.body.remove_favicon === '1') faviconUrl = null;

    await req.db.query(
      `UPDATE tenants SET
        name=?, slug=?, tagline=?, logo_url=?, favicon_url=?,
        contact_email=?, contact_phone=?, website=?,
        primary_color=?, accent_color=?, is_active=?,
        address_line1=?, address_line2=?, city=?, country_code=?,
        facebook_url=?, twitter_url=?, instagram_url=?, whatsapp_number=?,
        invoice_footer=?
       WHERE id=?`,
      [name, cleanSlug, tagline || null, logoUrl, faviconUrl,
       contact_email || null, contact_phone || null, website || null,
       primary_color || '#1a4a8a', accent_color || '#e85d2c', is_active ? 1 : 0,
       address_line1 || null, address_line2 || null, city || null, country_code || 'KE',
       facebook_url || null, twitter_url || null, instagram_url || null, whatsapp_number || null,
       invoice_footer || null, req.params.id]
    );

    req.flash('success', 'Tenant updated.');
    res.redirect('/tenants/' + req.params.id + '/edit');
  } catch (err) {
    console.error('[Tenants] update error:', err.message);
    req.flash('error', 'Failed to update tenant: ' + err.message);
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

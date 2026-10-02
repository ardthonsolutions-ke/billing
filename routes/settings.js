const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

router.use(requireAuth);

// Multer for advert images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'branding');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const tenantId = (req.session.user.tenant_id || 'tenant').toString();
    cb(null, `tenant-${tenantId}-advert-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Image must be PNG, JPG, WebP, or GIF'));
  }
}).single('advert_image');

// Helper: get current tenant
function currentTenantId(user) {
  return user.tenant_id || 1; // super-admin defaults to 1
}

// ─── Main settings page ───
router.get('/settings', async (req, res) => {
  const user = req.session.user;
  const tenantId = currentTenantId(user);

  const [rows] = await req.db.query('SELECT * FROM tenants WHERE id = ?', [tenantId]);
  if (!rows.length) {
    req.flash('error', 'Tenant not found.');
    return res.redirect('/dashboard');
  }

  res.render('settings/index', {
    title: 'Settings',
    layout: 'layouts/dashboard',
    tenant: rows[0]
  });
});

// ─── Save general settings (support contact + portal) ───
router.post('/settings/general', upload, async (req, res) => {
  const user = req.session.user;
  const tenantId = currentTenantId(user);

  const {
    support_phone, support_email, support_whatsapp,
    portal_template, portal_font, portal_welcome, portal_terms,
    advert_link,
    contact_email, contact_phone, website,
    whatsapp_number
  } = req.body;

  try {
    // Handle advert image upload
    let advertImageUrl = null;
    if (req.file) {
      advertImageUrl = '/uploads/branding/' + req.file.filename;
    }

    // If user checked remove_advert, clear it
    const removeAdvert = req.body.remove_advert === '1';

    const fields = [
      'support_phone = ?',
      'support_email = ?',
      'support_whatsapp = ?',
      'portal_template = ?',
      'portal_font = ?',
      'portal_welcome = ?',
      'portal_terms = ?',
      'advert_link = ?',
      'contact_email = ?',
      'contact_phone = ?',
      'website = ?',
      'whatsapp_number = ?'
    ];
    const params = [
      support_phone || null,
      support_email || null,
      support_whatsapp || null,
      portal_template || 'classic',
      portal_font || 'system',
      portal_welcome || null,
      portal_terms || null,
      advert_link || null,
      contact_email || null,
      contact_phone || null,
      website || null,
      whatsapp_number || null
    ];

    if (advertImageUrl) {
      fields.push('advert_image_url = ?');
      params.push(advertImageUrl);
    } else if (removeAdvert) {
      fields.push('advert_image_url = NULL');
    }

    params.push(tenantId);

    await req.db.query(
      `UPDATE tenants SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    req.flash('success', 'Settings saved.');
    res.redirect('/settings');
  } catch (err) {
    console.error('[Settings] general error:', err.message);
    req.flash('error', 'Failed to save: ' + err.message);
    res.redirect('/settings');
  }
});

// ─── Save colors/branding ───
router.post('/settings/branding', upload, async (req, res) => {
  const user = req.session.user;
  const tenantId = currentTenantId(user);

  const { primary_color, accent_color } = req.body;

  try {
    let logoUrl = null;
    if (req.file) {
      logoUrl = '/uploads/branding/' + req.file.filename;
    }

    const fields = ['primary_color = ?', 'accent_color = ?'];
    const params = [primary_color || '#1a4a8a', accent_color || '#e85d2c'];

    if (logoUrl) {
      fields.push('logo_url = ?');
      params.push(logoUrl);
    }
    params.push(tenantId);

    await req.db.query(
      `UPDATE tenants SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    req.flash('success', 'Branding updated.');
    res.redirect('/settings');
  } catch (err) {
    console.error('[Settings] branding error:', err.message);
    req.flash('error', 'Failed: ' + err.message);
    res.redirect('/settings');
  }
});

// ─── Save SMS gateway ───
router.post('/settings/sms', async (req, res) => {
  const user = req.session.user;
  const tenantId = currentTenantId(user);
  const { sms_gateway, sms_api_key, sms_username, sms_sender_id } = req.body;

  try {
    await req.db.query(
      `UPDATE tenants SET sms_gateway = ?, sms_api_key = ?,
       sms_username = ?, sms_sender_id = ?, updated_at = NOW() WHERE id = ?`,
      [sms_gateway || 'none', sms_api_key || null, sms_username || null, sms_sender_id || null, tenantId]
    );
    req.flash('success', 'SMS gateway settings saved.');
  } catch (err) {
    req.flash('error', 'Failed: ' + err.message);
  }
  res.redirect('/settings');
});

// ─── Save payment gateway ───
router.post('/settings/payment', async (req, res) => {
  const user = req.session.user;
  const tenantId = currentTenantId(user);
  const { payment_gateway, payment_shortcode } = req.body;

  try {
    await req.db.query(
      `UPDATE tenants SET payment_gateway = ?, payment_shortcode = ?,
       updated_at = NOW() WHERE id = ?`,
      [payment_gateway || 'none', payment_shortcode || null, tenantId]
    );
    req.flash('success', 'Payment gateway settings saved.');
  } catch (err) {
    req.flash('error', 'Failed: ' + err.message);
  }
  res.redirect('/settings');
});

// ─── Change password ───
router.post('/settings/password', async (req, res) => {
  const user = req.session.user;
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password) {
    req.flash('error', 'All password fields required.');
    return res.redirect('/settings');
  }

  if (new_password !== confirm_password) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect('/settings');
  }

  if (new_password.length < 6) {
    req.flash('error', 'Password must be at least 6 characters.');
    return res.redirect('/settings');
  }

  try {
    const [rows] = await req.db.query('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!rows.length) {
      req.flash('error', 'User not found.');
      return res.redirect('/settings');
    }

    const ok = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!ok) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/settings');
    }

    const hash = await bcrypt.hash(new_password, 10);
    await req.db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);

    req.flash('success', 'Password changed successfully.');
    res.redirect('/settings');
  } catch (err) {
    req.flash('error', 'Failed: ' + err.message);
    res.redirect('/settings');
  }
});

// ─── Preview portal ───
router.get('/settings/portal-preview', async (req, res) => {
  const user = req.session.user;
  const tenantId = currentTenantId(user);
  const [rows] = await req.db.query('SELECT * FROM tenants WHERE id = ?', [tenantId]);
  if (!rows.length) return res.redirect('/settings');

  res.render('settings/portal-preview', {
    layout: false,
    tenant: rows[0]
  });
});

module.exports = router;

const express = require('express');
const router = express.Router();

// ═══════════════════════════════════════════════════════════
// CAPTIVE PORTAL — public, no login
// Resolves tenant from subdomain OR ?tenant=slug query
// ═══════════════════════════════════════════════════════════

/**
 * Resolve the tenant for a captive request.
 * - Subdomain: demo-isp.billing.ardthonsolutions.com → "demo-isp"
 * - URL prefix: /t/demo-isp/captive → rewritten
 * - Query: /captive?tenant=demo-isp (dev/testing)
 * - Fallback: ?router=ROUTER_ID → look up router's tenant
 */
async function resolveTenant(req) {
  let slug = null;

  // 1. Subdomain
  const host = (req.hostname || '').toLowerCase();
  const parts = host.split('.');
  if (parts.length >= 4 && parts[1] === 'billing') {
    slug = parts[0];
  }

  // 2. Query param
  if (!slug && req.query.tenant) {
    slug = String(req.query.tenant);
  }

  // 3. Router ID → tenant
  if (!slug && req.query.router) {
    const [routers] = await req.db.query(
      'SELECT tenant_id FROM routers WHERE id = ? LIMIT 1',
      [req.query.router]
    );
    if (routers.length) {
      const [t] = await req.db.query('SELECT slug FROM tenants WHERE id = ?', [routers[0].tenant_id]);
      if (t.length) slug = t[0].slug;
    }
  }

  if (!slug) return null;

  const [rows] = await req.db.query(
    `SELECT id, name, slug, tagline, logo_url, favicon_url,
            primary_color, accent_color, contact_email, contact_phone, website,
            whatsapp_number, city, country_code,
            facebook_url, twitter_url, instagram_url,
            support_phone, support_email, support_whatsapp,
            portal_template, portal_font, portal_welcome, portal_terms,
            advert_image_url, advert_link,
            sms_gateway, payment_gateway, payment_shortcode
     FROM tenants WHERE slug = ? AND is_active = 1 LIMIT 1`,
    [slug]
  );

  return rows.length ? rows[0] : null;
}

/**
 * Log a visitor session
 */
async function logSession(db, tenantId, mac, ip, routerId, stage) {
  if (!mac && !ip) return null;
  try {
    const [existing] = await db.query(
      `SELECT id FROM portal_sessions
       WHERE tenant_id = ? AND visitor_mac = ?
       AND created_at > DATE_SUB(NOW(), INTERVAL 12 HOUR)
       ORDER BY id DESC LIMIT 1`,
      [tenantId, mac || '']
    );

    if (existing.length) {
      await db.query(
        'UPDATE portal_sessions SET visitor_ip = ?, stage = ?, updated_at = NOW() WHERE id = ?',
        [ip || null, stage || 'visited', existing[0].id]
      );
      return existing[0].id;
    }

    const [result] = await db.query(
      `INSERT INTO portal_sessions (tenant_id, visitor_mac, visitor_ip, router_id, stage)
       VALUES (?, ?, ?, ?, ?)`,
      [tenantId, mac || null, ip || null, routerId || null, stage || 'visited']
    );
    return result.insertId;
  } catch (e) {
    console.error('[Captive] session log error:', e.message);
    return null;
  }
}

// ─── Main captive entry ───
router.get('/captive', async (req, res) => {
  const tenant = await resolveTenant(req);

  if (!tenant) {
    return res.status(404).render('captive/no-tenant', { layout: false });
  }

  const mac = req.query.mac || null;
  const ip = req.query.ip || null;
  const routerId = req.query.router || null;

  await logSession(req.db, tenant.id, mac, ip, routerId, 'visited');

  // Check for active subscriber with this MAC
  let activeSubscriber = null;
  if (mac) {
    const [subs] = await req.db.query(
      `SELECT id, account_number, full_name, phone, status, expires_at, plan_id
       FROM subscribers
       WHERE tenant_id = ? AND mac_address = ? AND status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [tenant.id, mac]
    );
    if (subs.length) activeSubscriber = subs[0];
  }

  // Load plans
  const [plans] = await req.db.query(
    `SELECT id, name, type, price, duration_hours, data_cap_mb,
            speed_down_kbps, speed_up_kbps, description
     FROM plans WHERE tenant_id = ? AND is_active = 1 AND type = 'hotspot'
     ORDER BY sort_order, price`,
    [tenant.id]
  );

  // Pick template
  const template = tenant.portal_template || 'classic';

  res.render('captive/' + template, {
    layout: false,
    tenant,
    plans,
    mac,
    ip,
    routerId,
    activeSubscriber,
    portalBase: '/captive'
  });
});

// ─── Buy page (choose plan + enter phone) ───
router.get('/captive/buy/:planId', async (req, res) => {
  const tenant = await resolveTenant(req);
  if (!tenant) return res.status(404).render('captive/no-tenant', { layout: false });

  const [plans] = await req.db.query(
    'SELECT * FROM plans WHERE id = ? AND tenant_id = ? AND is_active = 1 AND type = \'hotspot\'',
    [req.params.planId, tenant.id]
  );
  if (!plans.length) {
    return res.redirect('/captive?' + (req.query.tenant ? 'tenant=' + req.query.tenant : ''));
  }

  const template = tenant.portal_template || 'classic';

  res.render('captive/buy', {
    layout: false,
    tenant,
    plan: plans[0],
    mac: req.query.mac || '',
    ip: req.query.ip || '',
    routerId: req.query.router || ''
  });
});

// ─── Submit buy — creates pending payment ───
router.post('/captive/buy/:planId', async (req, res) => {
  const tenant = await resolveTenant(req);
  if (!tenant) return res.status(404).json({ error: 'no tenant' });

  const { phone, mac, ip, router } = req.body;
  if (!phone || phone.length < 9) {
    return res.redirect('/captive/buy/' + req.params.planId + '?tenant=' + tenant.slug);
  }

  try {
    const [plans] = await req.db.query(
      'SELECT * FROM plans WHERE id = ? AND tenant_id = ?',
      [req.params.planId, tenant.id]
    );
    if (!plans.length) return res.redirect('/captive?tenant=' + tenant.slug);

    const plan = plans[0];

    // Find or create subscriber by phone
    let [subs] = await req.db.query(
      'SELECT id, account_number FROM subscribers WHERE tenant_id = ? AND phone = ? LIMIT 1',
      [tenant.id, phone]
    );

    let subscriberId, accountNumber;

    if (subs.length) {
      subscriberId = subs[0].id;
      accountNumber = subs[0].account_number;
      // Update MAC if provided and different
      if (mac) {
        await req.db.query('UPDATE subscribers SET mac_address = ? WHERE id = ? AND (mac_address IS NULL OR mac_address = ?)', [mac, subscriberId, mac]);
      }
    } else {
      // Create new subscriber
      const [c] = await req.db.query('SELECT COUNT(*) + 1 AS n FROM subscribers WHERE tenant_id = ?', [tenant.id]);
      accountNumber = 'S' + String(c[0].n).padStart(5, '0');
      const username = 'u' + Date.now().toString().slice(-8);

      const [result] = await req.db.query(
        `INSERT INTO subscribers
          (tenant_id, account_number, full_name, phone, mac_address, type,
           username, password_plain, status, plan_id)
         VALUES (?, ?, ?, ?, ?, 'hotspot', ?, ?, 'pending', ?)`,
        [tenant.id, accountNumber, 'Guest ' + phone.slice(-4), phone,
         mac || null, username, username + '123', plan.id]
      );
      subscriberId = result.insertId;
    }

    // Create pending payment
    const reference = 'CAPTIVE-' + plan.id + '-SUB-' + subscriberId + '-' + Date.now();
    const [paymentResult] = await req.db.query(
      `INSERT INTO payments
        (tenant_id, subscriber_id, plan_id, amount, method, status, reference, mpesa_phone)
       VALUES (?, ?, ?, ?, 'manual', 'pending', ?, ?)`,
      [tenant.id, subscriberId, plan.id, plan.price, reference, phone]
    );

    // Log event
    try {
      await req.db.query(
        `INSERT INTO subscriber_events (tenant_id, subscriber_id, event_type, details)
         VALUES (?, ?, 'payment_requested', ?)`,
        [tenant.id, subscriberId, JSON.stringify({
          source: 'captive',
          plan_id: plan.id,
          amount: plan.price,
          payment_id: paymentResult.insertId,
          mac
        })]
      );
    } catch (e) { /* silent */ }

    res.redirect('/captive/status/' + paymentResult.insertId + '?tenant=' + tenant.slug + '&mac=' + encodeURIComponent(mac || ''));
  } catch (err) {
    console.error('[Captive] buy error:', err.message);
    res.redirect('/captive?tenant=' + tenant.slug);
  }
});

// ─── Status page (waiting for activation) ───
router.get('/captive/status/:paymentId', async (req, res) => {
  const tenant = await resolveTenant(req);
  if (!tenant) return res.status(404).render('captive/no-tenant', { layout: false });

  const [rows] = await req.db.query(
    `SELECT p.*, s.full_name AS subscriber_name, s.account_number,
            s.status AS subscriber_status, s.expires_at, s.phone,
            pl.name AS plan_name, pl.duration_hours
     FROM payments p
     LEFT JOIN subscribers s ON p.subscriber_id = s.id
     LEFT JOIN plans pl ON p.plan_id = pl.id
     WHERE p.id = ? AND p.tenant_id = ?`,
    [req.params.paymentId, tenant.id]
  );

  if (!rows.length) return res.redirect('/captive?tenant=' + tenant.slug);

  res.render('captive/status', {
    layout: false,
    tenant,
    payment: rows[0],
    mac: req.query.mac || '',
    isActive: rows[0].subscriber_status === 'active' && (!rows[0].expires_at || new Date(rows[0].expires_at) > new Date()),
    portalBase: '/captive'
  });
});

// ─── API: poll payment status (for auto-refresh) ───
router.get('/captive/api/status/:paymentId', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT p.status AS payment_status, p.amount, p.id,
              s.status AS subscriber_status, s.expires_at, s.plan_id,
              s.account_number, pl.name AS plan_name
       FROM payments p
       LEFT JOIN subscribers s ON p.subscriber_id = s.id
       LEFT JOIN plans pl ON p.plan_id = pl.id
       WHERE p.id = ?`,
      [req.params.paymentId]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const r = rows[0];
    const active = r.payment_status === 'completed' &&
                   r.subscriber_status === 'active' &&
                   (!r.expires_at || new Date(r.expires_at) > new Date());
    res.json({ ...r, active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Reconnect — for returning users ───
router.get('/captive/reconnect', async (req, res) => {
  const tenant = await resolveTenant(req);
  if (!tenant) return res.status(404).render('captive/no-tenant', { layout: false });

  const mac = req.query.mac || '';
  let subscriber = null;

  if (mac) {
    const [subs] = await req.db.query(
      `SELECT id, account_number, full_name, phone, status, expires_at, plan_id,
              (SELECT name FROM plans WHERE id = subscribers.plan_id) AS plan_name
       FROM subscribers
       WHERE tenant_id = ? AND mac_address = ?
       ORDER BY id DESC LIMIT 1`,
      [tenant.id, mac]
    );
    if (subs.length) subscriber = subs[0];
  }

  res.render('captive/reconnect', {
    layout: false,
    tenant,
    mac,
    subscriber,
    portalBase: '/captive'
  });
});

// ─── No tenant fallback ───
router.get('/captive/no-tenant', (req, res) => {
  res.render('captive/no-tenant', { layout: false });
});

module.exports = router;

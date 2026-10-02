// Resolves the current tenant from:
//   1. Subdomain: demo-isp.billing.ardthonsolutions.com
//   2. URL prefix: /t/demo-isp/...
//   3. Dev-only query: ?isp=demo-isp (when NODE_ENV !== 'production')

async function tenantResolver(req, res, next) {
  let slug = null;

  // 1. Subdomain detection
  const host = (req.hostname || '').toLowerCase();
  const parts = host.split('.');
  // If host is like demo-isp.billing.ardthonsolutions.com
  if (parts.length >= 4 && parts[1] === 'billing') {
    slug = parts[0];
  }

  // 2. URL prefix: /t/:slug/...
  if (!slug && req.path.startsWith('/t/')) {
    const match = req.path.match(/^\/t\/([a-z0-9-]+)(\/.*)?$/i);
    if (match) {
      slug = match[1];
      // Rewrite URL to strip /t/:slug
      req.url = match[2] || '/';
    }
  }

  // 3. Dev-only query override
  if (!slug && process.env.NODE_ENV !== 'production' && req.query.isp) {
    slug = String(req.query.isp);
  }

  req.tenantSlug = slug || null;
  req.tenant = null;

  if (slug) {
    try {
      const [rows] = await req.db.query(
        `SELECT id, name, slug, tagline, logo_url, favicon_url,
                primary_color, accent_color, contact_email, contact_phone,
                website, whatsapp_number, city, country_code,
                facebook_url, twitter_url, instagram_url, invoice_footer, is_active
         FROM tenants WHERE slug = ? LIMIT 1`,
        [slug]
      );
      if (rows.length && rows[0].is_active) {
        req.tenant = rows[0];
      }
    } catch (e) {
      console.error('[TenantResolver] DB error:', e.message);
    }
  }

  // Make tenant available to views
  res.locals.tenant = req.tenant;
  res.locals.tenantSlug = req.tenantSlug;
  next();
}

module.exports = tenantResolver;

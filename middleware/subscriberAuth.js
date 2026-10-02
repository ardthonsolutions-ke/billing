// Subscriber session guard — separate namespace from admin (req.session.user)

function requireSubscriber(req, res, next) {
  if (!req.session || !req.session.subscriber) {
    return res.redirect(portalPath(req, '/login'));
  }
  // Subscriber must belong to the tenant of the current request
  if (req.tenant && req.session.subscriber.tenant_id !== req.tenant.id) {
    req.session.subscriber = null;
    return res.redirect(portalPath(req, '/login'));
  }
  next();
}

function requireGuestSubscriber(req, res, next) {
  if (req.session && req.session.subscriber) {
    return res.redirect(portalPath(req, '/dashboard'));
  }
  next();
}

// Helper: build correct portal path (with /t/:slug prefix if present)
function portalPath(req, suffix) {
  if (req.tenantSlug) {
    return '/t/' + req.tenantSlug + '/portal' + suffix;
  }
  return '/portal' + suffix;
}

module.exports = { requireSubscriber, requireGuestSubscriber, portalPath };

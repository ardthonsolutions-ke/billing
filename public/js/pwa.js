// ═══════════════════════════════════════════
// Ardthon Billing — PWA bootstrap
// Registers the service worker and handles
// the install prompt for the admin app.
// ═══════════════════════════════════════════
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service workers not supported');
    return;
  }

  // Register the service worker as soon as the page loads
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function (reg) {
        console.log('[PWA] SW registered. Scope:', reg.scope);

        // Check for updates every hour (Passenger keeps the process alive)
        setInterval(function () {
          reg.update().catch(function () {});
        }, 60 * 60 * 1000);
      })
      .catch(function (err) {
        console.warn('[PWA] SW registration failed:', err.message || err);
      });
  });

  // Handle SKIP_WAITING messages from the SW
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'SKIP_WAITING') {
        window.location.reload();
      }
    });
  }
})();

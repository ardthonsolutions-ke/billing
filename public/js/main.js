// Ardthon Billing — client bootstrap
(function () {
  'use strict';
  console.log('[ABS] Client loaded');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(() => console.log('[ABS] SW registered'))
        .catch(err => console.warn('[ABS] SW register failed:', err));
    });
  }
})();

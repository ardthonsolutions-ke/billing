/* Rail health badge — polls /network/api/live every 15s */
(function () {
  'use strict';

  var POLL_MS = 15000;
  var badge = null;

  function setState(state) {
    if (!badge) return;
    if (badge.getAttribute('data-health') === state) return;
    badge.setAttribute('data-health', state);
  }

  function computeState(data) {
    if (!data || !Array.isArray(data.routers)) return 'unknown';
    if (data.routers.length === 0) return 'unknown';
    var ok = data.routers.filter(function (r) { return r.ok; }).length;
    if (ok === data.routers.length) return 'ok';
    if (ok === 0) return 'down';
    return 'warn';
  }

  function poll() {
    fetch('/network/api/live', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        setState(computeState(data));
      })
      .catch(function () {
        setState('down');
      });
  }

  function setup() {
    badge = document.querySelector('.rail-badge');
    if (!badge) { setTimeout(setup, 200); return; }
    poll();
    setInterval(poll, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

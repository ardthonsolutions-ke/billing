/* Rail health badge — polls /network/api/live every 15s */
(function () {
  'use strict';

  var POLL_MS = 15000;
  var badges = [];

  function setState(state) {
    for (var i = 0; i < badges.length; i++) {
      if (badges[i].getAttribute('data-health') !== state) {
        badges[i].setAttribute('data-health', state);
      }
    }
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
    badges = Array.prototype.slice.call(document.querySelectorAll('.rail-badge'));
    if (!badges.length) { setTimeout(setup, 200); return; }
    poll();
    setInterval(poll, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

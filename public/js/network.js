// Network dashboard — live updates every 10 seconds
(function () {
  'use strict';

  var refreshInterval = 10 * 1000;
  var intervalId = null;

  function fetchLive() {
    fetch('/network/api/live', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        // Update the KPI
        var kpi = document.getElementById('kpi-active');
        if (kpi) {
          kpi.textContent = data.totalActive;
          kpi.classList.add('kpi-updating');
          setTimeout(function () { kpi.classList.remove('kpi-updating'); }, 1000);
        }

        // Update router cards — refresh the connected count + status badge
        if (data.routers && Array.isArray(data.routers)) {
          data.routers.forEach(function (r) {
            var card = document.querySelector('.router-card[data-router-id="' + r.id + '"]');
            if (!card) return;

            var badge = card.querySelector('.router-status-badge');
            if (badge) {
              badge.className = 'router-status-badge ' + (r.ok ? 'online' : 'offline');
              badge.textContent = r.ok ? '● Online' : '● Offline';
            }

            var countEl = card.querySelector('.router-active-count');
            if (countEl && typeof r.activeCount !== 'undefined') {
              countEl.innerHTML = '<strong>' + r.activeCount + '</strong> connected';
            }
          });
        }

        // Update revenue/pending KPIs if present
        if (data.today) {
          var pending = document.querySelector('#kpi-pending');
          if (pending && typeof data.today.pending_count !== 'undefined') {
            pending.textContent = data.today.pending_count;
          }
        }
      })
      .catch(function () { /* silent */ });
  }

  function start() {
    if (intervalId) return;
    intervalId = setInterval(fetchLive, refreshInterval);
  }

  function stop() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }

  // Start polling when page is visible; pause when hidden (saves battery on mobile)
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else { fetchLive(); start(); }
  });

  window.addEventListener('load', function () {
    if (!document.hidden) start();
  });
})();

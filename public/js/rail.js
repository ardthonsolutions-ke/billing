(function () {
  'use strict';

  var OPEN_DELAY = 140;
  var CLOSE_DELAY = 220;
  var openTimer = null;
  var closeTimer = null;

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function clearTimers() {
    if (openTimer)  { clearTimeout(openTimer);  openTimer = null; }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  }

  function open() {
    document.body.classList.add('flyout-open');
  }

  function close() {
    document.body.classList.remove('flyout-open');
  }

  function setup() {
    var rail = document.querySelector('.abs-rail');
    var sidebar = document.querySelector('.abs-sidebar');

    console.log('[Rail] Setting up. Rail found:', !!rail, 'Sidebar found:', !!sidebar);

    if (!rail || !sidebar) {
      // Rail not in DOM yet — retry in 100ms
      setTimeout(setup, 100);
      return;
    }

    // Idempotent — remove existing listener if re-running
    rail.onmouseenter = function () {
      if (isMobile()) return;
      clearTimers();
      openTimer = setTimeout(open, OPEN_DELAY);
    };

    rail.onmouseleave = function (e) {
      if (isMobile()) return;
      clearTimers();
      var rel = e.relatedTarget;
      if (rel && sidebar.contains(rel)) return;
      closeTimer = setTimeout(close, CLOSE_DELAY);
    };

    sidebar.onmouseenter = function () {
      if (isMobile()) return;
      clearTimers();
    };

    sidebar.onmouseleave = function (e) {
      if (isMobile()) return;
      clearTimers();
      var rel = e.relatedTarget;
      if (rel && rail.contains(rel)) return;
      closeTimer = setTimeout(close, CLOSE_DELAY);
    };

    // Close on click outside (helps mobile drawer)
    document.onclick = function (e) {
      if (isMobile()) return;
      if (!document.body.classList.contains('flyout-open')) return;
      if (rail.contains(e.target)) return;
      if (sidebar.contains(e.target)) return;
      close();
    };

    // Escape closes
    document.onkeydown = function (e) {
      if (e.key === 'Escape') { clearTimers(); close(); }
    };

    // Log for debugging
    console.log('[Rail] Listeners attached');
  }

  // Run setup immediately if DOM is ready, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }

  window.ABSRail = { open: open, close: close };
})();

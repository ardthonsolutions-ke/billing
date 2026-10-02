// Settings page — tab switching
(function () {
  'use strict';

  function init() {
    var tabs = document.querySelectorAll('.settings-tab');
    var panels = document.querySelectorAll('.settings-panel');

    if (!tabs.length || !panels.length) return;

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.getAttribute('data-tab');
        tabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
        panels.forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-panel') === name); });
        try { history.replaceState(null, '', '#' + name); } catch (e) {}
      });
    });

    // Restore from URL hash
    var hash = (location.hash || '').replace('#', '');
    if (hash) {
      var target = document.querySelector('.settings-tab[data-tab="' + hash + '"]');
      if (target) target.click();
    }
  }

  // Run as soon as DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

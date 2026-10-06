(function () {
  'use strict';

  var STORAGE_KEY = 'abs-theme';
  var VALID = ['light', 'dark', 'system'];

  function getStored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return VALID.indexOf(v) >= 0 ? v : 'system';
    } catch (e) { return 'system'; }
  }

  function resolve(mode) {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
  }

  function apply() {
    var mode = getStored();
    var resolved = resolve(mode);
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-mode', mode);
    updateButtons(mode);
  }

  function updateButtons(mode) {
    var btns = document.querySelectorAll('.theme-btn[data-mode]');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
  }

  function setMode(mode) {
    if (VALID.indexOf(mode) < 0) mode = 'system';
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) {}
    apply();
  }

  // Apply immediately (before paint if possible)
  apply();

  // Wire toggle buttons once DOM is ready
  document.addEventListener('DOMContentLoaded', function () {
    apply();

    document.querySelectorAll('.theme-btn[data-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.getAttribute('data-mode'));
      });
    });

    // React to system changes when in "system" mode
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (getStored() === 'system') apply();
    });
  });

  // Expose for debugging
  window.ABSTheme = { get: getStored, set: setMode, apply: apply };
})();

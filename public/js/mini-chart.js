(function () {
  'use strict';

  function sparkline(el, data, opts) {
    if (!el || !data || !data.length) return;
    opts = opts || {};
    var w = el.clientWidth || 200;
    var h = parseInt(el.getAttribute('data-height') || '40', 10);
    var pad = 4;
    var min = Math.min.apply(null, data);
    var max = Math.max.apply(null, data);
    var range = max - min || 1;
    var step = (w - pad * 2) / (data.length - 1 || 1);

    var points = data.map(function (v, i) {
      var x = pad + i * step;
      var y = h - pad - ((v - min) / range) * (h - pad * 2);
      return [x, y];
    });

    var path = 'M' + points.map(function (p) { return p[0] + ',' + p[1]; }).join(' L');
    var fillPath = path + ' L' + (w - pad) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';

    el.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    el.setAttribute('preserveAspectRatio', 'none');
    el.innerHTML = '<path class="fill" d="' + fillPath + '"></path><path class="line" d="' + path + '"></path>';
  }

  function renderAll() {
    document.querySelectorAll('.sparkline[data-values]').forEach(function (el) {
      try {
        var data = JSON.parse(el.getAttribute('data-values'));
        sparkline(el, data);
      } catch (e) {}
    });
  }

  document.addEventListener('DOMContentLoaded', renderAll);
  window.addEventListener('load', renderAll);
  window.addEventListener('resize', function () {
    clearTimeout(window.__sparkResize);
    window.__sparkResize = setTimeout(renderAll, 200);
  });

  window.ABSSpark = { render: sparkline, renderAll: renderAll };
})();

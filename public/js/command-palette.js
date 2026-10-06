(function () {
  'use strict';

  var backdrop, input, results, selectedIndex = 0, currentItems = [];

  var COMMANDS = [
    { group: 'Navigation', title: 'Dashboard', desc: 'Overview and quick actions', url: '/dashboard', icon: 'home' },
    { group: 'Navigation', title: 'Network', desc: 'Routers and live sessions', url: '/network', icon: 'activity' },
    { group: 'Navigation', title: 'Reports', desc: 'Revenue and analytics', url: '/reports', icon: 'chart' },
    { group: 'Navigation', title: 'Plans', desc: 'Packages and pricing', url: '/plans', icon: 'plan' },
    { group: 'Navigation', title: 'Subscribers', desc: 'All customers', url: '/subscribers', icon: 'users' },
    { group: 'Navigation', title: 'Routers', desc: 'NAS devices', url: '/routers', icon: 'router' },
    { group: 'Navigation', title: 'Payments', desc: 'Transactions', url: '/payments', icon: 'credit' },
    { group: 'Navigation', title: 'Tickets', desc: 'Support requests', url: '/tickets', icon: 'ticket' },
    { group: 'Navigation', title: 'Leads', desc: 'Pre-sales pipeline', url: '/leads', icon: 'lead' },
    { group: 'Navigation', title: 'Settings', desc: 'System configuration', url: '/settings', icon: 'settings' },
    { group: 'Create', title: 'New subscriber', desc: 'Add a new customer', url: '/subscribers/new', icon: 'plus' },
    { group: 'Create', title: 'New plan', desc: 'Create a package', url: '/plans/new', icon: 'plus' },
    { group: 'Create', title: 'New router', desc: 'Add NAS device', url: '/routers/new', icon: 'plus' },
    { group: 'Create', title: 'New ticket', desc: 'Open support request', url: '/tickets/new', icon: 'plus' },
    { group: 'Create', title: 'New lead', desc: 'Capture a prospect', url: '/leads/new', icon: 'plus' },
    { group: 'Account', title: 'Settings', desc: 'Preferences and branding', url: '/settings', icon: 'settings' },
    { group: 'Account', title: 'Log out', desc: 'Sign out of this session', url: '/logout', icon: 'logout' }
  ];

  var ICONS = {
    home: '<path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5z"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-7"/>',
    plan: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
    router: '<rect x="2" y="14" width="20" height="8" rx="2"/><path d="M12 2v6"/><path d="M8 4l4 4 4-4"/>',
    credit: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    ticket: '<path d="M2 9a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v1a2 2 0 0 0 0 4v1a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-1a2 2 0 0 0 0-4V9z"/>',
    lead: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'
  };

  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || ICONS.plan) + '</svg>';
  }

  function open() {
    if (!backdrop) build();
    backdrop.classList.add('open');
    setTimeout(function () { input.focus(); }, 10);
    input.value = '';
    render('');
  }

  function close() {
    if (backdrop) backdrop.classList.remove('open');
  }

  function build() {
    backdrop = document.createElement('div');
    backdrop.className = 'cmdk-backdrop';
    backdrop.innerHTML =
      '<div class="cmdk-dialog" role="dialog" aria-label="Command palette">' +
        '<div class="cmdk-input-wrap">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
          '<input type="text" class="cmdk-input" placeholder="Search pages, actions, subscribers..." autocomplete="off">' +
          '<span class="cmdk-kbd">ESC</span>' +
        '</div>' +
        '<div class="cmdk-results"></div>' +
      '</div>';
    document.body.appendChild(backdrop);

    input = backdrop.querySelector('.cmdk-input');
    results = backdrop.querySelector('.cmdk-results');

    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) close();
    });
  }

  function render(query) {
    var q = (query || '').trim().toLowerCase();
    var filtered = q
      ? COMMANDS.filter(function (c) {
          return (c.title + ' ' + c.desc + ' ' + c.group).toLowerCase().indexOf(q) >= 0;
        })
      : COMMANDS;

    currentItems = filtered;
    selectedIndex = 0;

    if (!filtered.length) {
      results.innerHTML = '<div class="cmdk-empty">No results for "' + escapeHtml(query) + '"</div>';
      return;
    }

    var html = '';
    var lastGroup = null;
    filtered.forEach(function (c, i) {
      if (c.group !== lastGroup) {
        html += '<div class="cmdk-section-label">' + c.group + '</div>';
        lastGroup = c.group;
      }
      html +=
        '<a href="' + c.url + '" class="cmdk-item' + (i === 0 ? ' selected' : '') + '" data-idx="' + i + '">' +
          '<span class="cmdk-item-icon">' + svg(c.icon) + '</span>' +
          '<span class="cmdk-item-body">' +
            '<span class="cmdk-item-title">' + escapeHtml(c.title) + '</span>' +
            '<span class="cmdk-item-desc">' + escapeHtml(c.desc) + '</span>' +
          '</span>' +
        '</a>';
    });
    results.innerHTML = html;
  }

  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, currentItems.length - 1);
      updateSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateSelection();
    } else if (e.key === 'Enter') {
      var item = results.querySelector('.cmdk-item.selected');
      if (item) { window.location.href = item.getAttribute('href'); }
    }
  }

  function updateSelection() {
    results.querySelectorAll('.cmdk-item').forEach(function (el) {
      el.classList.toggle('selected', parseInt(el.getAttribute('data-idx'), 10) === selectedIndex);
    });
    var sel = results.querySelector('.cmdk-item.selected');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Global listener: Cmd/Ctrl + K
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (backdrop && backdrop.classList.contains('open')) close();
      else open();
    }
  });

  window.ABSCommand = { open: open, close: close };
})();

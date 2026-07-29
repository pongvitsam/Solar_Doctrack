/**
 * PEA Solar DocTrack — static SPA client (GitHub Pages).
 * Uses window.MockAPI (localStorage) — no Apps Script bridge.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'pea_doctrack_token';
  var state = {
    boot: null,
    session: null,
    route: 'dashboard',
    routeParams: {},
    viewMode: 'table',
    dashboard: null,
    project: null,
    reviewQueue: null,
    users: null,
    notifications: null,
    audit: null,
    settings: null,
    loading: false,
    sidebarOpen: false,
    filters: { q: '', status: '', sort: 'updated' },
    modal: null,
    unreadNotifications: 0
  };

  var STATUS_LABEL = {
    Draft: 'ร่าง',
    Submitted: 'ส่งตรวจแล้ว',
    NeedsRevision: 'ขอแก้ไข',
    Completed: 'ยอมรับแล้ว',
    Empty: 'ยังไม่อัปโหลด',
    Uploaded: 'อัปโหลดแล้ว',
    Accepted: 'ยอมรับ'
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'className') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function toast(msg, type) {
    var wrap = $('#toastWrap');
    if (!wrap) {
      wrap = el('div', { className: 'toast-wrap', id: 'toastWrap' });
      document.body.appendChild(wrap);
    }
    var t = el('div', { className: 'toast ' + (type || ''), text: msg });
    wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var THAI_MONTHS_FULL = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  function parseDateFlexible(iso) {
    if (!iso) return null;
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDateThaiBE(iso) {
    var d = parseDateFlexible(iso);
    if (!d) return '—';
    return d.getDate() + ' ' + THAI_MONTHS_FULL[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  }

  function toDateInputValue(iso) {
    var d = parseDateFlexible(iso);
    if (!d) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function elDateBE(iso) {
    return el('span', { className: 'date-be-wrap' }, [
      el('span', { className: 'date-be', text: fmtDateThaiBE(iso) })
    ]);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) { return String(iso); }
  }

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function api(fnName) {
    var args = Array.prototype.slice.call(arguments, 1);
    var fn = window.MockAPI && window.MockAPI[fnName];
    if (!fn) return Promise.reject(new Error('API not found: ' + fnName));
    return fn.apply(null, args);
  }
  function setLoading(v) {
    state.loading = !!v;
    var bar = $('#globalLoading');
    if (bar) bar.style.display = v ? 'block' : 'none';
  }

  async function withLoad(fn) {
    setLoading(true);
    try { return await fn(); }
    finally { setLoading(false); }
  }

  function navigate(route, params) {
    state.route = route;
    state.routeParams = params || {};
    state.sidebarOpen = false;
    render();
    loadRouteData();
  }

  function isGTHP() { return state.session && state.session.role === 'GTHP'; }
  function isKHT() { return state.session && state.session.role === 'KHT'; }

  var LOGIN_DEMO_FALLBACK = [
    { employeeId: 'KHT001', role: 'KHT', name: 'สมชาย กขท.' },
    { employeeId: 'GTHP001', role: 'GTHP', name: 'อรุณี กธพ.' }
  ];

  function roleLabelTh(role) {
    if (role === 'KHT') return 'กขท.';
    if (role === 'GTHP') return 'กธพ.';
    return role || '—';
  }

  function getLoginDemoAccounts() {
    var list = (state.boot && state.boot.demoAccounts) || LOGIN_DEMO_FALLBACK;
    if (!list.length) return LOGIN_DEMO_FALLBACK;
    return list;
  }

  function renderLoginDemoPanel() {
    var wrap = el('div', { className: 'demo-login-panel' });
    wrap.appendChild(el('div', { className: 'demo-login-title', text: 'บัญชีตัวอย่าง — เลือกกองก่อนเข้าใช้งาน' }));
    var grid = el('div', { className: 'demo-login-grid' });
    getLoginDemoAccounts().forEach(function (a) {
      grid.appendChild(el('button', {
        type: 'button',
        className: 'demo-login-card demo-login-card--' + String(a.role || '').toLowerCase(),
        onClick: function () {
          var inp = $('#empId');
          if (inp) {
            inp.value = a.employeeId;
            inp.focus();
          }
        }
      }, [
        el('span', { className: 'demo-login-role', text: roleLabelTh(a.role) }),
        el('span', { className: 'demo-login-id', text: a.employeeId }),
        el('span', { className: 'demo-login-name', text: a.name || '' }),
        el('span', { className: 'demo-login-action', text: 'คลิกเพื่อใส่รหัส' })
      ]));
    });
    wrap.appendChild(grid);
    wrap.appendChild(el('p', { className: 'hint demo-login-hint', text: 'จากนั้นกด «เข้าสู่ระบบ» (รหัสอื่นในระบบยังใช้ได้ตามปกติ)' }));
    return wrap;
  }

  function setUnreadNotifications(count) {
    state.unreadNotifications = Math.max(0, Number(count) || 0);
  }

  async function refreshUnreadCount() {
    if (!state.session) {
      setUnreadNotifications(0);
      return;
    }
    try {
      var data = await api('apiGetNotifications', getToken());
      var list = data.notifications || [];
      setUnreadNotifications(list.filter(function (n) { return !n.read; }).length);
    } catch (e) { /* keep previous count */ }
  }

  function navBtnChildren(item) {
    var wrap = el('span', { style: 'display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px' }, [
      el('span', { text: item.label })
    ]);
    if (item.id === 'notifications' && state.unreadNotifications > 0) {
      wrap.appendChild(el('span', {
        className: 'nav-badge',
        text: state.unreadNotifications > 99 ? '99+' : String(state.unreadNotifications)
      }));
    }
    return [wrap];
  }

  // ---- Boot ----
  async function boot() {
    try {
      var data = await api('apiGetBootstrap', getToken());
      state.boot = data;
      state.session = data.session;
      if (state.session && state.session.token) setToken(state.session.token);
      if (state.session) await refreshUnreadCount();
      render();
      if (state.session) loadRouteData();
    } catch (e) {
      $('#app').innerHTML = '';
      $('#app').appendChild(el('div', { className: 'login-page' }, [
        el('div', { className: 'login-card' }, [
          el('div', { className: 'error-box', text: 'โหลดไม่สำเร็จ: ' + e.message }),
          el('p', { className: 'hint', text: 'ข้อมูล mock เก็บใน localStorage — กดรีเซ็ตจากหน้าตั้งค่า (GTHP) ได้' }),
          el('button', { className: 'btn btn-primary', type: 'button', onClick: function () { location.reload(); } }, ['ลองใหม่'])
        ])
      ]));
    }
  }

  async function loadRouteData() {
    if (!state.session) return;
    try {
      await withLoad(async function () {
        if (state.route === 'dashboard') {
          state.dashboard = await api('apiGetDashboard', getToken());
        } else if (state.route === 'project') {
          state.project = await api('apiGetProject', getToken(), state.routeParams.id);
        } else if (state.route === 'review') {
          state.reviewQueue = await api('apiGetReviewQueue', getToken());
        } else if (state.route === 'users') {
          state.users = await api('apiListUsers', getToken());
        } else if (state.route === 'notifications') {
          state.notifications = await api('apiGetNotifications', getToken());
        } else if (state.route === 'audit') {
          state.audit = await api('apiGetAuditLogs', getToken(), 200);
        } else if (state.route === 'settings' || state.route === 'email') {
          state.settings = await api('apiGetSettings', getToken());
          if (state.route === 'email') {
            var boot = await api('apiGetBootstrap', getToken());
            state.session = boot.session;
          }
        } else if (state.route === 'contracts' || state.route === 'contract') {
          state.dashboard = await api('apiGetDashboard', getToken());
        }
        if (state.dashboard && state.dashboard.kpi && state.dashboard.kpi.unreadNotifications != null) {
          setUnreadNotifications(state.dashboard.kpi.unreadNotifications);
        }
        await refreshUnreadCount();
      });
      render();
    } catch (e) {
      toast(e.message, 'err');
      render();
    }
  }

  // ---- Render ----
  function render() {
    var root = $('#app');
    root.innerHTML = '';
    if (!state.session) {
      root.appendChild(renderLogin());
      return;
    }
    root.appendChild(renderShell());
    if (state.modal) root.appendChild(renderModal());
  }

  function renderLogin() {
    var page = el('div', { className: 'login-page' });
    var card = el('div', { className: 'login-card' });
    card.appendChild(el('div', { className: 'brand-block' }, [
      el('div', { className: 'brand-logo', text: 'PEA' }),
      el('h1', { text: 'Solar DocTrack' }),
      el('p', { text: 'ติดตามเอกสารโครงการโซลาร์รูฟท็อป' })
    ]));
    card.appendChild(renderLoginDemoPanel());
    card.appendChild(el('div', { className: 'auth-warn', text: (state.boot && state.boot.authWarning) || '' }));

    var form = el('form', {
      onSubmit: function (ev) {
        ev.preventDefault();
        doLogin($('#empId').value.trim());
      }
    });
    form.appendChild(el('div', { className: 'field' }, [
      el('label', { text: 'รหัสพนักงาน' }),
      el('input', { id: 'empId', name: 'employeeId', placeholder: 'เช่น KHT001', autocomplete: 'username', required: 'required' })
    ]));
    form.appendChild(el('button', { className: 'btn btn-primary', type: 'submit', style: 'width:100%' }, ['เข้าสู่ระบบ']));
    card.appendChild(form);

    var setupBtn = el('button', {
      className: 'btn btn-ghost', type: 'button', style: 'width:100%;margin-top:10px',
      onClick: async function () {
        try {
          await withLoad(async function () {
            await api('apiRunSetup', '');
          });
          toast('Mock data พร้อมแล้ว — ลองเข้าสู่ระบบด้วย KHT001', 'ok');
          boot();
        } catch (e) { toast(e.message, 'err'); }
      }
    }, ['เตรียม / เติม Mock Data']);
    card.appendChild(setupBtn);
    page.appendChild(card);
    return page;
  }

  async function doLogin(employeeId) {
    try {
      var data = await withLoad(function () { return api('apiLogin', employeeId); });
      state.session = data.session;
      setToken(data.session.token);
      state.route = 'dashboard';
      toast('ยินดีต้อนรับ ' + data.session.name, 'ok');
      render();
      loadRouteData();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function doLogout() {
    try { await api('apiLogout', getToken()); } catch (e) {}
    setToken('');
    state.session = null;
    state.dashboard = null;
    render();
  }

  function navItems() {
    var items = [
      { id: 'dashboard', label: 'แดชบอร์ด' },
      { id: 'contracts', label: 'สัญญา' },
      { id: 'notifications', label: 'การแจ้งเตือน' },
      { id: 'email', label: 'การแจ้งเตือนอีเมล' }
    ];
    if (isGTHP()) {
      items.splice(2, 0, { id: 'review', label: 'คิวตรวจเอกสาร' });
      items.push({ id: 'users', label: 'รหัสเข้าใช้งาน' });
      items.push({ id: 'audit', label: 'Audit Log' });
      items.push({ id: 'settings', label: 'ตั้งค่า' });
    }
    return items;
  }

  function renderShell() {
    var shell = el('div', { className: 'app-shell' });
    shell.appendChild(el('div', {
      className: 'overlay' + (state.sidebarOpen ? ' show' : ''),
      onClick: function () { state.sidebarOpen = false; render(); }
    }));

    var side = el('aside', { className: 'sidebar' + (state.sidebarOpen ? ' open' : '') });
    side.appendChild(el('div', { className: 'sidebar-brand' }, [
      el('div', { className: 'mark', text: 'PEA' }),
      el('div', null, [
        el('strong', { text: 'Solar DocTrack' }),
        el('span', { text: 'เอกสารโซลาร์รูฟท็อป' })
      ])
    ]));
    navItems().forEach(function (n) {
      side.appendChild(el('button', {
        className: 'nav-btn' + ((state.route === n.id || (n.id === 'contracts' && state.route === 'contract')) ? ' active' : ''),
        type: 'button',
        onClick: function () { navigate(n.id); }
      }, navBtnChildren(n)));
    });
    side.appendChild(el('div', { className: 'sidebar-footer' }, [
      el('div', { text: state.session.name }),
      el('div', null, [
        el('span', { className: 'role-tag', text: state.session.role === 'KHT' ? 'กขท.' : 'กธพ.' })
      ]),
      el('button', { className: 'btn btn-ghost btn-sm', type: 'button', style: 'margin-top:10px;width:100%;color:#1e1228', onClick: doLogout }, ['ออกจากระบบ'])
    ]));
    shell.appendChild(side);

    var main = el('main', { className: 'main' });
    main.appendChild(el('div', { id: 'globalLoading', className: 'loading-box', style: 'display:none', text: 'กำลังโหลด…' }));
    main.appendChild(renderTopbar());
    main.appendChild(renderPage());
    shell.appendChild(main);
    return shell;
  }

  function renderTopbar() {
    var titles = {
      dashboard: 'แดชบอร์ดโครงการ',
      contracts: 'สัญญา',
      contract: 'รายละเอียดสัญญา',
      project: 'รายละเอียดโครงการ',
      review: 'คิวตรวจเอกสาร (กธพ.)',
      notifications: 'การแจ้งเตือน',
      users: 'รหัสเข้าใช้งาน',
      audit: 'Audit Log',
      settings: 'ตั้งค่าระบบ',
      email: 'การตั้งค่าอีเมล'
    };
    var bar = el('div', { className: 'topbar' });
    bar.appendChild(el('div', { style: 'display:flex;align-items:center;gap:8px' }, [
      el('button', {
        className: 'menu-toggle', type: 'button',
        onClick: function () { state.sidebarOpen = !state.sidebarOpen; render(); }
      }, ['เมนู']),
      el('h2', { text: (state.route === 'notifications' && state.unreadNotifications > 0)
        ? ('การแจ้งเตือน (' + state.unreadNotifications + ')')
        : (titles[state.route] || 'PEA Solar DocTrack') })
    ]));
    var actions = el('div', { className: 'topbar-actions' });
    if (state.route === 'dashboard') {
      if (isKHT()) {
        actions.appendChild(el('button', { className: 'btn btn-gold btn-sm', type: 'button', onClick: openContractModal }, ['+ สัญญา']));
        actions.appendChild(el('button', { className: 'btn btn-primary btn-sm', type: 'button', onClick: openProjectModal }, ['+ โครงการ']));
      }
    }
    if (state.route === 'contracts' && isKHT()) {
      actions.appendChild(el('button', { className: 'btn btn-gold btn-sm', type: 'button', onClick: openContractModal }, ['+ สัญญา']));
    }
    if (state.route === 'contract') {
      actions.appendChild(el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick: function () { navigate('contracts'); } }, ['← กลับรายการสัญญา']));
      if (isKHT()) {
        actions.appendChild(el('button', { className: 'btn btn-primary btn-sm', type: 'button', onClick: openProjectModal }, ['+ โครงการในสัญญานี้']));
      }
    }
    if (state.route === 'project' && state.project) {
      var backContractId = state.project.project && state.project.project.contractId;
      actions.appendChild(el('button', {
        className: 'btn btn-ghost btn-sm', type: 'button',
        onClick: function () {
          if (backContractId) navigate('contract', { id: backContractId });
          else navigate('dashboard');
        }
      }, ['← กลับ']));
    }
    bar.appendChild(actions);
    return bar;
  }

  function renderPage() {
    switch (state.route) {
      case 'dashboard': return renderDashboard();
      case 'contracts': return renderContracts();
      case 'contract': return renderContractDetail();
      case 'project': return renderProject();
      case 'review': return renderReview();
      case 'notifications': return renderNotifications();
      case 'users': return renderUsers();
      case 'audit': return renderAudit();
      case 'settings': return renderSettings();
      case 'email': return renderEmailPrefs();
      default: return el('div', { className: 'empty', text: 'ไม่พบหน้า' });
    }
  }

  function chip(status) {
    return el('span', { className: 'chip chip-' + status, text: STATUS_LABEL[status] || status });
  }

  function filteredProjects(contractId) {
    var list = (state.dashboard && state.dashboard.projects) || [];
    var q = (state.filters.q || '').toLowerCase();
    var st = state.filters.status;
    var out = list.filter(function (p) {
      if (contractId && p.project.contractId !== contractId) return false;
      if (st && p.project.status !== st) return false;
      if (!q) return true;
      var hay = [p.project.name, p.project.projectCode, p.contract && p.contract.contractNo, p.owner && p.owner.name]
        .join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    out.sort(function (a, b) {
      if (state.filters.sort === 'name') return a.project.name.localeCompare(b.project.name, 'th');
      if (state.filters.sort === 'status') return a.project.status.localeCompare(b.project.status);
      if (state.filters.sort === 'progress') return (b.percent || 0) - (a.percent || 0);
      return String(b.project.updatedAt || '').localeCompare(String(a.project.updatedAt || ''));
    });
    return out;
  }

  function renderToolbar(opts) {
    opts = opts || {};
    var bar = el('div', { className: 'toolbar' });
    var search = el('input', {
      className: 'search-input',
      placeholder: opts.searchPlaceholder || 'ค้นหาโครงการ / สัญญา / ผู้รับผิดชอบ',
      value: state.filters.q || ''
    });
    search.addEventListener('input', function () {
      state.filters.q = search.value;
      render();
    });
    bar.appendChild(search);

    var status = el('select', { className: 'filter-select', style: 'max-width:160px' });
    [['', 'ทุกสถานะ'], ['Draft', 'ร่าง'], ['Submitted', 'ส่งตรวจ'], ['NeedsRevision', 'ขอแก้ไข'], ['Completed', 'ยอมรับ']].forEach(function (o) {
      var opt = el('option', { value: o[0], text: o[1] });
      if (state.filters.status === o[0]) opt.selected = true;
      status.appendChild(opt);
    });
    status.addEventListener('change', function () { state.filters.status = status.value; render(); });
    bar.appendChild(status);

    var sort = el('select', { className: 'filter-select', style: 'max-width:160px' });
    [['updated', 'ล่าสุด'], ['name', 'ชื่อ'], ['status', 'สถานะ'], ['progress', 'ความคืบหน้า']].forEach(function (o) {
      var opt = el('option', { value: o[0], text: o[1] });
      if (state.filters.sort === o[0]) opt.selected = true;
      sort.appendChild(opt);
    });
    sort.addEventListener('change', function () { state.filters.sort = sort.value; render(); });
    bar.appendChild(sort);

    var toggle = el('div', { className: 'view-toggle' }, [
      el('button', {
        type: 'button', className: state.viewMode === 'cards' ? 'active' : '',
        onClick: function () { state.viewMode = 'cards'; render(); }
      }, ['การ์ด']),
      el('button', {
        type: 'button', className: state.viewMode === 'table' ? 'active' : '',
        onClick: function () { state.viewMode = 'table'; render(); }
      }, ['ตาราง'])
    ]);
    bar.appendChild(toggle);
    return bar;
  }

  function renderDashboard() {
    var wrap = el('div');
    if (!state.dashboard) return el('div', { className: 'loading-box', text: 'กำลังโหลดแดชบอร์ด…' });
    var kpi = state.dashboard.kpi || {};
    var grid = el('div', { className: 'kpi-grid' });
    [
      ['โครงการทั้งหมด', kpi.totalProjects, false],
      ['ร่าง', kpi.draft, false],
      ['ส่งตรวจ', kpi.submitted, true],
      ['ขอแก้ไข', kpi.needsRevision, false],
      ['ยอมรับแล้ว', kpi.completed, false]
    ].forEach(function (k) {
      grid.appendChild(el('div', { className: 'kpi' + (k[2] ? ' gold' : '') }, [
        el('div', { className: 'label', text: k[0] }),
        el('div', { className: 'value', text: String(k[1] == null ? 0 : k[1]) })
      ]));
    });
    wrap.appendChild(grid);

    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [
      el('h3', { text: 'รายการโครงการ' }),
      el('span', { className: 'hint', text: 'แจ้งเตือนยังไม่อ่าน: ' + (kpi.unreadNotifications || 0) })
    ]));
    panel.appendChild(renderToolbar());
    panel.appendChild(renderProjectList(filteredProjects()));
    wrap.appendChild(panel);
    return wrap;
  }

  function renderProjectList(list, hideContract) {
    if (!list.length) return el('div', { className: 'empty', text: 'ไม่พบโครงการตามเงื่อนไข' });
    if (state.viewMode === 'table') {
      var wrap = el('div', { className: 'table-wrap' });
      var table = el('table', { className: 'data project-summary-table' });
      var headers = hideContract
        ? ['ชื่อโครงการ', 'จำนวนสถานที่', 'วันที่ลงนามในสัญญา', 'สถานะ']
        : ['เลขที่สัญญา', 'ชื่อโครงการ', 'จำนวนสถานที่', 'วันที่ลงนามในสัญญา', 'สถานะ'];
      table.appendChild(el('thead', null, [
        el('tr', null, headers.map(function (h) { return el('th', { text: h }); }))
      ]));
      var tb = el('tbody');
      list.forEach(function (p) {
        var cells = [];
        if (!hideContract) {
          cells.push(el('td', { text: (p.contract && p.contract.contractNo) || '—' }));
        }
        cells.push(
          el('td', null, [
            el('strong', { text: p.project.name }),
            el('div', { className: 'hint', text: p.project.projectCode })
          ]),
          el('td', { className: 'num-cell', text: String(p.siteCount != null ? p.siteCount : 0) + ' แห่ง' }),
          el('td', null, [elDateBE(p.contract && p.contract.signedAt)]),
          el('td', null, [chip(p.project.status)])
        );
        tb.appendChild(el('tr', {
          className: 'clickable',
          onClick: function () { navigate('project', { id: p.project.id }); }
        }, cells));
      });
      table.appendChild(tb);
      wrap.appendChild(table);
      return wrap;
    }
    var cards = el('div', { className: 'cards' });
    list.forEach(function (p) {
      cards.appendChild(el('div', {
        className: 'card',
        onClick: function () { navigate('project', { id: p.project.id }); }
      }, [
        el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:start' }, [
          el('h4', { text: p.project.name }),
          chip(p.project.status)
        ]),
        el('div', { className: 'meta', text: 'เลขที่สัญญา ' + ((p.contract && p.contract.contractNo) || '—') }),
        el('div', { className: 'meta', text: 'จำนวนสถานที่ ' + (p.siteCount != null ? p.siteCount : 0) + ' แห่ง' }),
        el('div', { style: 'margin:8px 0' }, [elDateBE(p.contract && p.contract.signedAt)]),
        el('div', { className: 'progress' }, [el('span', { style: 'width:' + p.percent + '%' })]),
        el('div', { className: 'meta', text: 'ความคืบหน้าเอกสาร ' + p.requiredDone + '/' + p.requiredTotal })
      ]));
    });
    return cards;
  }

  function countProjectsForContract_(contractId) {
    return filteredProjects(contractId).length;
  }

  function getContractById_(contractId) {
    var contracts = (state.dashboard && state.dashboard.contracts) || [];
    for (var i = 0; i < contracts.length; i++) {
      if (String(contracts[i].id) === String(contractId)) return contracts[i];
    }
    return null;
  }

  function renderContracts() {
    if (!state.dashboard) return el('div', { className: 'loading-box', text: 'กำลังโหลด…' });
    var wrap = el('div');
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [
      el('h3', { text: 'สัญญา' }),
      el('span', { className: 'hint', text: 'คลิกแถวเพื่อดูโครงการในสัญญา' })
    ]));
    var contracts = state.dashboard.contracts || [];
    if (!contracts.length) panel.appendChild(el('div', { className: 'empty', text: 'ยังไม่มีสัญญา' }));
    else {
      var tw = el('div', { className: 'table-wrap' });
      var table = el('table', { className: 'data' });
      table.appendChild(el('thead', null, [el('tr', null, ['เลขที่', 'ชื่อ', 'วันที่ลงนาม', 'โครงการ', ''].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      contracts.forEach(function (c) {
        var actions = el('td');
        if (isKHT() || isGTHP()) {
          actions.appendChild(el('button', {
            className: 'btn btn-ghost btn-sm', type: 'button',
            onClick: function (ev) { ev.stopPropagation(); openContractModal(c); }
          }, ['แก้ไข']));
        }
        tb.appendChild(el('tr', {
          className: 'clickable',
          onClick: function () { navigate('contract', { id: c.id }); }
        }, [
          el('td', { text: c.contractNo }),
          el('td', { text: c.title }),
          el('td', null, [elDateBE(c.signedAt)]),
          el('td', { text: String(countProjectsForContract_(c.id)) }),
          actions
        ]));
      });
      table.appendChild(tb);
      tw.appendChild(table);
      panel.appendChild(tw);
    }
    wrap.appendChild(panel);
    return wrap;
  }

  function renderContractDetail() {
    if (!state.dashboard) return el('div', { className: 'loading-box', text: 'กำลังโหลด…' });
    var contract = getContractById_(state.routeParams.id);
    if (!contract) return el('div', { className: 'error-box', text: 'ไม่พบสัญญา' });

    var wrap = el('div');
    var head = el('div', { className: 'panel' });
    var headRow = el('div', { className: 'panel-h' }, [
      el('div', null, [
        el('h3', { text: contract.title }),
        el('div', { className: 'hint', text: contract.contractNo })
      ])
    ]);
    if (isKHT() || isGTHP()) {
      headRow.appendChild(el('button', {
        className: 'btn btn-ghost btn-sm', type: 'button',
        onClick: function () { openContractModal(contract); }
      }, ['แก้ไขสัญญา']));
    }
    head.appendChild(headRow);
    head.appendChild(el('p', { className: 'hint', text: contract.description || '—' }));
    head.appendChild(el('div', { className: 'contract-meta-row' }, [
      el('span', { className: 'hint', text: 'วันที่ลงนามในสัญญา' }),
      elDateBE(contract.signedAt)
    ]));
    head.appendChild(el('p', { className: 'meta', text: 'อัปเดตล่าสุด: ' + fmtDate(contract.updatedAt) }));
    wrap.appendChild(head);

    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [
      el('h3', { text: 'โครงการในสัญญานี้' }),
      el('span', { className: 'hint', text: countProjectsForContract_(contract.id) + ' โครงการ' })
    ]));
    panel.appendChild(renderToolbar({ searchPlaceholder: 'ค้นหาโครงการ / ผู้รับผิดชอบ' }));
    panel.appendChild(renderProjectList(filteredProjects(contract.id), true));
    wrap.appendChild(panel);
    return wrap;
  }

  function renderProject() {
    if (!state.project) return el('div', { className: 'loading-box', text: 'กำลังโหลดโครงการ…' });
    var p = state.project.project;
    var wrap = el('div');

    var head = el('div', { className: 'panel' });
    head.appendChild(el('div', { className: 'panel-h' }, [
      el('div', null, [
        el('h3', { text: p.name }),
        el('div', { className: 'hint', text: p.projectCode + ' · สัญญา ' + ((state.project.contract && state.project.contract.contractNo) || '—') })
      ]),
      chip(p.status)
    ]));
    var siteCount = (state.project.sites && state.project.sites.length) || 0;
    head.appendChild(el('div', { className: 'project-summary-grid' }, [
      el('div', { className: 'summary-item' }, [
        el('div', { className: 'label', text: 'เลขที่สัญญา' }),
        el('div', { className: 'value', text: (state.project.contract && state.project.contract.contractNo) || '—' })
      ]),
      el('div', { className: 'summary-item' }, [
        el('div', { className: 'label', text: 'ชื่อโครงการ' }),
        el('div', { className: 'value', text: p.name })
      ]),
      el('div', { className: 'summary-item' }, [
        el('div', { className: 'label', text: 'จำนวนสถานที่' }),
        el('div', { className: 'value', text: siteCount + ' แห่ง' })
      ]),
      el('div', { className: 'summary-item' }, [
        el('div', { className: 'label', text: 'วันที่ลงนามในสัญญา' }),
        el('div', { className: 'value' }, [elDateBE(state.project.contract && state.project.contract.signedAt)])
      ])
    ]));
    head.appendChild(el('div', { className: 'meta', html:
      'ส่งครั้งแรก: <strong>' + escapeHtml(fmtDate(p.firstSubmittedAt)) + '</strong> · ' +
      'ครบ/ยอมรับ: <strong>' + escapeHtml(fmtDate(p.completedAt)) + '</strong> · ' +
      'ตรวจล่าสุด: <strong>' + escapeHtml(fmtDate(p.reviewedAt)) + '</strong>'
    }));
    head.appendChild(el('p', { className: 'hint', style: 'margin-top:8px', text: p.description || '' }));

    var actions = el('div', { className: 'toolbar', style: 'margin-top:12px' });
    if (isKHT() && (p.status === 'Draft' || p.status === 'NeedsRevision')) {
      actions.appendChild(el('button', {
        className: 'btn btn-ghost btn-sm', type: 'button',
        onClick: function () { openProjectModal(p); }
      }, ['แก้ไขโครงการ']));
      actions.appendChild(el('button', {
        className: 'btn btn-ghost btn-sm', type: 'button',
        onClick: openAddSiteModal
      }, ['+ พื้นที่']));
      actions.appendChild(el('button', {
        className: 'btn btn-primary btn-sm', type: 'button',
        disabled: state.project.canSubmit ? null : 'disabled',
        onClick: submitProject
      }, ['ส่งตรวจ']));
      if (!state.project.canSubmit) {
        actions.appendChild(el('span', { className: 'hint', text: 'ส่งได้เมื่อรายการบังคับครบทุกพื้นที่' }));
      }
    }
    if (isGTHP() && p.status === 'Submitted') {
      actions.appendChild(el('button', { className: 'btn btn-gold btn-sm', type: 'button', onClick: openRevisionModal }, ['ขอแก้ไข']));
      actions.appendChild(el('button', { className: 'btn btn-primary btn-sm', type: 'button', onClick: acceptProject }, ['ยอมรับ']));
    }
    head.appendChild(actions);
    wrap.appendChild(head);

    // Sites
    var sitesPanel = el('div', { className: 'panel' });
    sitesPanel.appendChild(el('div', { className: 'panel-h' }, [
      el('h3', { text: 'พื้นที่ติดตั้ง (' + state.project.sites.length + ')' })
    ]));
    var list = el('div', { className: 'site-list' });
    state.project.sites.forEach(function (sv, idx) {
      list.appendChild(renderSiteBlock(sv, idx === 0));
    });
    sitesPanel.appendChild(list);
    wrap.appendChild(sitesPanel);

    // Comments
    wrap.appendChild(renderCommentsPanel());
    return wrap;
  }

  function renderSiteBlock(sv, open) {
    var block = el('div', { className: 'site-block' + (open ? ' open' : '') });
    var head = el('div', {
      className: 'site-head',
      onClick: function () { block.classList.toggle('open'); }
    }, [
      el('div', null, [
        el('strong', { text: sv.site.siteCode + ' — ' + sv.site.name }),
        el('div', { className: 'hint', text: (sv.site.location || '') + ' · บังคับ ' + sv.progress.completedRequired + '/' + sv.progress.required })
      ]),
      chip(sv.site.status)
    ]);
    block.appendChild(head);
    var body = el('div', { className: 'site-body' });
    if (isKHT() && (state.project.project.status === 'Draft' || state.project.project.status === 'NeedsRevision')) {
      body.appendChild(el('button', {
        className: 'btn btn-ghost btn-sm', type: 'button', style: 'margin:8px 0',
        onClick: function () { openCustomDocModal(sv.site.id); }
      }, ['+ เอกสารกำหนดเอง']));
    }
    sv.items.forEach(function (iv) {
      body.appendChild(renderCheckItem(iv, sv.site));
    });
    block.appendChild(body);
    return block;
  }

  function formatBytes(n) {
    var b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function renderCheckItem(iv, site) {
    var row = el('div', { className: 'check-item' });
    var currentFiles = (iv.currentFiles && iv.currentFiles.length)
      ? iv.currentFiles
      : (iv.currentFile ? [iv.currentFile] : []);
    var canEditFiles = isKHT() && (state.project.project.status === 'Draft' || state.project.project.status === 'NeedsRevision');
    var left = el('div', null, [
      el('div', { className: 'title', text: iv.title + (iv.item.required ? ' *' : '') }),
      el('div', { className: 'cat', text: iv.category }),
      chip(iv.item.status)
    ]);
    if (currentFiles.length) {
      var cur = el('ul', { className: 'current-file-list' });
      currentFiles.forEach(function (f) {
        var actions = el('span', { className: 'file-inline-actions' }, [
          el('button', {
            className: 'btn btn-ghost btn-sm', type: 'button',
            onClick: function () { openFile(f.id); }
          }, ['เปิด'])
        ]);
        if (canEditFiles) {
          actions.appendChild(el('button', {
            className: 'btn btn-danger btn-sm', type: 'button',
            onClick: function () { openDeleteFileModal(f, iv); }
          }, ['ลบ']));
        }
        cur.appendChild(el('li', null, [
          document.createTextNode(f.fileName + ' · v' + f.version + ' · ' + formatBytes(f.sizeBytes) + ' '),
          actions
        ]));
        if (f.storagePath) {
          cur.appendChild(el('li', { className: 'hint storage-path-hint', text: 'OneDrive: ' + f.storagePath }));
        }
      });
      left.appendChild(cur);
    }
    if (iv.versions && iv.versions.length) {
      var ul = el('ul', { className: 'version-list' });
      iv.versions.forEach(function (f) {
        if (currentFiles.some(function (c) { return c.id === f.id; })) return;
        var extra = f.deletedAt
          ? (' · ลบแล้ว: ' + (f.deleteReason || '—') + ' · ' + fmtDate(f.deletedAt))
          : (f.reason ? (' · ' + f.reason) : '');
        ul.appendChild(el('li', null, [
          document.createTextNode('v' + f.version + ' · ' + f.fileName + ' · ' + fmtDate(f.uploadedAt) + extra + ' '),
          el('button', {
            className: 'btn btn-ghost btn-sm', type: 'button',
            onClick: function () { openFile(f.id); }
          }, ['เปิด'])
        ]));
      });
      if (ul.childNodes.length) left.appendChild(ul);
    }
    row.appendChild(left);

    var right = el('div', { style: 'display:grid;gap:6px' });
    if (canEditFiles) {
      right.appendChild(el('button', {
        className: 'btn btn-primary btn-sm', type: 'button',
        onClick: function () { openUploadModal(iv, site); }
      }, [currentFiles.length ? 'เพิ่มไฟล์' : 'อัปโหลด']));
    }
    row.appendChild(right);
    return row;
  }

  function renderCommentsPanel() {
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [el('h3', { text: 'ความเห็น / ประวัติการสื่อสาร' })]));
    var list = el('div', { className: 'comment-list' });
    var comments = state.project.comments || [];
    if (!comments.length) list.appendChild(el('div', { className: 'empty', text: 'ยังไม่มีความเห็น' }));
    comments.forEach(function (c) {
      list.appendChild(el('div', { className: 'comment' }, [
        el('div', { className: 'who', text: ((c.author && c.author.name) || '—') + ' · ' + fmtDate(c.comment.createdAt) }),
        el('div', { text: c.comment.body })
      ]));
    });
    panel.appendChild(list);

    var form = el('form', {
      style: 'margin-top:12px',
      onSubmit: async function (ev) {
        ev.preventDefault();
        var body = $('#commentBody').value.trim();
        if (!body) return;
        try {
          await withLoad(function () {
            return api('apiAddComment', getToken(), { projectId: state.project.project.id, body: body });
          });
          toast('บันทึกความเห็นแล้ว', 'ok');
          loadRouteData();
        } catch (e) { toast(e.message, 'err'); }
      }
    });
    form.appendChild(el('div', { className: 'field' }, [
      el('label', { text: 'เพิ่มความเห็น' }),
      el('textarea', { id: 'commentBody', required: 'required', placeholder: 'พิมพ์ข้อความ…' })
    ]));
    form.appendChild(el('button', { className: 'btn btn-primary btn-sm', type: 'submit' }, ['ส่งความเห็น']));
    panel.appendChild(form);
    return panel;
  }

  function renderReview() {
    if (!state.reviewQueue) return el('div', { className: 'loading-box', text: 'กำลังโหลดคิว…' });
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [el('h3', { text: 'รอตรวจ / ขอแก้ไข' })]));
    var queue = state.reviewQueue.queue || [];
    if (!queue.length) panel.appendChild(el('div', { className: 'empty', text: 'ไม่มีรายการในคิว' }));
    else panel.appendChild(renderProjectList(queue));
    return panel;
  }

  function renderNotifications() {
    if (!state.notifications) return el('div', { className: 'loading-box', text: 'กำลังโหลด…' });
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [
      el('h3', { text: state.unreadNotifications > 0
        ? ('การแจ้งเตือน · ยังไม่อ่าน ' + state.unreadNotifications)
        : 'การแจ้งเตือน' }),
      el('button', {
        className: 'btn btn-ghost btn-sm', type: 'button',
        onClick: async function () {
          try {
            await api('apiMarkAllNotificationsRead', getToken());
            loadRouteData();
          } catch (e) { toast(e.message, 'err'); }
        }
      }, ['อ่านทั้งหมด'])
    ]));
    var list = state.notifications.notifications || [];
    if (!list.length) {
      panel.appendChild(el('div', { className: 'empty', text: 'ไม่มีการแจ้งเตือน' }));
      return panel;
    }
    var tw = el('div', { className: 'table-wrap' });
    var table = el('table', { className: 'data' });
    table.appendChild(el('thead', null, [el('tr', null, ['เวลา', 'หัวข้อ', 'รายละเอียด', ''].map(function (h) { return el('th', { text: h }); }))]));
    var tb = el('tbody');
    list.forEach(function (n) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: fmtDate(n.createdAt) }));
      tr.appendChild(el('td', { html: (n.read ? '' : '<span class="badge">ใหม่</span> ') + escapeHtml(n.title) }));
      tr.appendChild(el('td', { text: n.message }));
      var actions = el('td');
      if (n.linkRef && String(n.linkRef).indexOf('project:') === 0) {
        var pid = String(n.linkRef).slice(8);
        actions.appendChild(el('button', {
          className: 'btn btn-ghost btn-sm', type: 'button',
          onClick: async function () {
            if (!n.read) await api('apiMarkNotificationRead', getToken(), n.id);
            navigate('project', { id: pid });
          }
        }, ['เปิด']));
      }
      tr.appendChild(actions);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    tw.appendChild(table);
    panel.appendChild(tw);
    return panel;
  }

  function userAuditActionLabel(action) {
    var map = {
      CREATE_USER: 'สร้างรหัสเข้าใช้งาน',
      UPDATE_USER: 'แก้ไขข้อมูล',
      DEACTIVATE_USER: 'ปิดใช้งาน',
      UPDATE_EMAIL_PREFS: 'ตั้งค่าอีเมล',
      LOGIN: 'เข้าสู่ระบบ'
    };
    return map[action] || action;
  }

  function parseAuditDetails(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return { note: String(raw) }; }
  }

  function formatUserAuditSummary(row) {
    var d = parseAuditDetails(row.log.details);
    if (!d) return '—';
    if (row.log.action === 'UPDATE_USER' && d.before) {
      return 'รหัส ' + d.before.employeeId + ' → ' + d.employeeId + ' · ชื่อ ' +
        d.before.firstName + ' ' + d.before.lastName + ' → ' + d.firstName + ' ' + d.lastName;
    }
    if (d.employeeId) {
      return 'รหัส ' + d.employeeId + ' · ' + trimJoin([d.firstName, d.lastName]);
    }
    return String(row.log.details || '').slice(0, 100);
  }

  function trimJoin(parts) {
    return (parts || []).filter(function (p) { return p; }).join(' ');
  }

  function splitUserNameFields(user) {
    if (!user) return { first: '', last: '' };
    if (user.firstName || user.lastName) {
      return { first: user.firstName || '', last: user.lastName || '' };
    }
    var parts = String(user.name || '').trim().split(/\s+/);
    return { first: parts[0] || '', last: parts.length > 1 ? parts.slice(1).join(' ') : '' };
  }

  function renderUserAuditTrail(container, logs) {
    container.innerHTML = '';
    if (!logs || !logs.length) {
      container.appendChild(el('p', { className: 'hint', text: 'ยังไม่มีประวัติการแก้ไข' }));
      return;
    }
    var list = el('ul', { className: 'user-audit-list' });
    logs.forEach(function (row) {
      list.appendChild(el('li', { className: 'user-audit-item' }, [
        el('div', { className: 'user-audit-when', text: fmtDate(row.log.createdAt) }),
        el('div', { className: 'user-audit-what', text: userAuditActionLabel(row.log.action) }),
        el('div', { className: 'user-audit-who', text: 'โดย ' + ((row.actor && row.actor.name) || row.log.actorId || 'ระบบ') }),
        el('div', { className: 'user-audit-detail hint', text: formatUserAuditSummary(row) })
      ]));
    });
    container.appendChild(list);
  }

  async function loadUserAuditInto(container, userId) {
    try {
      var data = await api('apiGetUserAuditLogs', getToken(), userId);
      renderUserAuditTrail(container, data.logs || []);
    } catch (e) {
      container.innerHTML = '';
      container.appendChild(el('p', { className: 'hint', text: 'โหลดประวัติไม่สำเร็จ' }));
    }
  }

  function renderUsers() {
    if (!state.users) return el('div', { className: 'loading-box', text: 'กำลังโหลด…' });
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [
      el('div', null, [
        el('h3', { text: 'รหัสเข้าใช้งาน' }),
        el('p', { className: 'hint', text: 'กธพ. สร้างรหัสจาก ชื่อ · นามสกุล · รหัสประจำตัว (ใช้ล็อกอิน) — ระบบบันทึกวันเวลาแก้ไขอัตโนมัติ' })
      ]),
      el('button', { className: 'btn btn-primary btn-sm', type: 'button', onClick: function () { openUserModal(); } }, ['+ สร้างรหัส'])
    ]));
    var tw = el('div', { className: 'table-wrap' });
    var table = el('table', { className: 'data' });
    table.appendChild(el('thead', null, [el('tr', null, [
      'รหัสประจำตัว', 'ชื่อ', 'นามสกุล', 'กอง', 'สร้างเมื่อ', 'แก้ไขล่าสุด', 'สถานะ', ''
    ].map(function (h) { return el('th', { text: h }); }))]));
    var tb = el('tbody');
    (state.users.users || []).forEach(function (u) {
      var names = splitUserNameFields(u);
      var actions = el('td');
      actions.appendChild(el('button', {
        className: 'btn btn-ghost btn-sm', type: 'button',
        onClick: function () { openUserModal(u); }
      }, ['แก้ไข / ประวัติ']));
      if (u.active) {
        actions.appendChild(el('button', {
          className: 'btn btn-danger btn-sm', type: 'button',
          onClick: async function () {
            if (!confirm('ปิดใช้งาน ' + (u.name || u.employeeId) + '?')) return;
            try {
              await api('apiDeactivateUser', getToken(), u.id);
              toast('ปิดใช้งานแล้ว', 'ok');
              loadRouteData();
            } catch (e) { toast(e.message, 'err'); }
          }
        }, ['ปิดใช้งาน']));
      }
      tb.appendChild(el('tr', null, [
        el('td', { text: u.employeeId }),
        el('td', { text: names.first || '—' }),
        el('td', { text: names.last || '—' }),
        el('td', { text: u.role === 'KHT' ? 'กขท.' : 'กธพ.' }),
        el('td', { text: u.createdAt ? fmtDate(u.createdAt) : '—' }),
        el('td', { text: u.updatedAt ? fmtDate(u.updatedAt) : '—' }),
        el('td', { text: u.active ? 'ใช้งาน' : 'ปิด' }),
        actions
      ]));
    });
    table.appendChild(tb);
    tw.appendChild(table);
    panel.appendChild(tw);
    return panel;
  }

  function renderAudit() {
    if (!state.audit) return el('div', { className: 'loading-box', text: 'กำลังโหลด…' });
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [el('h3', { text: 'บันทึกการกระทำ' })]));
    var tw = el('div', { className: 'table-wrap' });
    var table = el('table', { className: 'data' });
    table.appendChild(el('thead', null, [el('tr', null, ['เวลา', 'ผู้กระทำ', 'การกระทำ', 'เป้าหมาย', 'รายละเอียด'].map(function (h) { return el('th', { text: h }); }))]));
    var tb = el('tbody');
    (state.audit.logs || []).forEach(function (row) {
      tb.appendChild(el('tr', null, [
        el('td', { text: fmtDate(row.log.createdAt) }),
        el('td', { text: (row.actor && row.actor.name) || row.log.actorId }),
        el('td', { text: row.log.action }),
        el('td', { text: (row.log.entityType || '') + ' ' + (row.log.entityId || '') }),
        el('td', { text: String(row.log.details || '').slice(0, 120) })
      ]));
    });
    table.appendChild(tb);
    tw.appendChild(table);
    panel.appendChild(tw);
    return panel;
  }

  function renderSettings() {
    if (!state.settings) return el('div', { className: 'loading-box', text: 'กำลังโหลด…' });
    var s = state.settings.settings || {};
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [el('h3', { text: 'ตั้งค่าระบบ' })]));
    panel.appendChild(el('p', { className: 'hint', text: 'ที่เก็บข้อมูล: ' + (s.spreadsheetId || 'localStorage-mock') }));
    panel.appendChild(el('p', { className: 'hint', text: 'โหมดจัดเก็บ: ' + (s.onedriveMode || 'Mock') }));
    if (s.storageFolderUrl) {
      panel.appendChild(el('p', { className: 'hint' }, [
        document.createTextNode('โฟลเดอร์เก็บไฟล์: '),
        el('a', { href: s.storageFolderUrl, target: '_blank', rel: 'noopener noreferrer', text: 'เปิด SharePoint / OneDrive' })
      ]));
    }
    panel.appendChild(el('div', { className: 'auth-warn', text: s.authWarning || '' }));

    var modeRow = el('div', { className: 'toolbar' });
    modeRow.appendChild(el('button', {
      className: 'btn btn-ghost', type: 'button',
      onClick: async function () {
        try {
          await api('setStorageMode', 'Mock', getToken());
          toast('ตั้งเป็น Mock แล้ว', 'ok');
          loadRouteData();
        } catch (e) { toast(e.message, 'err'); }
      }
    }, ['ใช้ Mock Storage']));
    modeRow.appendChild(el('button', {
      className: 'btn btn-gold', type: 'button',
      onClick: async function () {
        try {
          await api('setStorageMode', 'Graph', getToken());
          toast('ตั้งเป็น Graph (ต้องมี Azure credentials)', 'ok');
          loadRouteData();
        } catch (e) { toast(e.message, 'err'); }
      }
    }, ['สลับไป Graph (stub)']));
    modeRow.appendChild(el('button', {
      className: 'btn btn-primary', type: 'button',
      onClick: async function () {
        try {
          await withLoad(function () { return api('apiRunSetup', getToken()); });
          toast('เติม/อัปเดต mock data สำเร็จ', 'ok');
          loadRouteData();
        } catch (e) { toast(e.message, 'err'); }
      }
    }, ['เติม Mock Data']));
    modeRow.appendChild(el('button', {
      className: 'btn btn-danger', type: 'button',
      onClick: async function () {
        if (!confirm('ลบข้อมูลทั้งหมดแล้ว seed ใหม่ทั้งหมด? การกระทำนี้ย้อนกลับไม่ได้')) return;
        try {
          await withLoad(function () { return api('apiResetAndSeed', getToken()); });
          toast('รีเซ็ตและ seed ใหม่แล้ว', 'ok');
          loadRouteData();
        } catch (e) { toast(e.message, 'err'); }
      }
    }, ['รีเซ็ตข้อมูลทั้งหมด']));
    panel.appendChild(modeRow);
    panel.appendChild(el('p', { className: 'hint', text: '“เติม Mock Data” ยืนยัน seed · “รีเซ็ต” ล้าง localStorage แล้วสร้างตัวอย่างใหม่ครบสถานะ' }));
    panel.appendChild(el('p', { className: 'hint', text: 'โครงสร้าง OneDrive: PEA-Solar-DocTrack / เลขที่สัญญา / รหัสโครงการ_ชื่อ / รหัสสถานที่_ชื่อ / เอกสาร / v{n} / ไฟล์' }));
    return panel;
  }

  var MAX_NOTIFY_EMAILS = 10;

  function getNotifyEmailsFromSession() {
    var prefs = (state.session && state.session.emailPreferences) || {};
    if (prefs.emails && prefs.emails.length) return prefs.emails.slice(0, MAX_NOTIFY_EMAILS);
    if (state.session && state.session.email) return [state.session.email];
    return [''];
  }

  function collectNotifyEmailsFromDom(listEl) {
    return readAllEmailInputsFromDom(listEl).filter(function (v) { return v; });
  }

  function readAllEmailInputsFromDom(listEl) {
    var inputs = listEl ? listEl.querySelectorAll('.notify-email-input') : [];
    var out = [];
    for (var i = 0; i < inputs.length; i++) {
      out.push(String(inputs[i].value || '').trim());
    }
    return out;
  }

  function renderEmailPrefs() {
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [el('h3', { text: 'การแจ้งเตือนทางอีเมล' })]));
    panel.appendChild(el('p', { className: 'hint', text: 'เพิ่มอีเมลรับแจ้งเตือนได้สูงสุด ' + MAX_NOTIFY_EMAILS + ' ที่ · เลือกเหตุการณ์ที่ต้องการ (mock — ยังไม่ส่งอีเมลจริง)' }));

    var emailList = el('div', { className: 'notify-email-list', id: 'notify_email_list' });
    panel.appendChild(el('div', { className: 'field' }, [
      el('label', { text: 'อีเมลรับการแจ้งเตือน *' }),
      emailList
    ]));

    function paintEmailRows(values) {
      emailList.innerHTML = '';
      values.forEach(function (val, idx) {
        var row = el('div', { className: 'notify-email-row' });
        row.appendChild(el('span', { className: 'notify-email-num', text: String(idx + 1) + '.' }));
        row.appendChild(el('input', {
          type: 'email',
          className: 'notify-email-input',
          placeholder: 'เช่น name' + (idx + 1) + '@pea.co.th',
          value: val || ''
        }));
        if (values.length > 1) {
          row.appendChild(el('button', {
            type: 'button',
            className: 'btn btn-ghost btn-sm',
            onClick: function () {
              var cur = readAllEmailInputsFromDom(emailList);
              cur.splice(idx, 1);
              if (!cur.length) cur = [''];
              paintEmailRows(cur);
            }
          }, ['ลบ']));
        }
        emailList.appendChild(row);
      });
    }

    var initial = getNotifyEmailsFromSession();
    if (!initial.length) initial = [''];
    paintEmailRows(initial);

    var addBtn = el('button', {
      type: 'button',
      className: 'btn btn-ghost btn-sm',
      style: 'margin:4px 0 12px',
      onClick: function () {
        var cur = readAllEmailInputsFromDom(emailList);
        if (!cur.length) cur = [''];
        if (cur.length >= MAX_NOTIFY_EMAILS) {
          toast('เพิ่มได้ไม่เกิน ' + MAX_NOTIFY_EMAILS + ' อีเมล', 'err');
          return;
        }
        cur.push('');
        paintEmailRows(cur);
      }
    }, ['+ เพิ่มอีเมล (' + MAX_NOTIFY_EMAILS + ' สูงสุด)']);
    panel.appendChild(addBtn);

    var keys = [
      ['submit', 'เมื่อมีการส่งตรวจ'],
      ['revision', 'เมื่อขอแก้ไข'],
      ['accept', 'เมื่อยอมรับ'],
      ['comment', 'เมื่อมีความเห็นใหม่']
    ];
    var current = Object.assign(
      { submit: true, revision: true, accept: true, comment: true },
      (state.session && state.session.emailPreferences) || {}
    );
    keys.forEach(function (k) {
      var id = 'pref_' + k[0];
      panel.appendChild(el('label', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0' }, [
        el('input', { type: 'checkbox', id: id, checked: current[k[0]] ? 'checked' : null }),
        document.createTextNode(k[1])
      ]));
    });
    panel.appendChild(el('button', {
      className: 'btn btn-primary', type: 'button', style: 'margin-top:12px',
      onClick: async function () {
        var emails = collectNotifyEmailsFromDom(emailList);
        if (!emails.length) {
          toast('กรุณาระบุอีเมลอย่างน้อย 1 ที่', 'err');
          return;
        }
        if (emails.length > MAX_NOTIFY_EMAILS) {
          toast('เพิ่มได้ไม่เกิน ' + MAX_NOTIFY_EMAILS + ' อีเมล', 'err');
          return;
        }
        var payload = { emails: emails };
        keys.forEach(function (k) { payload[k[0]] = !!$('#pref_' + k[0]).checked; });
        try {
          var result = await api('apiUpdateEmailPreferences', getToken(), payload);
          if (result.user) {
            state.session.email = result.user.email || emails[0];
            state.session.emailPreferences = result.user.emailPreferences || payload;
          }
          toast('บันทึก ' + emails.length + ' อีเมลและการแจ้งเตือนแล้ว', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      }
    }, ['บันทึก']));
    return panel;
  }

  // ---- Modals & actions ----
  function openModal(title, bodyFn, onSubmit) {
    state.modal = { title: title, bodyFn: bodyFn, onSubmit: onSubmit };
    render();
  }
  function closeModal() { state.modal = null; render(); }

  function renderModal() {
    var m = state.modal;
    var back = el('div', { className: 'modal-back', onClick: function (ev) { if (ev.target === back) closeModal(); } });
    var box = el('div', { className: 'modal' });
    box.appendChild(el('h3', { text: m.title }));
    var body = el('div', { id: 'modalBody' });
    m.bodyFn(body);
    box.appendChild(body);
    var actions = el('div', { className: 'modal-actions' });
    actions.appendChild(el('button', { className: 'btn btn-ghost', type: 'button', onClick: closeModal }, ['ยกเลิก']));
    if (m.onSubmit) {
      actions.appendChild(el('button', {
        className: 'btn btn-primary', type: 'button',
        onClick: function () { m.onSubmit(); }
      }, ['บันทึก']));
    }
    box.appendChild(actions);
    back.appendChild(box);
    return back;
  }

  function openContractModal(existing) {
    openModal(existing ? 'แก้ไขสัญญา' : 'สร้างสัญญา', function (body) {
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'เลขที่สัญญา *' }),
        el('input', { id: 'm_contractNo', value: existing ? existing.contractNo : '', required: 'required' })
      ]));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'ชื่อสัญญา *' }),
        el('input', { id: 'm_title', value: existing ? existing.title : '' })
      ]));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'วันที่ลงนามในสัญญา' }),
        el('input', {
          type: 'date',
          id: 'm_signedAt',
          value: existing ? toDateInputValue(existing.signedAt) : ''
        }),
        el('span', { className: 'hint', text: 'แสดงผลเป็น วัน เดือน ปี พ.ศ. ในรายการโครงการ' })
      ]));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'รายละเอียด' }),
        el('textarea', { id: 'm_desc', text: existing ? (existing.description || '') : '' })
      ]));
    }, async function () {
      try {
        await withLoad(function () {
          return api('apiSaveContract', getToken(), {
            id: existing && existing.id,
            contractNo: $('#m_contractNo').value,
            title: $('#m_title').value,
            description: $('#m_desc').value,
            signedAt: $('#m_signedAt').value
          });
        });
        toast('บันทึกสัญญาแล้ว', 'ok');
        closeModal();
        loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  function openProjectModal(existing) {
    var contracts = (state.dashboard && state.dashboard.contracts) || (state.project && state.project.contract ? [state.project.contract] : []);
    var defaultContractId = (existing && existing.contractId) ||
      (state.route === 'contract' && state.routeParams.id) ||
      (state.project && state.project.project && state.project.project.contractId) ||
      '';
    openModal(existing ? 'แก้ไขโครงการ' : 'เพิ่มโครงการ', function (body) {
      var sel = el('select', { id: 'm_contractId' });
      contracts.forEach(function (c) {
        var o = el('option', { value: c.id, text: c.contractNo + ' — ' + c.title });
        if (defaultContractId && String(c.id) === String(defaultContractId)) o.selected = true;
        sel.appendChild(o);
      });
      var signedPreview = el('p', { className: 'hint', id: 'm_signedPreview' });
      function refreshSignedPreview() {
        var c = contracts.filter(function (x) { return String(x.id) === String(sel.value); })[0];
        if (!c || !c.signedAt) {
          signedPreview.textContent = 'วันที่ลงนามในสัญญา: ยังไม่ระบุ (ตั้งค่าได้เมื่อสร้าง/แก้ไขสัญญา)';
          return;
        }
        signedPreview.innerHTML = '';
        signedPreview.appendChild(document.createTextNode('วันที่ลงนามในสัญญา: '));
        signedPreview.appendChild(elDateBE(c.signedAt));
      }
      sel.addEventListener('change', refreshSignedPreview);

      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'เลขที่สัญญา *' }),
        sel
      ]));
      body.appendChild(signedPreview);
      refreshSignedPreview();

      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'ชื่อโครงการ *' }),
        el('input', { id: 'm_name', value: existing ? existing.name : '' })
      ]));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'รหัสโครงการ (ภายในระบบ) *' }),
        el('input', { id: 'm_code', value: existing ? existing.projectCode : '' })
      ]));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'รายละเอียดเพิ่มเติม' }),
        el('textarea', { id: 'm_pdesc', text: existing ? (existing.description || '') : '' })
      ]));
      if (!existing) {
        body.appendChild(el('div', { className: 'field' }, [
          el('label', { text: 'จำนวนสถานที่ — กรอกรายการพื้นที่ (หนึ่งบรรทัดต่อหนึ่งสถานที่)' }),
          el('textarea', {
            id: 'm_sites',
            placeholder: 'WTR-01|การประปาสาขาบางเขน|กรุงเทพฯ\nWTR-02|การประปาสาขาพระนคร|กรุงเทพฯ'
          }),
          el('span', { className: 'hint', text: 'จำนวนสถานที่ = จำนวนบรรทัดที่กรอก' })
        ]));
      } else if (state.project && state.project.sites) {
        body.appendChild(el('p', { className: 'hint', text: 'จำนวนสถานที่ปัจจุบัน: ' + state.project.sites.length + ' แห่ง' }));
      }
    }, async function () {
      try {
        var payload = {
          id: existing && existing.id,
          contractId: $('#m_contractId').value,
          projectCode: $('#m_code').value,
          name: $('#m_name').value,
          description: $('#m_pdesc').value
        };
        if (!existing) {
          var raw = ($('#m_sites') && $('#m_sites').value) || '';
          payload.sites = raw.split('\n').map(function (line) {
            var p = line.split('|');
            if (!p[0] && !p[1]) return null;
            return { siteCode: (p[0] || '').trim(), name: (p[1] || p[0] || '').trim(), location: (p[2] || '').trim() };
          }).filter(Boolean);
        }
        var res = await withLoad(function () { return api('apiSaveProject', getToken(), payload); });
        toast('บันทึกโครงการแล้ว', 'ok');
        closeModal();
        if (!existing && res.project) navigate('project', { id: res.project.id });
        else loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  function openAddSiteModal() {
    openModal('เพิ่มพื้นที่', function (body) {
      body.appendChild(el('div', { className: 'field-row' }, [
        el('div', { className: 'field' }, [el('label', { text: 'รหัสพื้นที่ *' }), el('input', { id: 'm_scode' })]),
        el('div', { className: 'field' }, [el('label', { text: 'ชื่อพื้นที่ *' }), el('input', { id: 'm_sname' })])
      ]));
      body.appendChild(el('div', { className: 'field' }, [el('label', { text: 'ที่ตั้ง' }), el('input', { id: 'm_sloc' })]));
    }, async function () {
      try {
        await withLoad(function () {
          return api('apiSaveSite', getToken(), {
            projectId: state.project.project.id,
            siteCode: $('#m_scode').value,
            name: $('#m_sname').value,
            location: $('#m_sloc').value
          });
        });
        toast('เพิ่มพื้นที่แล้ว', 'ok');
        closeModal();
        loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  function openCustomDocModal(siteId) {
    openModal('เพิ่มเอกสารกำหนดเอง', function (body) {
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'ชื่อหัวข้อเอกสาร *' }),
        el('input', { id: 'm_ctitle' })
      ]));
      body.appendChild(el('label', { style: 'display:flex;gap:8px;align-items:center' }, [
        el('input', { type: 'checkbox', id: 'm_creq' }),
        document.createTextNode('บังคับ')
      ]));
    }, async function () {
      try {
        await withLoad(function () {
          return api('apiAddCustomChecklistItem', getToken(), {
            siteId: siteId,
            title: $('#m_ctitle').value,
            required: $('#m_creq').checked
          });
        });
        toast('เพิ่มรายการแล้ว', 'ok');
        closeModal();
        loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  function openDeleteFileModal(file, iv) {
    openModal('ลบไฟล์', function (body) {
      body.appendChild(el('p', { className: 'hint', text: (iv.title || 'เอกสาร') + ' · ' + file.fileName }));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'เหตุผลในการลบ *' }),
        el('textarea', { id: 'm_del_reason', required: 'required', placeholder: 'ระบุเหตุผลที่ลบไฟล์นี้' })
      ]));
      body.appendChild(el('p', { className: 'auth-warn', text: 'การลบจะบันทึกใน Audit — การเพิ่มไฟล์ใหม่ไม่ต้องระบุเหตุผล' }));
    }, async function () {
      var reason = ($('#m_del_reason') && $('#m_del_reason').value || '').trim();
      if (!reason) {
        toast('ต้องระบุเหตุผลเมื่อลบไฟล์', 'err');
        return;
      }
      if (!confirm('ยืนยันลบไฟล์ ' + file.fileName + '?')) return;
      try {
        await withLoad(function () {
          return api('apiDeleteFile', getToken(), { fileId: file.id, reason: reason });
        });
        toast('ลบไฟล์แล้ว', 'ok');
        closeModal();
        loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  function openUploadModal(iv, site) {
    var contract = state.project && state.project.contract;
    var project = state.project && state.project.project;
    var pathHint = contract && project
      ? 'PEA-Solar-DocTrack / ' + contract.contractNo + ' / ' + project.projectCode + '_… / ' + site.siteCode + '_… / … / v{n} / ไฟล์'
      : '';
    openModal('เพิ่มไฟล์', function (body) {
      body.appendChild(el('p', { className: 'hint', text: iv.title + ' · ' + site.name }));
      if (pathHint) {
        body.appendChild(el('p', { className: 'hint storage-path-hint', text: 'โครงสร้างโฟลเดอร์ OneDrive: ' + pathHint }));
      }
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'เลือกไฟล์ (ได้หลายไฟล์พร้อมกัน — ไม่ต้องระบุเหตุผล)' }),
        el('input', { type: 'file', id: 'm_file', multiple: 'multiple' })
      ]));
      body.appendChild(el('ul', { id: 'm_filePreview', className: 'upload-file-preview' }));
      body.appendChild(el('p', { className: 'auth-warn', text:
        'ไม่จำกัดขนาดไฟล์ — ไม่ส่งไบนารีผ่าน mock; หากต้องการเอาไฟล์ออกให้กด «ลบ» และระบุเหตุผล' }));
    }, async function () {
      var input = $('#m_file');
      var files = input.files ? Array.prototype.slice.call(input.files) : [];
      if (!files.length) { toast('กรุณาเลือกไฟล์', 'err'); return; }
      try {
        var res = await withLoad(function () {
          return api('apiUploadFiles', getToken(), {
            checklistItemId: iv.item.id,
            files: files.map(function (file) {
              return {
                fileName: file.name,
                mimeType: file.type || 'application/octet-stream',
                sizeBytes: file.size
              };
            })
          });
        });
        var n = (res.files && res.files.length) || files.length;
        toast('เพิ่ม ' + n + ' ไฟล์แล้ว' + (res.storagePathExample ? ' · ' + res.storagePathExample : ''), 'ok');
        closeModal();
        loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
    setTimeout(function () {
      var input = $('#m_file');
      var preview = $('#m_filePreview');
      if (!input || !preview) return;
      input.addEventListener('change', function () {
        preview.innerHTML = '';
        var list = input.files ? Array.prototype.slice.call(input.files) : [];
        if (!list.length) return;
        list.forEach(function (file) {
          preview.appendChild(el('li', { text: file.name + ' · ' + formatBytes(file.size) }));
        });
      });
    }, 0);
  }

  function openRevisionModal() {
    openModal('ขอแก้ไขเอกสาร', function (body) {
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'รายละเอียดที่ต้องแก้ไข *' }),
        el('textarea', { id: 'm_rev' })
      ]));
    }, async function () {
      try {
        await withLoad(function () {
          return api('apiRequestRevision', getToken(), {
            projectId: state.project.project.id,
            message: $('#m_rev').value
          });
        });
        toast('ส่งคำขอแก้ไขแล้ว', 'ok');
        closeModal();
        loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  function openUserModal(existing) {
    var nameParts = splitUserNameFields(existing);
    openModal(existing ? 'แก้ไขรหัสเข้าใช้งาน' : 'สร้างรหัสเข้าใช้งาน', function (body) {
      body.appendChild(el('p', { className: 'hint', text: 'รหัสประจำตัวใช้สำหรับล็อกอิน — ทุกครั้งที่บันทึก ระบบเก็บวันเวลาและผู้แก้ไขใน Audit' }));
      body.appendChild(el('div', { className: 'field-row' }, [
        el('div', { className: 'field' }, [
          el('label', { text: 'ชื่อ *' }),
          el('input', { id: 'm_firstName', value: nameParts.first, autocomplete: 'given-name' })
        ]),
        el('div', { className: 'field' }, [
          el('label', { text: 'นามสกุล *' }),
          el('input', { id: 'm_lastName', value: nameParts.last, autocomplete: 'family-name' })
        ])
      ]));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'รหัสประจำตัว (ใช้ล็อกอิน) *' }),
        el('input', {
          id: 'm_emp',
          value: existing ? existing.employeeId : '',
          autocomplete: 'off',
          placeholder: 'เช่น 1234567 หรือ KHT004'
        })
      ]));
      var sel = el('select', { id: 'm_role' });
      [['KHT', 'กขท.'], ['GTHP', 'กธพ.']].forEach(function (r) {
        var o = el('option', { value: r[0], text: r[1] });
        if (existing && existing.role === r[0]) o.selected = true;
        if (!existing && r[0] === 'KHT') o.selected = true;
        sel.appendChild(o);
      });
      body.appendChild(el('div', { className: 'field' }, [el('label', { text: 'กอง *' }), sel]));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'อีเมล (ไม่บังคับ)' }),
        el('input', { id: 'm_email', type: 'email', value: existing ? (existing.email || '') : '' })
      ]));
      if (existing) {
        body.appendChild(el('div', { className: 'user-audit-section' }, [
          el('h4', { text: 'ประวัติการแก้ไข' }),
          el('div', { id: 'm_userAudit', className: 'user-audit-trail' }, [
            el('p', { className: 'hint', text: 'กำลังโหลดประวัติ…' })
          ])
        ]));
      }
    }, async function () {
      try {
        await withLoad(function () {
          return api('apiSaveUser', getToken(), {
            id: existing && existing.id,
            employeeId: $('#m_emp').value.trim(),
            firstName: $('#m_firstName').value.trim(),
            lastName: $('#m_lastName').value.trim(),
            role: $('#m_role').value,
            email: $('#m_email').value.trim(),
            active: existing ? existing.active !== false : true
          });
        });
        toast('บันทึกรหัสเข้าใช้งานแล้ว', 'ok');
        closeModal();
        loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
    if (existing) {
      var auditEl = $('#m_userAudit');
      if (auditEl) loadUserAuditInto(auditEl, existing.id);
    }
  }

  async function submitProject() {
    if (!confirm('ยืนยันส่งตรวจโครงการนี้?')) return;
    try {
      await withLoad(function () { return api('apiSubmitProject', getToken(), state.project.project.id); });
      toast('ส่งตรวจแล้ว', 'ok');
      loadRouteData();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function acceptProject() {
    if (!confirm('ยืนยันยอมรับเอกสารโครงการนี้?')) return;
    try {
      await withLoad(function () {
        return api('apiAcceptProject', getToken(), { projectId: state.project.project.id, message: 'ยอมรับครบถ้วน' });
      });
      toast('ยอมรับแล้ว', 'ok');
      loadRouteData();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function openFile(fileId) {
    try {
      var data = await api('apiOpenFile', getToken(), fileId);
      var open = data.open || {};
      var msg = 'ผู้ให้บริการ: ' + (open.provider || '') + '\n' +
        (open.path ? ('พาธ: ' + open.path + '\n') : '') +
        (open.message ? (open.message + '\n') : '') +
        (open.url || '');
      alert(msg);
      if (open.url) {
        window.open(open.url, '_blank', 'noopener,noreferrer');
      }
    } catch (e) { toast(e.message, 'err'); }
  }

  // Start
  boot();
})();

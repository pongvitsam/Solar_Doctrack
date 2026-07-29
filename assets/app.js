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
    viewMode: 'cards',
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
    modal: null
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

  // ---- Boot ----
  async function boot() {
    try {
      var data = await api('apiGetBootstrap', getToken());
      state.boot = data;
      state.session = data.session;
      if (state.session && state.session.token) setToken(state.session.token);
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
    card.appendChild(el('div', { className: 'auth-warn', text: (state.boot && state.boot.authWarning) || '' }));

    var demos = el('div', { className: 'demo-accounts' });
    ((state.boot && state.boot.demoAccounts) || []).forEach(function (a) {
      demos.appendChild(el('button', {
        className: 'demo-chip', type: 'button',
        onClick: function () { $('#empId').value = a.employeeId; }
      }, [a.employeeId + ' · ' + a.role]));
    });
    card.appendChild(el('div', { className: 'hint', text: 'บัญชีตัวอย่าง (คลิกเพื่อใส่รหัส):' }));
    card.appendChild(demos);

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
      items.push({ id: 'users', label: 'จัดการผู้ใช้' });
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
      }, [n.label]));
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
      users: 'จัดการผู้ใช้',
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
      el('h2', { text: titles[state.route] || 'PEA Solar DocTrack' })
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
      var table = el('table', { className: 'data' });
      var headers = hideContract
        ? ['รหัส', 'ชื่อ', 'สถานะ', 'ความคืบหน้า', 'อัปเดต']
        : ['รหัส', 'ชื่อ', 'สัญญา', 'สถานะ', 'ความคืบหน้า', 'อัปเดต'];
      table.appendChild(el('thead', null, [
        el('tr', null, headers.map(function (h) {
          return el('th', { text: h });
        }))
      ]));
      var tb = el('tbody');
      list.forEach(function (p) {
        var cells = [
          el('td', { text: p.project.projectCode }),
          el('td', { text: p.project.name })
        ];
        if (!hideContract) cells.push(el('td', { text: (p.contract && p.contract.contractNo) || '—' }));
        cells.push(
          el('td', null, [chip(p.project.status)]),
          el('td', { text: p.requiredDone + '/' + p.requiredTotal + ' (' + p.percent + '%)' }),
          el('td', { text: fmtDate(p.project.updatedAt) })
        );
        var tr = el('tr', {
          className: 'clickable',
          onClick: function () { navigate('project', { id: p.project.id }); }
        }, cells);
        tb.appendChild(tr);
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
        el('div', { className: 'meta', html:
          escapeHtml(p.project.projectCode) + ' · ' + escapeHtml((p.contract && p.contract.contractNo) || '—') +
          '<br>พื้นที่ ' + p.siteCount + ' · เจ้าของ ' + escapeHtml((p.owner && p.owner.name) || '—')
        }),
        el('div', { className: 'progress' }, [el('span', { style: 'width:' + p.percent + '%' })]),
        el('div', { className: 'meta', text: 'บังคับครบ ' + p.requiredDone + '/' + p.requiredTotal })
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
      table.appendChild(el('thead', null, [el('tr', null, ['เลขที่', 'ชื่อ', 'โครงการ', 'อัปเดต', ''].map(function (h) { return el('th', { text: h }); }))]));
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
          el('td', { text: String(countProjectsForContract_(c.id)) }),
          el('td', { text: fmtDate(c.updatedAt) }),
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

  function renderCheckItem(iv, site) {
    var row = el('div', { className: 'check-item' });
    var left = el('div', null, [
      el('div', { className: 'title', text: iv.title + (iv.item.required ? ' *' : '') }),
      el('div', { className: 'cat', text: iv.category }),
      chip(iv.item.status)
    ]);
    if (iv.versions && iv.versions.length) {
      var ul = el('ul', { className: 'version-list' });
      iv.versions.forEach(function (f) {
        ul.appendChild(el('li', null, [
          document.createTextNode('v' + f.version + ' · ' + f.fileName + ' · ' + fmtDate(f.uploadedAt) +
            (f.reason ? ' · เหตุผล: ' + f.reason : '') + ' '),
          el('button', {
            className: 'btn btn-ghost btn-sm', type: 'button',
            onClick: function () { openFile(f.id); }
          }, ['เปิด'])
        ]));
      });
      left.appendChild(ul);
    }
    row.appendChild(left);

    var right = el('div', { style: 'display:grid;gap:6px' });
    if (isKHT() && (state.project.project.status === 'Draft' || state.project.project.status === 'NeedsRevision')) {
      right.appendChild(el('button', {
        className: 'btn btn-primary btn-sm', type: 'button',
        onClick: function () { openUploadModal(iv, site); }
      }, [iv.currentFile ? 'เปลี่ยนไฟล์' : 'อัปโหลด']));
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
      el('h3', { text: 'การแจ้งเตือน' }),
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

  function renderUsers() {
    if (!state.users) return el('div', { className: 'loading-box', text: 'กำลังโหลด…' });
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [
      el('h3', { text: 'ผู้ใช้งาน' }),
      el('button', { className: 'btn btn-primary btn-sm', type: 'button', onClick: function () { openUserModal(); } }, ['+ ผู้ใช้'])
    ]));
    var tw = el('div', { className: 'table-wrap' });
    var table = el('table', { className: 'data' });
    table.appendChild(el('thead', null, [el('tr', null, ['รหัส', 'ชื่อ', 'บทบาท', 'อีเมล', 'สถานะ', ''].map(function (h) { return el('th', { text: h }); }))]));
    var tb = el('tbody');
    (state.users.users || []).forEach(function (u) {
      var actions = el('td');
      actions.appendChild(el('button', {
        className: 'btn btn-ghost btn-sm', type: 'button',
        onClick: function () { openUserModal(u); }
      }, ['แก้ไข']));
      if (u.active) {
        actions.appendChild(el('button', {
          className: 'btn btn-danger btn-sm', type: 'button',
          onClick: async function () {
            if (!confirm('ปิดใช้งานผู้ใช้ ' + u.name + '?')) return;
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
        el('td', { text: u.name }),
        el('td', { text: u.role === 'KHT' ? 'กขท.' : 'กธพ.' }),
        el('td', { text: u.email || '—' }),
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
    panel.appendChild(el('p', { className: 'hint', text: 'โหมด Graph เป็น stub ใน static demo — อัปโหลดยังเป็น metadata ใน localStorage' }));
    return panel;
  }

  function renderEmailPrefs() {
    var panel = el('div', { className: 'panel' });
    panel.appendChild(el('div', { className: 'panel-h' }, [el('h3', { text: 'การแจ้งเตือนทางอีเมล (mock preference)' })]));
    panel.appendChild(el('p', { className: 'hint', text: 'ค่านี้เก็บใน Users.emailPreferences — ระบบ mock ไม่ส่งอีเมลจริง' }));

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
      var row = el('label', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0' }, [
        el('input', { type: 'checkbox', id: id, checked: current[k[0]] ? 'checked' : null }),
        document.createTextNode(k[1])
      ]);
      panel.appendChild(row);
    });
    panel.appendChild(el('button', {
      className: 'btn btn-primary', type: 'button', style: 'margin-top:12px',
      onClick: async function () {
        var prefs = {};
        keys.forEach(function (k) { prefs[k[0]] = !!$('#pref_' + k[0]).checked; });
        try {
          var result = await api('apiUpdateEmailPreferences', getToken(), prefs);
          state.session.emailPreferences = (result.user && result.user.emailPreferences) || prefs;
          toast('บันทึกการตั้งค่าแล้ว', 'ok');
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
            description: $('#m_desc').value
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
    openModal(existing ? 'แก้ไขโครงการ' : 'สร้างโครงการ', function (body) {
      var sel = el('select', { id: 'm_contractId' });
      contracts.forEach(function (c) {
        var o = el('option', { value: c.id, text: c.contractNo + ' — ' + c.title });
        if (defaultContractId && String(c.id) === String(defaultContractId)) o.selected = true;
        sel.appendChild(o);
      });
      body.appendChild(el('div', { className: 'field' }, [el('label', { text: 'สัญญา *' }), sel]));
      body.appendChild(el('div', { className: 'field-row' }, [
        el('div', { className: 'field' }, [
          el('label', { text: 'รหัสโครงการ *' }),
          el('input', { id: 'm_code', value: existing ? existing.projectCode : '' })
        ]),
        el('div', { className: 'field' }, [
          el('label', { text: 'ชื่อโครงการ *' }),
          el('input', { id: 'm_name', value: existing ? existing.name : '' })
        ])
      ]));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'รายละเอียด' }),
        el('textarea', { id: 'm_pdesc', text: existing ? (existing.description || '') : '' })
      ]));
      if (!existing) {
        body.appendChild(el('div', { className: 'field' }, [
          el('label', { text: 'พื้นที่เริ่มต้น (หนึ่งบรรทัด: รหัส|ชื่อ|ที่ตั้ง)' }),
          el('textarea', { id: 'm_sites', placeholder: 'S1|พื้นที่ A|กรุงเทพฯ\nS2|พื้นที่ B|เชียงใหม่' })
        ]));
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

  function openUploadModal(iv, site) {
    var replacing = !!iv.currentFile;
    openModal(replacing ? 'เปลี่ยนไฟล์' : 'อัปโหลดไฟล์', function (body) {
      body.appendChild(el('p', { className: 'hint', text: iv.title + ' · ' + site.name }));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: 'เลือกไฟล์ (จำลอง metadata — ไม่ส่งไบนารีจริงผ่าน GAS)' }),
        el('input', { type: 'file', id: 'm_file' })
      ]));
      body.appendChild(el('div', { className: 'field' }, [
        el('label', { text: replacing ? 'เหตุผลที่เปลี่ยนไฟล์ *' : 'หมายเหตุ (ถ้ามี)' }),
        el('textarea', { id: 'm_reason', required: replacing ? 'required' : null })
      ]));
      body.appendChild(el('p', { className: 'auth-warn', text: 'Mock OneDrive: เก็บ metadata + ลิงก์จำลอง; อนาคตใช้ Microsoft Graph resumable upload' }));
    }, async function () {
      var input = $('#m_file');
      var file = input.files && input.files[0];
      if (!file) { toast('กรุณาเลือกไฟล์', 'err'); return; }
      var reason = $('#m_reason').value.trim();
      if (replacing && !reason) { toast('ต้องระบุเหตุผลเมื่อเปลี่ยนไฟล์', 'err'); return; }
      try {
        await withLoad(function () {
          return api('apiUploadFile', getToken(), {
            checklistItemId: iv.item.id,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            reason: reason
          });
        });
        toast('อัปโหลด (mock) สำเร็จ', 'ok');
        closeModal();
        loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
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
    openModal(existing ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้', function (body) {
      body.appendChild(el('div', { className: 'field-row' }, [
        el('div', { className: 'field' }, [el('label', { text: 'รหัสพนักงาน *' }), el('input', { id: 'm_emp', value: existing ? existing.employeeId : '' })]),
        el('div', { className: 'field' }, [el('label', { text: 'ชื่อ *' }), el('input', { id: 'm_uname', value: existing ? existing.name : '' })])
      ]));
      var sel = el('select', { id: 'm_role' });
      [['KHT', 'กขท.'], ['GTHP', 'กธพ.']].forEach(function (r) {
        var o = el('option', { value: r[0], text: r[1] });
        if (existing && existing.role === r[0]) o.selected = true;
        sel.appendChild(o);
      });
      body.appendChild(el('div', { className: 'field' }, [el('label', { text: 'บทบาท' }), sel]));
      body.appendChild(el('div', { className: 'field' }, [el('label', { text: 'อีเมล' }), el('input', { id: 'm_email', value: existing ? (existing.email || '') : '' })]));
    }, async function () {
      try {
        await withLoad(function () {
          return api('apiSaveUser', getToken(), {
            id: existing && existing.id,
            employeeId: $('#m_emp').value,
            name: $('#m_uname').value,
            role: $('#m_role').value,
            email: $('#m_email').value,
            active: existing ? existing.active !== false : true
          });
        });
        toast('บันทึกผู้ใช้แล้ว', 'ok');
        closeModal();
        loadRouteData();
      } catch (e) { toast(e.message, 'err'); }
    });
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

/**
 * PEA Solar DocTrack — browser localStorage mock API (GitHub Pages compatible).
 * Mirrors the GAS Code.gs surface used by the SPA client.
 */
(function (global) {
  'use strict';

  var DB_KEY = 'pea_doctrack_mock_db';
  var SESSIONS_KEY = 'pea_doctrack_mock_sessions';
  var FOLDER_URL = 'https://pea365-my.sharepoint.com/:f:/g/personal/pojsawat_suk_pea_co_th/IgAqKwm-hbKbQLLOryXzeVvTAfWd3AzgEeKmd7-4n7w93Ww?e=ezedia';

  var ROLES = { KHT: 'KHT', GTHP: 'GTHP' };
  var PROJECT_STATUS = {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    NEEDS_REVISION: 'NeedsRevision',
    COMPLETED: 'Completed'
  };
  var ITEM_STATUS = { EMPTY: 'Empty', UPLOADED: 'Uploaded', ACCEPTED: 'Accepted' };
  var STORAGE = { MOCK: 'Mock', GRAPH: 'Graph' };

  var DEMO_ACCOUNTS = [
    { employeeId: 'KHT001', role: 'KHT', name: 'สมชาย กขท.' },
    { employeeId: 'GTHP001', role: 'GTHP', name: 'อรุณี กธพ.' }
  ];

  var AUTH_WARNING = 'เข้าสู่ระบบด้วยรหัสพนักงานเท่านั้น — เหมาะกับ mockup/เครือข่ายภายใน ไม่ใช่ authentication ระดับ production';

  function nowIso() { return new Date().toISOString(); }

  function ago(days, hours) {
    var ms = ((Number(days) || 0) * 24 + (Number(hours) || 0)) * 60 * 60 * 1000;
    return new Date(Date.now() - ms).toISOString();
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function ok(data) { return { ok: true, data: data == null ? null : data }; }
  function fail(message) { return { ok: false, error: message || 'เกิดข้อผิดพลาด', code: 'ERROR' }; }

  function normalizeSignedAt(value) {
    if (value === undefined || value === null || String(value).trim() === '') return '';
    var s = String(value).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    var d = new Date(s);
    if (isNaN(d.getTime())) throw new Error('รูปแบบวันที่ลงนามไม่ถูกต้อง');
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function requireFields(obj, fields) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!obj || obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '') {
        throw new Error('จำเป็นต้องระบุ: ' + f);
      }
    }
  }

  function loadSessions() {
    try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function saveSessions(s) {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(s));
  }

  function loadDb() {
    var raw = localStorage.getItem(DB_KEY);
    if (!raw) {
      var seed = buildSeed();
      saveDb(seed);
      return seed;
    }
    try { return JSON.parse(raw); }
    catch (e) {
      var rebuilt = buildSeed();
      saveDb(rebuilt);
      return rebuilt;
    }
  }

  function saveDb(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function list(db, name) { return db[name] || []; }

  function findById(db, name, id) {
    return list(db, name).filter(function (r) { return r.id === id; })[0] || null;
  }

  function findWhere(db, name, fn) {
    return list(db, name).filter(fn);
  }

  function findOneWhere(db, name, fn) {
    return findWhere(db, name, fn)[0] || null;
  }

  function append(db, name, row) {
    if (!db[name]) db[name] = [];
    db[name].push(row);
    return row;
  }

  function updateById(db, name, id, patch) {
    var rows = list(db, name);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) {
        Object.keys(patch).forEach(function (k) {
          if (patch[k] !== undefined) rows[i][k] = patch[k];
        });
        return rows[i];
      }
    }
    throw new Error('ไม่พบรายการ: ' + name + '/' + id);
  }

  function getSetting(db, key, fallback) {
    var row = findOneWhere(db, 'Settings', function (s) { return s.key === key; });
    return row ? row.value : fallback;
  }

  function upsertSetting(db, key, value) {
    var row = findOneWhere(db, 'Settings', function (s) { return s.key === key; });
    if (row) row.value = value;
    else append(db, 'Settings', { id: 'set_' + key, key: key, value: value });
  }

  function writeAudit(db, actorId, action, entityType, entityId, details) {
    append(db, 'AuditLogs', {
      id: uid('aud'),
      actorId: actorId || 'system',
      action: action,
      entityType: entityType || '',
      entityId: entityId || '',
      details: typeof details === 'string' ? details : JSON.stringify(details || {}),
      createdAt: nowIso()
    });
  }

  function writeNotification(db, userId, type, title, message, linkRef) {
    append(db, 'Notifications', {
      id: uid('ntf'),
      userId: userId,
      type: type,
      title: title,
      message: message || '',
      linkRef: linkRef || '',
      read: false,
      createdAt: nowIso()
    });
  }

  function notifyRole(db, role, type, title, message, linkRef) {
    findWhere(db, 'Users', function (u) { return u.role === role && u.active !== false; })
      .forEach(function (u) { writeNotification(db, u.id, type, title, message, linkRef); });
  }

  function buildUserFullName(firstName, lastName) {
    return [String(firstName || '').trim(), String(lastName || '').trim()]
      .filter(function (p) { return p; })
      .join(' ');
  }

  function ensureUserNameParts(u) {
    if (!u) return null;
    var out = Object.assign({}, u);
    if (out.firstName || out.lastName) {
      if (!out.name) out.name = buildUserFullName(out.firstName, out.lastName);
      return out;
    }
    if (out.name) {
      var parts = String(out.name).trim().split(/\s+/);
      out.firstName = parts[0] || '';
      out.lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    } else {
      out.firstName = '';
      out.lastName = '';
    }
    return out;
  }

  var MAX_NOTIFICATION_EMAILS = 10;

  function isValidEmail(address) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(address || '').trim());
  }

  function normalizeNotificationEmails(input, fallbackSingle) {
    var list = [];
    if (Array.isArray(input)) list = input;
    else if (input) list = [input];
    else if (fallbackSingle) list = [fallbackSingle];
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var raw = String(list[i] || '').trim();
      if (!raw) continue;
      var key = raw.toLowerCase();
      if (seen[key]) continue;
      if (!isValidEmail(raw)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง: ' + raw);
      seen[key] = true;
      out.push(raw);
    }
    if (out.length > MAX_NOTIFICATION_EMAILS) {
      throw new Error('รับแจ้งเตือนได้ไม่เกิน ' + MAX_NOTIFICATION_EMAILS + ' อีเมล');
    }
    return out;
  }

  function normalizeEmailPreferences(prefs, fallbackEmail) {
    prefs = prefs || {};
    var normalized = {
      submit: prefs.submit !== false,
      revision: prefs.revision !== false,
      accept: prefs.accept !== false,
      comment: prefs.comment !== false,
      emails: []
    };
    if (prefs.emails && prefs.emails.length) {
      normalized.emails = normalizeNotificationEmails(prefs.emails);
    } else if (fallbackEmail) {
      normalized.emails = normalizeNotificationEmails([fallbackEmail]);
    }
    return normalized;
  }

  function sanitizeUser(u) {
    if (!u) return null;
    var n = ensureUserNameParts(u);
    var emailPrefs = normalizeEmailPreferences(n.emailPreferences, n.email);
    return {
      id: n.id,
      employeeId: n.employeeId,
      firstName: n.firstName || '',
      lastName: n.lastName || '',
      name: n.name || buildUserFullName(n.firstName, n.lastName),
      role: n.role,
      email: emailPrefs.emails.length ? emailPrefs.emails[0] : (n.email || ''),
      emailPreferences: emailPrefs,
      active: n.active !== false,
      createdAt: n.createdAt || '',
      updatedAt: n.updatedAt || ''
    };
  }

  function getUserByEmployeeId(db, employeeId) {
    return findOneWhere(db, 'Users', function (u) {
      return u.employeeId === String(employeeId).trim() && u.active !== false;
    });
  }

  function getUserById(db, id) { return findById(db, 'Users', id); }

  function createSession(user) {
    var sessions = loadSessions();
    var token = uid('tok');
    var emailPrefs = normalizeEmailPreferences(user.emailPreferences, user.email);
    var payload = {
      token: token,
      userId: user.id,
      employeeId: user.employeeId,
      name: user.name,
      role: user.role,
      email: emailPrefs.emails.length ? emailPrefs.emails[0] : (user.email || ''),
      emailPreferences: emailPrefs,
      createdAt: nowIso()
    };
    sessions[token] = payload;
    saveSessions(sessions);
    return payload;
  }

  function getSession(token) {
    if (!token) return null;
    var sessions = loadSessions();
    return sessions[token] || null;
  }

  function destroySession(token) {
    if (!token) return;
    var sessions = loadSessions();
    delete sessions[token];
    saveSessions(sessions);
  }

  function requireSession(token) {
    var session = getSession(token);
    if (!session) throw new Error('กรุณาเข้าสู่ระบบ');
    return session;
  }

  function requireRole(session, allowed) {
    if (allowed.indexOf(session.role) === -1) {
      throw new Error('ไม่มีสิทธิ์ดำเนินการนี้ (ต้องเป็น ' + allowed.join('/') + ')');
    }
    return session;
  }

  function getStorageMode(db) {
    return getSetting(db, 'onedriveMode', STORAGE.MOCK) === STORAGE.GRAPH ? STORAGE.GRAPH : STORAGE.MOCK;
  }

  function getFolderUrl(db) {
    return getSetting(db, 'storageFolderUrl', FOLDER_URL) || FOLDER_URL;
  }

  function templatesSpec() {
    return [
      { category: 'โครงสร้างหลังคา', title: 'แบบโครงสร้างหลังคา', description: 'แบบก่อสร้างโครงสร้างรองรับแผง', required: true, sortOrder: 1 },
      { category: 'โครงสร้างหลังคา', title: 'Civil Load Analysis', description: 'รายงานวิเคราะห์น้ำหนักบรรทุก', required: true, sortOrder: 2 },
      { category: 'ระบบไฟฟ้า', title: 'Load Profile', description: 'โปรไฟล์โหลดไฟฟ้า', required: true, sortOrder: 3 },
      { category: 'ระบบไฟฟ้า', title: 'Single Line Diagram (SLD)', description: 'แผนภาพสายไฟฟ้า', required: true, sortOrder: 4 },
      { category: 'ระบบไฟฟ้า', title: 'MDB / Panel Schedule', description: 'รายละเอียดตู้ MDB', required: true, sortOrder: 5 },
      { category: 'ระบบไฟฟ้า', title: 'Zero Export Scheme', description: 'แบบควบคุม Zero Export', required: true, sortOrder: 6 },
      { category: 'พื้นที่และกรรมสิทธิ์', title: 'แผนที่/ผังพื้นที่ติดตั้ง', description: 'แสดงขอบเขตพื้นที่', required: true, sortOrder: 7 },
      { category: 'พื้นที่และกรรมสิทธิ์', title: 'เอกสารกรรมสิทธิ์/สิทธิใช้ประโยชน์', description: 'โฉนด/สัญญาเช่า/หนังสือยินยอม', required: true, sortOrder: 8 },
      { category: 'กฎหมายและใบอนุญาต', title: 'ใบอนุญาตก่อสร้าง/ดัดแปลง', description: 'เอกสารอนุญาตที่เกี่ยวข้อง', required: false, sortOrder: 9 },
      { category: 'กฎหมายและใบอนุญาต', title: 'ใบอนุญาตประกอบกิจการไฟฟ้า', description: 'ถ้ามีตามเงื่อนไขโครงการ', required: false, sortOrder: 10 }
    ].map(function (tpl, idx) {
      return {
        id: 'tpl_' + String(idx + 1).padStart(3, '0'),
        category: tpl.category,
        title: tpl.title,
        description: tpl.description,
        required: tpl.required,
        sortOrder: tpl.sortOrder,
        active: true
      };
    });
  }

  function seedChecklistForSite(db, siteId, templates, t) {
    templates.forEach(function (tpl) {
      append(db, 'ChecklistItems', {
        id: 'cli_' + siteId + '_' + tpl.id,
        siteId: siteId,
        templateId: tpl.id,
        customTitle: '',
        required: tpl.required,
        status: ITEM_STATUS.EMPTY,
        currentFileId: '',
        createdAt: t,
        updatedAt: t
      });
    });
  }

  function seedFilesForSite(db, siteId, projectId, mode, uploaderId, folderUrl, withVersionHistory) {
    var templates = list(db, 'ChecklistTemplates');
    var items = findWhere(db, 'ChecklistItems', function (i) { return i.siteId === siteId; });
    items.sort(function (a, b) {
      var ta = templates.filter(function (t) { return t.id === a.templateId; })[0];
      var tb = templates.filter(function (t) { return t.id === b.templateId; })[0];
      return Number(ta && ta.sortOrder) - Number(tb && tb.sortOrder);
    });

    var targets = items.filter(function (item, idx) {
      if (mode === 'partial') return item.required === true && idx < 2;
      if (mode === 'complete' || mode === 'accepted') return item.required === true || idx === 8;
      return false;
    });

    targets.forEach(function (item, idx) {
      var status = mode === 'accepted' ? ITEM_STATUS.ACCEPTED : ITEM_STATUS.UPLOADED;
      var baseName = (item.templateId || 'custom') + '_' + siteId;
      var firstId = 'file_' + item.id + '_v1';
      var firstCurrent = !(withVersionHistory && idx === 0);
      append(db, 'Files', {
        id: firstId,
        checklistItemId: item.id,
        fileName: baseName + '.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 540000 + (idx * 37000),
        version: 1,
        reason: 'อัปโหลดครั้งแรก',
        storageProvider: STORAGE.MOCK,
        storagePath: ['PEA-Solar-DocTrack', projectId, siteId, item.id, 'v1', baseName + '.pdf'].join('/'),
        webUrl: folderUrl,
        uploadedBy: uploaderId,
        uploadedAt: ago(12 - Math.min(idx, 8), idx),
        isCurrent: firstCurrent
      });

      var currentId = firstId;
      var currentAt = ago(12 - Math.min(idx, 8), idx);
      if (withVersionHistory && idx === 0) {
        currentId = 'file_' + item.id + '_v2';
        currentAt = ago(2, 2);
        append(db, 'Files', {
          id: currentId,
          checklistItemId: item.id,
          fileName: baseName + '_rev02.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 680000,
          version: 2,
          reason: 'แก้ไขรายละเอียดและลงนามรับรองตามความเห็น กธพ.',
          storageProvider: STORAGE.MOCK,
          storagePath: ['PEA-Solar-DocTrack', projectId, siteId, item.id, 'v2', baseName + '_rev02.pdf'].join('/'),
          webUrl: folderUrl,
          uploadedBy: uploaderId,
          uploadedAt: currentAt,
          isCurrent: true
        });
      }
      updateById(db, 'ChecklistItems', item.id, {
        status: status,
        currentFileId: currentId,
        updatedAt: currentAt
      });
    });
  }

  function seedCustomDoc(db, site, projectId, title, required, uploaderId, folderUrl) {
    var item = append(db, 'ChecklistItems', {
      id: 'cli_custom_' + site.id,
      siteId: site.id,
      templateId: '',
      customTitle: title,
      required: required,
      status: ITEM_STATUS.UPLOADED,
      currentFileId: 'file_custom_' + site.id,
      createdAt: ago(14),
      updatedAt: ago(4)
    });
    append(db, 'Files', {
      id: item.currentFileId,
      checklistItemId: item.id,
      fileName: title.replace(/\s+/g, '_') + '.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1250000,
      version: 1,
      reason: 'เอกสารเพิ่มเติมของโครงการ',
      storageProvider: STORAGE.MOCK,
      storagePath: ['PEA-Solar-DocTrack', projectId, site.id, item.id, 'v1', 'custom.pdf'].join('/'),
      webUrl: folderUrl,
      uploadedBy: uploaderId,
      uploadedAt: ago(4),
      isCurrent: true
    });
  }

  function buildSeed() {
    var t = ago(90);
    var templates = templatesSpec();
    var db = {
      Users: [],
      Contracts: [],
      Projects: [],
      Sites: [],
      ChecklistTemplates: templates.slice(),
      ChecklistItems: [],
      Files: [],
      Comments: [],
      Notifications: [],
      AuditLogs: [],
      Settings: []
    };

    var users = [
      { id: 'usr_kht_001', employeeId: 'KHT001', name: 'สมชาย กขท.', role: ROLES.KHT, email: 'somchai.kht@pea.co.th', emailPreferences: { submit: true, revision: true, accept: true, comment: true }, active: true, createdAt: t, updatedAt: t },
      { id: 'usr_kht_002', employeeId: 'KHT002', name: 'วิภา กขท.', role: ROLES.KHT, email: 'wipa.kht@pea.co.th', emailPreferences: { submit: true, revision: true, accept: true, comment: true }, active: true, createdAt: t, updatedAt: t },
      { id: 'usr_kht_003', employeeId: 'KHT003', name: 'ธนกร กขท.', role: ROLES.KHT, email: 'thanakorn.kht@pea.co.th', emailPreferences: { submit: true, revision: false, accept: true, comment: true }, active: true, createdAt: ago(120), updatedAt: ago(8) },
      { id: 'usr_gthp_001', employeeId: 'GTHP001', name: 'อรุณี กธพ.', role: ROLES.GTHP, email: 'arunee.gthp@pea.co.th', emailPreferences: { submit: true, revision: true, accept: true, comment: true }, active: true, createdAt: t, updatedAt: t },
      { id: 'usr_gthp_002', employeeId: 'GTHP002', name: 'ประเสริฐ กธพ.', role: ROLES.GTHP, email: 'prasert.gthp@pea.co.th', emailPreferences: { submit: true, revision: true, accept: true, comment: true }, active: true, createdAt: t, updatedAt: t },
      { id: 'usr_inactive_001', employeeId: 'OLD001', name: 'ผู้ใช้ตัวอย่าง (ปิดใช้งาน)', role: ROLES.KHT, email: 'inactive@pea.co.th', emailPreferences: { submit: false, revision: false, accept: false, comment: false }, active: false, createdAt: ago(200), updatedAt: ago(30) }
    ];
    users.forEach(function (u) { append(db, 'Users', u); });

    append(db, 'Contracts', {
      id: 'ctr_001', contractNo: 'PEA-SOLAR-2026-001',
      title: 'สัญญาติดตั้งระบบผลิตไฟฟ้าพลังงานแสงอาทิตย์บนหลังคา',
      description: 'สัญญาแม่สำหรับโครงการโซลาร์รูฟท็อปหลายพื้นที่ รวมโครงการการประปา',
      signedAt: '2026-01-15',
      createdBy: 'usr_kht_001', createdAt: t, updatedAt: t
    });
    append(db, 'Contracts', {
      id: 'ctr_002', contractNo: 'PEA-SOLAR-2026-002',
      title: 'สัญญาโซลาร์คลังสินค้าและศูนย์กระจายพัสดุ',
      description: 'ข้อมูลตัวอย่างสำหรับคิวตรวจเอกสาร',
      signedAt: '2026-02-01',
      createdBy: 'usr_kht_002', createdAt: ago(70), updatedAt: ago(3)
    });
    append(db, 'Contracts', {
      id: 'ctr_003', contractNo: 'PEA-SOLAR-2025-014',
      title: 'สัญญาโซลาร์โรงพยาบาลชุมชน',
      description: 'โครงการตัวอย่างที่ กธพ. ยอมรับแล้ว',
      signedAt: '2025-08-12',
      createdBy: 'usr_kht_003', createdAt: ago(180), updatedAt: ago(15)
    });

    // Draft — waterworks 10 sites
    append(db, 'Projects', {
      id: 'prj_water_001', contractId: 'ctr_001', projectCode: 'WTR-2026-01',
      name: 'โครงการโซลาร์การประปา 10 พื้นที่',
      description: 'ติดตั้งระบบโซลาร์บนอาคารการประปา 10 แห่ง',
      status: PROJECT_STATUS.DRAFT, ownerId: 'usr_kht_001',
      firstSubmittedAt: '', completedAt: '', reviewedAt: '',
      createdAt: t, updatedAt: ago(1, 3)
    });
    var siteNames = [
      { code: 'WTR-01', name: 'การประปานครหลวง สาขาบางเขน', location: 'กรุงเทพฯ' },
      { code: 'WTR-02', name: 'การประปานครหลวง สาขาพระนคร', location: 'กรุงเทพฯ' },
      { code: 'WTR-03', name: 'การประปานครหลวง สาขาธนบุรี', location: 'กรุงเทพฯ' },
      { code: 'WTR-04', name: 'การประปาส่วนภูมิภาค สาขาเชียงใหม่', location: 'เชียงใหม่' },
      { code: 'WTR-05', name: 'การประปาส่วนภูมิภาค สาขาขอนแก่น', location: 'ขอนแก่น' },
      { code: 'WTR-06', name: 'การประปาส่วนภูมิภาค สาขานครราชสีมา', location: 'นครราชสีมา' },
      { code: 'WTR-07', name: 'การประปาส่วนภูมิภาค สาขาชลบุรี', location: 'ชลบุรี' },
      { code: 'WTR-08', name: 'การประปาส่วนภูมิภาค สาขาภูเก็ต', location: 'ภูเก็ต' },
      { code: 'WTR-09', name: 'การประปาส่วนภูมิภาค สาขาหาดใหญ่', location: 'สงขลา' },
      { code: 'WTR-10', name: 'การประปาส่วนภูมิภาค สาขาพิษณุโลก', location: 'พิษณุโลก' }
    ];
    siteNames.forEach(function (s, idx) {
      var site = {
        id: 'site_wtr_' + String(idx + 1).padStart(2, '0'),
        projectId: 'prj_water_001', siteCode: s.code, name: s.name, location: s.location,
        sortOrder: idx + 1, status: PROJECT_STATUS.DRAFT,
        createdAt: t, updatedAt: ago(idx + 1)
      };
      append(db, 'Sites', site);
      seedChecklistForSite(db, site.id, templates, t);
      if (idx < 3) seedFilesForSite(db, site.id, 'prj_water_001', 'partial', 'usr_kht_001', FOLDER_URL, idx === 0);
    });
    seedCustomDoc(db, findById(db, 'Sites', 'site_wtr_01'), 'prj_water_001', 'ผลสำรวจโดรนหลังคา', false, 'usr_kht_001', FOLDER_URL);

    // NeedsRevision — office 3 sites
    append(db, 'Projects', {
      id: 'prj_office_001', contractId: 'ctr_001', projectCode: 'OFF-2026-01',
      name: 'โครงการโซลาร์สำนักงานเขต PEA',
      description: 'ติดตั้งบนอาคารสำนักงานเขตตัวอย่าง 3 พื้นที่',
      status: PROJECT_STATUS.NEEDS_REVISION, ownerId: 'usr_kht_002',
      firstSubmittedAt: ago(8, 4), completedAt: '', reviewedAt: ago(2, 5),
      createdAt: t, updatedAt: ago(1, 5)
    });
    ['OFF-A', 'OFF-B', 'OFF-C'].forEach(function (code, idx) {
      var site = {
        id: 'site_off_' + String(idx + 1).padStart(2, '0'),
        projectId: 'prj_office_001', siteCode: code,
        name: 'สำนักงานเขตตัวอย่าง ' + code, location: 'กรุงเทพฯ',
        sortOrder: idx + 1, status: PROJECT_STATUS.NEEDS_REVISION,
        createdAt: t, updatedAt: ago(1, idx + 1)
      };
      append(db, 'Sites', site);
      seedChecklistForSite(db, site.id, templates, t);
      seedFilesForSite(db, site.id, 'prj_office_001', 'complete', 'usr_kht_002', FOLDER_URL, idx === 0);
    });
    seedCustomDoc(db, findById(db, 'Sites', 'site_off_01'), 'prj_office_001', 'หนังสือรับรองวิศวกร', true, 'usr_kht_002', FOLDER_URL);

    // Submitted — warehouse
    append(db, 'Projects', {
      id: 'prj_warehouse_001', contractId: 'ctr_002', projectCode: 'WH-2026-04',
      name: 'โครงการโซลาร์คลังพัสดุภาคกลาง',
      description: 'เอกสารบังคับครบ รอ กธพ. ตรวจ',
      status: PROJECT_STATUS.SUBMITTED, ownerId: 'usr_kht_002',
      firstSubmittedAt: ago(3, 6), completedAt: '', reviewedAt: '',
      createdAt: ago(50), updatedAt: ago(3, 6)
    });
    append(db, 'Sites', {
      id: 'site_wh_01', projectId: 'prj_warehouse_001', siteCode: 'WH-C01',
      name: 'คลังพัสดุภาคกลาง', location: 'พระนครศรีอยุธยา',
      sortOrder: 1, status: PROJECT_STATUS.SUBMITTED,
      createdAt: ago(50), updatedAt: ago(3, 6)
    });
    seedChecklistForSite(db, 'site_wh_01', templates, ago(50));
    seedFilesForSite(db, 'site_wh_01', 'prj_warehouse_001', 'complete', 'usr_kht_002', FOLDER_URL, true);

    // Completed — hospital
    append(db, 'Projects', {
      id: 'prj_hospital_001', contractId: 'ctr_003', projectCode: 'HSP-2025-14',
      name: 'โครงการโซลาร์โรงพยาบาลชุมชน',
      description: 'ตัวอย่างโครงการที่ตรวจและยอมรับเรียบร้อย',
      status: PROJECT_STATUS.COMPLETED, ownerId: 'usr_kht_003',
      firstSubmittedAt: ago(30), completedAt: ago(15, 2), reviewedAt: ago(15, 2),
      createdAt: ago(150), updatedAt: ago(15, 2)
    });
    append(db, 'Sites', {
      id: 'site_hsp_01', projectId: 'prj_hospital_001', siteCode: 'HSP-N01',
      name: 'โรงพยาบาลชุมชนเมืองเหนือ', location: 'เชียงราย',
      sortOrder: 1, status: PROJECT_STATUS.COMPLETED,
      createdAt: ago(150), updatedAt: ago(15, 2)
    });
    seedChecklistForSite(db, 'site_hsp_01', templates, ago(150));
    seedFilesForSite(db, 'site_hsp_01', 'prj_hospital_001', 'accepted', 'usr_kht_003', FOLDER_URL, false);

    [
      { id: 'cmt_mock_001', projectId: 'prj_office_001', siteId: 'site_off_01', authorId: 'usr_gthp_001', body: '[ขอแก้ไข] กรุณาปรับ SLD ให้แสดงพิกัด CT และจุดเชื่อมต่อให้ชัดเจน', createdAt: ago(2, 5) },
      { id: 'cmt_mock_002', projectId: 'prj_office_001', siteId: 'site_off_01', authorId: 'usr_kht_002', body: 'รับทราบ กำลังปรับปรุงเอกสารและจะอัปโหลดฉบับแก้ไข', createdAt: ago(1, 8) },
      { id: 'cmt_mock_003', projectId: 'prj_warehouse_001', siteId: 'site_wh_01', authorId: 'usr_gthp_002', body: 'ได้รับเอกสารแล้ว อยู่ระหว่างตรวจรายละเอียดโครงสร้าง', createdAt: ago(1, 2) },
      { id: 'cmt_mock_004', projectId: 'prj_hospital_001', siteId: '', authorId: 'usr_gthp_001', body: '[ยอมรับ] เอกสารครบถ้วนและผ่านการตรวจสอบ', createdAt: ago(15, 2) }
    ].forEach(function (r) { append(db, 'Comments', r); });

    [
      { id: 'ntf_mock_001', userId: 'usr_kht_002', type: 'REVISION', title: 'ขอแก้ไข: โครงการโซลาร์สำนักงานเขต PEA', message: 'ปรับ SLD ให้แสดงพิกัด CT และจุดเชื่อมต่อ', linkRef: 'project:prj_office_001', read: false, createdAt: ago(2, 5) },
      { id: 'ntf_mock_002', userId: 'usr_kht_003', type: 'ACCEPTED', title: 'ยอมรับแล้ว: โครงการโซลาร์โรงพยาบาลชุมชน', message: 'เอกสารครบถ้วนและผ่านการตรวจสอบ', linkRef: 'project:prj_hospital_001', read: true, createdAt: ago(15, 2) },
      { id: 'ntf_mock_003', userId: 'usr_gthp_001', type: 'PROJECT_SUBMITTED', title: 'ส่งตรวจ: โครงการโซลาร์คลังพัสดุภาคกลาง', message: 'เอกสารบังคับครบ รอตรวจสอบ', linkRef: 'project:prj_warehouse_001', read: false, createdAt: ago(3, 6) },
      { id: 'ntf_mock_004', userId: 'usr_gthp_002', type: 'PROJECT_SUBMITTED', title: 'ส่งตรวจ: โครงการโซลาร์คลังพัสดุภาคกลาง', message: 'เอกสารบังคับครบ รอตรวจสอบ', linkRef: 'project:prj_warehouse_001', read: true, createdAt: ago(3, 6) },
      { id: 'ntf_mock_005', userId: 'usr_kht_001', type: 'COMMENT', title: 'ตัวอย่างการแจ้งเตือนความเห็น', message: 'ตรวจสอบเอกสารพื้นที่บางเขนเพิ่มเติม', linkRef: 'project:prj_water_001', read: false, createdAt: ago(1) }
    ].forEach(function (r) { append(db, 'Notifications', r); });

    [
      { id: 'aud_mock_001', actorId: 'usr_kht_001', action: 'LOGIN', entityType: 'User', entityId: 'usr_kht_001', details: '{"mock":true}', createdAt: ago(1, 1) },
      { id: 'aud_mock_002', actorId: 'usr_kht_002', action: 'UPLOAD_FILE', entityType: 'File', entityId: 'mock-version-2', details: '{"version":2,"reason":"แก้ไขตามความเห็น กธพ."}', createdAt: ago(2, 2) },
      { id: 'aud_mock_003', actorId: 'usr_kht_002', action: 'SUBMIT_PROJECT', entityType: 'Project', entityId: 'prj_warehouse_001', details: '{"status":"Submitted"}', createdAt: ago(3, 6) },
      { id: 'aud_mock_004', actorId: 'usr_gthp_001', action: 'REQUEST_REVISION', entityType: 'Project', entityId: 'prj_office_001', details: '{"status":"NeedsRevision"}', createdAt: ago(2, 5) },
      { id: 'aud_mock_005', actorId: 'usr_gthp_001', action: 'ACCEPT_PROJECT', entityType: 'Project', entityId: 'prj_hospital_001', details: '{"status":"Completed"}', createdAt: ago(15, 2) },
      { id: 'aud_mock_006', actorId: 'usr_gthp_002', action: 'DEACTIVATE_USER', entityType: 'User', entityId: 'usr_inactive_001', details: '{"active":false}', createdAt: ago(30) },
      { id: 'aud_mock_007', actorId: 'usr_kht_001', action: 'ADD_CUSTOM_CHECKLIST', entityType: 'ChecklistItem', entityId: 'cli_custom_site_wtr_01', details: '{"title":"ผลสำรวจโดรนหลังคา"}', createdAt: ago(14) }
    ].forEach(function (r) { append(db, 'AuditLogs', r); });

    upsertSetting(db, 'storageFolderUrl', FOLDER_URL);
    upsertSetting(db, 'authWarning', AUTH_WARNING);
    upsertSetting(db, 'onedriveMode', STORAGE.MOCK);
    upsertSetting(db, 'spreadsheetId', 'localStorage-mock');
    upsertSetting(db, 'mockDataVersion', '3');
    upsertSetting(db, 'mockDataSummary', {
      accounts: ['KHT001', 'KHT002', 'KHT003', 'GTHP001', 'GTHP002'],
      statuses: ['Draft', 'Submitted', 'NeedsRevision', 'Completed'],
      features: ['partial-checklist', 'custom-document', 'file-versions', 'comments', 'notifications', 'audit', 'inactive-user']
    });

    writeAudit(db, 'system', 'SEED_DATA', 'Settings', 'seed', {
      users: users.length, contracts: 3, projects: 4, sites: 15, templates: templates.length
    });

    return db;
  }

  function computeSiteProgress(db, siteId) {
    var items = findWhere(db, 'ChecklistItems', function (i) { return i.siteId === siteId; });
    var required = items.filter(function (i) { return i.required === true; });
    var done = required.filter(function (i) {
      return i.status === ITEM_STATUS.UPLOADED || i.status === ITEM_STATUS.ACCEPTED;
    });
    return {
      total: items.length,
      required: required.length,
      completedRequired: done.length,
      complete: required.length > 0 && done.length === required.length
    };
  }

  function siteRequiredComplete(db, siteId) {
    var items = findWhere(db, 'ChecklistItems', function (i) { return i.siteId === siteId; });
    var required = items.filter(function (i) { return i.required === true; });
    if (!required.length) return false;
    return required.every(function (i) {
      return i.status === ITEM_STATUS.UPLOADED || i.status === ITEM_STATUS.ACCEPTED;
    });
  }

  function projectRequiredComplete(db, projectId) {
    var sites = findWhere(db, 'Sites', function (s) { return s.projectId === projectId; });
    if (!sites.length) return false;
    return sites.every(function (s) { return siteRequiredComplete(db, s.id); });
  }

  function assertProjectEditable(project) {
    if (project.status === PROJECT_STATUS.COMPLETED) throw new Error('โครงการที่ยอมรับแล้วไม่สามารถแก้ไขได้');
    if (project.status === PROJECT_STATUS.SUBMITTED) throw new Error('โครงการอยู่ระหว่างตรวจ — รอ กธพ. ขอแก้ไขก่อน');
  }

  function enrichProjects(db) {
    var projects = list(db, 'Projects');
    var contracts = list(db, 'Contracts');
    var sites = list(db, 'Sites');
    var users = list(db, 'Users');
    return projects.map(function (p) {
      var pSites = sites.filter(function (s) { return s.projectId === p.id; });
      var progress = pSites.map(function (s) { return computeSiteProgress(db, s.id); });
      var req = progress.reduce(function (a, b) { return a + b.required; }, 0);
      var done = progress.reduce(function (a, b) { return a + b.completedRequired; }, 0);
      var contract = contracts.filter(function (c) { return c.id === p.contractId; })[0];
      var owner = users.filter(function (u) { return u.id === p.ownerId; })[0];
      return {
        project: p,
        contract: contract || null,
        owner: owner ? sanitizeUser(owner) : null,
        siteCount: pSites.length,
        requiredTotal: req,
        requiredDone: done,
        percent: req ? Math.round((done / req) * 100) : 0
      };
    });
  }

  function wrap(fn) {
    return function () {
      var args = arguments;
      return Promise.resolve().then(function () {
        try {
          var result = fn.apply(null, args);
          if (result && result.ok === false) throw new Error(result.error || 'เกิดข้อผิดพลาด');
          return result && result.data !== undefined ? result.data : result;
        } catch (e) {
          throw e instanceof Error ? e : new Error(String(e));
        }
      });
    };
  }

  // ---- API methods (return ok_/fail_ then unwrap in wrap) ----

  function apiGetBootstrap(token) {
    var db = loadDb();
    var session = token ? getSession(token) : null;
    if (session) {
      var user = getUserById(db, session.userId);
      if (user) {
        var sanitized = sanitizeUser(user);
        session.email = sanitized.email;
        session.emailPreferences = sanitized.emailPreferences;
      }
    }
    return ok({
      session: session,
      authWarning: getSetting(db, 'authWarning', AUTH_WARNING),
      roles: ROLES,
      projectStatuses: PROJECT_STATUS,
      itemStatuses: ITEM_STATUS,
      storageMode: getStorageMode(db),
      templates: list(db, 'ChecklistTemplates').filter(function (t) { return t.active !== false; }),
      demoAccounts: DEMO_ACCOUNTS
    });
  }

  function apiLogin(employeeId) {
    requireFields({ employeeId: employeeId }, ['employeeId']);
    var db = loadDb();
    var user = getUserByEmployeeId(db, employeeId);
    if (!user) throw new Error('ไม่พบรหัสพนักงาน หรือบัญชีถูกปิดใช้งาน');
    var session = createSession(user);
    writeAudit(db, user.id, 'LOGIN', 'User', user.id, { employeeId: user.employeeId });
    saveDb(db);
    return ok({ session: session, user: sanitizeUser(user) });
  }

  function apiLogout(token) {
    var session = getSession(token);
    if (session) {
      var db = loadDb();
      writeAudit(db, session.userId, 'LOGOUT', 'User', session.userId, {});
      saveDb(db);
      destroySession(token);
    }
    return ok({ loggedOut: true });
  }

  function apiGetDashboard(token) {
    var session = requireSession(token);
    var db = loadDb();
    var enriched = enrichProjects(db);
    var unread = findWhere(db, 'Notifications', function (n) {
      return n.userId === session.userId && !n.read;
    }).length;
    var kpi = {
      totalProjects: enriched.length,
      draft: enriched.filter(function (e) { return e.project.status === PROJECT_STATUS.DRAFT; }).length,
      submitted: enriched.filter(function (e) { return e.project.status === PROJECT_STATUS.SUBMITTED; }).length,
      needsRevision: enriched.filter(function (e) { return e.project.status === PROJECT_STATUS.NEEDS_REVISION; }).length,
      completed: enriched.filter(function (e) { return e.project.status === PROJECT_STATUS.COMPLETED; }).length,
      unreadNotifications: unread
    };
    return ok({ kpi: kpi, projects: enriched, contracts: list(db, 'Contracts') });
  }

  function apiGetProject(token, projectId) {
    requireSession(token);
    requireFields({ projectId: projectId }, ['projectId']);
    var db = loadDb();
    var project = findById(db, 'Projects', projectId);
    if (!project) throw new Error('ไม่พบโครงการ');
    var contract = findById(db, 'Contracts', project.contractId);
    var owner = getUserById(db, project.ownerId);
    var sites = findWhere(db, 'Sites', function (s) { return s.projectId === projectId; })
      .sort(function (a, b) { return Number(a.sortOrder) - Number(b.sortOrder); });
    var templates = list(db, 'ChecklistTemplates');
    var siteViews = sites.map(function (site) {
      var items = findWhere(db, 'ChecklistItems', function (i) { return i.siteId === site.id; });
      var itemViews = items.map(function (item) {
        var tpl = templates.filter(function (t) { return t.id === item.templateId; })[0];
        var versions = findWhere(db, 'Files', function (f) { return f.checklistItemId === item.id; })
          .sort(function (a, b) { return (b.version || 0) - (a.version || 0); });
        return {
          item: item,
          template: tpl || null,
          title: item.customTitle || (tpl && tpl.title) || 'เอกสารกำหนดเอง',
          category: (tpl && tpl.category) || 'เอกสารอื่น',
          versions: versions,
          currentFiles: versions.filter(function (f) { return f.isCurrent; }),
          currentFile: versions.filter(function (f) { return f.isCurrent; })[0] || versions[0] || null,
          progress: null
        };
      });
      return { site: site, progress: computeSiteProgress(db, site.id), items: itemViews };
    });
    var comments = findWhere(db, 'Comments', function (c) { return c.projectId === projectId; })
      .map(function (c) { return { comment: c, author: sanitizeUser(getUserById(db, c.authorId)) }; })
      .sort(function (a, b) { return String(b.comment.createdAt).localeCompare(String(a.comment.createdAt)); });

    return ok({
      project: project,
      contract: contract,
      owner: sanitizeUser(owner),
      sites: siteViews,
      comments: comments,
      canSubmit: projectRequiredComplete(db, projectId) &&
        (project.status === PROJECT_STATUS.DRAFT || project.status === PROJECT_STATUS.NEEDS_REVISION)
    });
  }

  function apiSaveContract(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.KHT, ROLES.GTHP]);
    requireFields(payload || {}, ['contractNo', 'title']);
    var db = loadDb();
    var t = nowIso();
    if (payload.id) {
      if (!findById(db, 'Contracts', payload.id)) throw new Error('ไม่พบสัญญา');
      if (findOneWhere(db, 'Contracts', function (c) {
        return c.contractNo === payload.contractNo && c.id !== payload.id;
      })) throw new Error('เลขที่สัญญาซ้ำ');
      var updated = updateById(db, 'Contracts', payload.id, {
        contractNo: String(payload.contractNo).trim(),
        title: String(payload.title).trim(),
        description: payload.description || '',
        signedAt: normalizeSignedAt(payload.signedAt),
        updatedAt: t
      });
      writeAudit(db, session.userId, 'UPDATE_CONTRACT', 'Contract', payload.id, payload);
      saveDb(db);
      return ok({ contract: updated });
    }
    if (findOneWhere(db, 'Contracts', function (c) {
      return c.contractNo === String(payload.contractNo).trim();
    })) throw new Error('เลขที่สัญญาซ้ำ');
    var created = append(db, 'Contracts', {
      id: uid('ctr'),
      contractNo: String(payload.contractNo).trim(),
      title: String(payload.title).trim(),
      description: payload.description || '',
      signedAt: normalizeSignedAt(payload.signedAt),
      createdBy: session.userId,
      createdAt: t,
      updatedAt: t
    });
    writeAudit(db, session.userId, 'CREATE_CONTRACT', 'Contract', created.id, created);
    saveDb(db);
    return ok({ contract: created });
  }

  function apiSaveProject(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.KHT]);
    requireFields(payload || {}, ['contractId', 'projectCode', 'name']);
    var db = loadDb();
    if (!findById(db, 'Contracts', payload.contractId)) throw new Error('ไม่พบสัญญา');
    var t = nowIso();
    var code = String(payload.projectCode).trim();
    if (payload.id) {
      var existing = findById(db, 'Projects', payload.id);
      if (!existing) throw new Error('ไม่พบโครงการ');
      if (existing.status === PROJECT_STATUS.COMPLETED) throw new Error('โครงการที่ยอมรับแล้วแก้ไขไม่ได้');
      if (existing.status === PROJECT_STATUS.SUBMITTED) {
        throw new Error('โครงการที่ส่งตรวจแล้วแก้ไขหัวข้อไม่ได้ — รอ กธพ. ขอแก้ไขก่อน');
      }
      if (findOneWhere(db, 'Projects', function (p) { return p.projectCode === code && p.id !== payload.id; })) {
        throw new Error('รหัสโครงการซ้ำ');
      }
      var updated = updateById(db, 'Projects', payload.id, {
        contractId: payload.contractId,
        projectCode: code,
        name: String(payload.name).trim(),
        description: payload.description || '',
        updatedAt: t
      });
      writeAudit(db, session.userId, 'UPDATE_PROJECT', 'Project', payload.id, payload);
      saveDb(db);
      return ok({ project: updated });
    }
    if (findOneWhere(db, 'Projects', function (p) { return p.projectCode === code; })) {
      throw new Error('รหัสโครงการซ้ำ');
    }
    var created = append(db, 'Projects', {
      id: uid('prj'),
      contractId: payload.contractId,
      projectCode: code,
      name: String(payload.name).trim(),
      description: payload.description || '',
      status: PROJECT_STATUS.DRAFT,
      ownerId: session.userId,
      firstSubmittedAt: '',
      completedAt: '',
      reviewedAt: '',
      createdAt: t,
      updatedAt: t
    });
    var templates = list(db, 'ChecklistTemplates').filter(function (tpl) { return tpl.active !== false; });
    (payload.sites || []).forEach(function (s, idx) {
      if (!s.name && !s.siteCode) return;
      var site = append(db, 'Sites', {
        id: uid('site'),
        projectId: created.id,
        siteCode: String(s.siteCode || ('S' + (idx + 1))).trim(),
        name: String(s.name || s.siteCode).trim(),
        location: s.location || '',
        sortOrder: idx + 1,
        status: PROJECT_STATUS.DRAFT,
        createdAt: t,
        updatedAt: t
      });
      seedChecklistForSite(db, site.id, templates, t);
    });
    writeAudit(db, session.userId, 'CREATE_PROJECT', 'Project', created.id, created);
    notifyRole(db, ROLES.GTHP, 'PROJECT_CREATED', 'โครงการใหม่: ' + created.name, created.projectCode, 'project:' + created.id);
    saveDb(db);
    return ok({ project: created });
  }

  function apiSaveSite(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.KHT]);
    requireFields(payload || {}, ['projectId', 'siteCode', 'name']);
    var db = loadDb();
    var project = findById(db, 'Projects', payload.projectId);
    if (!project) throw new Error('ไม่พบโครงการ');
    assertProjectEditable(project);
    var t = nowIso();
    if (payload.id) {
      var updated = updateById(db, 'Sites', payload.id, {
        siteCode: String(payload.siteCode).trim(),
        name: String(payload.name).trim(),
        location: payload.location || '',
        sortOrder: payload.sortOrder != null ? Number(payload.sortOrder) : undefined,
        updatedAt: t
      });
      writeAudit(db, session.userId, 'UPDATE_SITE', 'Site', payload.id, payload);
      saveDb(db);
      return ok({ site: updated });
    }
    var existingSites = findWhere(db, 'Sites', function (s) { return s.projectId === payload.projectId; });
    var site = append(db, 'Sites', {
      id: uid('site'),
      projectId: payload.projectId,
      siteCode: String(payload.siteCode).trim(),
      name: String(payload.name).trim(),
      location: payload.location || '',
      sortOrder: existingSites.length + 1,
      status: PROJECT_STATUS.DRAFT,
      createdAt: t,
      updatedAt: t
    });
    var templates = list(db, 'ChecklistTemplates').filter(function (tpl) { return tpl.active !== false; });
    seedChecklistForSite(db, site.id, templates, t);
    writeAudit(db, session.userId, 'CREATE_SITE', 'Site', site.id, site);
    saveDb(db);
    return ok({ site: site });
  }

  function apiAddCustomChecklistItem(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.KHT]);
    requireFields(payload || {}, ['siteId', 'title']);
    var db = loadDb();
    var site = findById(db, 'Sites', payload.siteId);
    if (!site) throw new Error('ไม่พบพื้นที่');
    assertProjectEditable(findById(db, 'Projects', site.projectId));
    var t = nowIso();
    var item = append(db, 'ChecklistItems', {
      id: uid('cli'),
      siteId: payload.siteId,
      templateId: '',
      customTitle: String(payload.title).trim(),
      required: payload.required === true,
      status: ITEM_STATUS.EMPTY,
      currentFileId: '',
      createdAt: t,
      updatedAt: t
    });
    writeAudit(db, session.userId, 'ADD_CUSTOM_CHECKLIST', 'ChecklistItem', item.id, item);
    saveDb(db);
    return ok({ item: item });
  }

  function sanitizePathSegment(value, maxLen) {
    var s = String(value == null ? '' : value)
      .replace(/[\\/:*?"<>|#%]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) s = 'unknown';
    var cap = maxLen || 72;
    return s.length > cap ? s.slice(0, cap) : s;
  }

  function sanitizeStorageFileName(fileName) {
    var base = String(fileName || 'file').replace(/[\\/:*?"<>|#%]/g, '-').trim();
    return base || 'file';
  }

  function buildOneDriveStoragePath(ctx) {
    var projectFolder = sanitizePathSegment(ctx.projectCode) + '_' + sanitizePathSegment(ctx.projectName || ctx.projectCode, 48);
    var siteFolder = sanitizePathSegment(ctx.siteCode) + '_' + sanitizePathSegment(ctx.siteName || ctx.siteCode, 48);
    var docFolder = sanitizePathSegment(ctx.documentTitle, 56);
    if (ctx.checklistItemId) {
      docFolder = sanitizePathSegment(String(ctx.checklistItemId).slice(-8), 12) + '_' + docFolder;
    }
    return [
      'PEA-Solar-DocTrack',
      sanitizePathSegment(ctx.contractNo),
      projectFolder,
      siteFolder,
      docFolder,
      'v' + Number(ctx.version || 1),
      sanitizeStorageFileName(ctx.fileName)
    ].join('/');
  }

  function formatBytes(n) {
    var b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function uploadFilesToChecklistItem(db, session, payload) {
    requireFields(payload || {}, ['checklistItemId']);
    var fileList = payload.files;
    if (!fileList || !fileList.length) {
      if (payload.fileName) {
        fileList = [{ fileName: payload.fileName, mimeType: payload.mimeType, sizeBytes: payload.sizeBytes }];
      } else {
        throw new Error('กรุณาเลือกไฟล์อย่างน้อย 1 ไฟล์');
      }
    }
    var item = findById(db, 'ChecklistItems', payload.checklistItemId);
    if (!item) throw new Error('ไม่พบรายการเอกสาร');
    var site = findById(db, 'Sites', item.siteId);
    if (!site) throw new Error('ไม่พบสถานที่');
    var project = findById(db, 'Projects', site.projectId);
    if (!project) throw new Error('ไม่พบโครงการ');
    assertProjectEditable(project);
    var contract = findById(db, 'Contracts', project.contractId);
    if (!contract) throw new Error('ไม่พบสัญญา');
    var templates = list(db, 'ChecklistTemplates');
    var tpl = templates.filter(function (t) { return t.id === item.templateId; })[0];
    var documentTitle = item.customTitle || (tpl && tpl.title) || 'เอกสารกำหนดเอง';

    var existingCurrent = findWhere(db, 'Files', function (f) {
      return f.checklistItemId === item.id && f.isCurrent;
    });
    var versions = findWhere(db, 'Files', function (f) { return f.checklistItemId === item.id; });
    var nextVersion = versions.reduce(function (m, f) { return Math.max(m, Number(f.version) || 0); }, 0) + 1;

    var t = nowIso();
    var uploadNote = String(payload.note || payload.reason || '').trim();
    var saved = [];
    var folderUrl = getFolderUrl(db);

    fileList.forEach(function (f) {
      requireFields(f || {}, ['fileName']);
      var path = buildOneDriveStoragePath({
        contractNo: contract.contractNo,
        projectCode: project.projectCode,
        projectName: project.name,
        siteCode: site.siteCode,
        siteName: site.name,
        documentTitle: documentTitle,
        checklistItemId: item.id,
        version: nextVersion,
        fileName: f.fileName
      });
      var file = append(db, 'Files', {
        id: uid('file'),
        checklistItemId: item.id,
        fileName: f.fileName,
        mimeType: f.mimeType || 'application/octet-stream',
        sizeBytes: Number(f.sizeBytes) || 0,
        version: nextVersion,
        reason: uploadNote || (existingCurrent.length ? 'เพิ่มไฟล์' : 'อัปโหลดครั้งแรก'),
        storageProvider: STORAGE.MOCK,
        storagePath: path,
        webUrl: folderUrl,
        uploadedBy: session.userId,
        uploadedAt: t,
        isCurrent: true
      });
      saved.push(file);
      writeAudit(db, session.userId, 'UPLOAD_FILE', 'File', file.id, {
        checklistItemId: item.id,
        version: nextVersion,
        reason: file.reason,
        fileName: file.fileName,
        storagePath: path,
        batchSize: fileList.length
      });
    });

    updateById(db, 'ChecklistItems', item.id, {
      status: ITEM_STATUS.UPLOADED,
      currentFileId: saved[saved.length - 1].id,
      updatedAt: t
    });

    return {
      files: saved,
      file: saved[0],
      storageNote: 'Mock: metadata + path ตามลำดับโครงการ — รองรับหลายไฟล์/ขนาดใหญ่ (Graph upload จริง)',
      storagePathExample: saved[0] && saved[0].storagePath
    };
  }

  function refreshChecklistItemFileState(db, itemId) {
    var currents = findWhere(db, 'Files', function (f) {
      return f.checklistItemId === itemId && f.isCurrent;
    });
    var t = nowIso();
    if (!currents.length) {
      updateById(db, 'ChecklistItems', itemId, {
        status: ITEM_STATUS.EMPTY,
        currentFileId: '',
        updatedAt: t
      });
      return;
    }
    updateById(db, 'ChecklistItems', itemId, {
      status: ITEM_STATUS.UPLOADED,
      currentFileId: currents[currents.length - 1].id,
      updatedAt: t
    });
  }

  function apiDeleteFile(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.KHT]);
    requireFields(payload || {}, ['fileId', 'reason']);
    var reason = String(payload.reason || '').trim();
    if (!reason) throw new Error('ต้องระบุเหตุผลเมื่อลบไฟล์');
    var db = loadDb();
    var file = findById(db, 'Files', payload.fileId);
    if (!file) throw new Error('ไม่พบไฟล์');
    if (!file.isCurrent) throw new Error('ไฟล์นี้ถูกลบหรือแทนที่ไปแล้ว');
    var item = findById(db, 'ChecklistItems', file.checklistItemId);
    if (!item) throw new Error('ไม่พบรายการเอกสาร');
    var site = findById(db, 'Sites', item.siteId);
    var project = findById(db, 'Projects', site.projectId);
    assertProjectEditable(project);
    var t = nowIso();
    var updated = updateById(db, 'Files', file.id, {
      isCurrent: false,
      deleteReason: reason,
      deletedAt: t,
      deletedBy: session.userId
    });
    refreshChecklistItemFileState(db, item.id);
    writeAudit(db, session.userId, 'DELETE_FILE', 'File', file.id, {
      checklistItemId: item.id,
      fileName: file.fileName,
      reason: reason,
      storagePath: file.storagePath || ''
    });
    saveDb(db);
    return ok({ file: updated });
  }

  function apiUploadFiles(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.KHT]);
    var db = loadDb();
    var result = uploadFilesToChecklistItem(db, session, payload);
    saveDb(db);
    return ok({
      files: result.files,
      file: result.file,
      storageNote: result.storageNote,
      storagePathExample: result.storagePathExample
    });
  }

  function apiUploadFile(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.KHT]);
    var db = loadDb();
    var result = uploadFilesToChecklistItem(db, session, payload);
    saveDb(db);
    return ok({ file: result.file, files: result.files, storageNote: result.storageNote });
  }

  function apiOpenFile(token, fileId) {
    var session = requireSession(token);
    requireFields({ fileId: fileId }, ['fileId']);
    var db = loadDb();
    var file = findById(db, 'Files', fileId);
    if (!file) throw new Error('ไม่พบไฟล์');
    writeAudit(db, session.userId, 'OPEN_FILE', 'File', fileId, { provider: file.storageProvider || STORAGE.MOCK });
    saveDb(db);
    return ok({
      file: file,
      open: {
        url: file.webUrl || getFolderUrl(db),
        provider: file.storageProvider || STORAGE.MOCK,
        path: file.storagePath || '',
        message: 'โหมด Mock — path: ' + (file.storagePath || '') + ' (เปิดโฟลเดอร์ SharePoint ราก)'
      }
    });
  }

  function apiSubmitProject(token, projectId) {
    var session = requireSession(token);
    requireRole(session, [ROLES.KHT]);
    requireFields({ projectId: projectId }, ['projectId']);
    var db = loadDb();
    var project = findById(db, 'Projects', projectId);
    if (!project) throw new Error('ไม่พบโครงการ');
    if (project.status !== PROJECT_STATUS.DRAFT && project.status !== PROJECT_STATUS.NEEDS_REVISION) {
      throw new Error('สถานะปัจจุบันส่งตรวจไม่ได้: ' + project.status);
    }
    if (!projectRequiredComplete(db, projectId)) {
      throw new Error('รายการบังคับยังไม่ครบทุกพื้นที่ — ส่งตรวจไม่ได้');
    }
    var t = nowIso();
    var patch = { status: PROJECT_STATUS.SUBMITTED, updatedAt: t };
    if (!project.firstSubmittedAt) patch.firstSubmittedAt = t;
    var updated = updateById(db, 'Projects', projectId, patch);
    findWhere(db, 'Sites', function (s) { return s.projectId === projectId; }).forEach(function (s) {
      updateById(db, 'Sites', s.id, { status: PROJECT_STATUS.SUBMITTED, updatedAt: t });
    });
    writeAudit(db, session.userId, 'SUBMIT_PROJECT', 'Project', projectId, { firstSubmittedAt: updated.firstSubmittedAt });
    notifyRole(db, ROLES.GTHP, 'PROJECT_SUBMITTED', 'ส่งตรวจ: ' + project.name, 'รอ กธพ. ตรวจสอบ', 'project:' + projectId);
    saveDb(db);
    return ok({ project: updated });
  }

  function apiRequestRevision(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    requireFields(payload || {}, ['projectId', 'message']);
    var db = loadDb();
    var project = findById(db, 'Projects', payload.projectId);
    if (!project) throw new Error('ไม่พบโครงการ');
    if (project.status !== PROJECT_STATUS.SUBMITTED) throw new Error('ขอแก้ไขได้เฉพาะโครงการที่ส่งตรวจแล้ว');
    var t = nowIso();
    var updated = updateById(db, 'Projects', payload.projectId, {
      status: PROJECT_STATUS.NEEDS_REVISION, reviewedAt: t, updatedAt: t
    });
    findWhere(db, 'Sites', function (s) { return s.projectId === payload.projectId; }).forEach(function (s) {
      updateById(db, 'Sites', s.id, { status: PROJECT_STATUS.NEEDS_REVISION, updatedAt: t });
    });
    append(db, 'Comments', {
      id: uid('cmt'), projectId: payload.projectId, siteId: payload.siteId || '',
      authorId: session.userId, body: '[ขอแก้ไข] ' + String(payload.message).trim(), createdAt: t
    });
    writeAudit(db, session.userId, 'REQUEST_REVISION', 'Project', payload.projectId, payload);
    if (project.ownerId) {
      writeNotification(db, project.ownerId, 'REVISION', 'ขอแก้ไข: ' + project.name, payload.message, 'project:' + payload.projectId);
    }
    saveDb(db);
    return ok({ project: updated });
  }

  function apiAcceptProject(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    requireFields(payload || {}, ['projectId']);
    var db = loadDb();
    var project = findById(db, 'Projects', payload.projectId);
    if (!project) throw new Error('ไม่พบโครงการ');
    if (project.status !== PROJECT_STATUS.SUBMITTED) throw new Error('ยอมรับได้เฉพาะโครงการที่ส่งตรวจแล้ว');
    if (!projectRequiredComplete(db, payload.projectId)) throw new Error('รายการบังคับยังไม่ครบ — ยอมรับไม่ได้');
    var t = nowIso();
    var updated = updateById(db, 'Projects', payload.projectId, {
      status: PROJECT_STATUS.COMPLETED, completedAt: t, reviewedAt: t, updatedAt: t
    });
    findWhere(db, 'Sites', function (s) { return s.projectId === payload.projectId; }).forEach(function (s) {
      updateById(db, 'Sites', s.id, { status: PROJECT_STATUS.COMPLETED, updatedAt: t });
      findWhere(db, 'ChecklistItems', function (i) { return i.siteId === s.id; }).forEach(function (i) {
        if (i.status === ITEM_STATUS.UPLOADED) {
          updateById(db, 'ChecklistItems', i.id, { status: ITEM_STATUS.ACCEPTED, updatedAt: t });
        }
      });
    });
    if (payload.message) {
      append(db, 'Comments', {
        id: uid('cmt'), projectId: payload.projectId, siteId: '',
        authorId: session.userId, body: '[ยอมรับ] ' + String(payload.message).trim(), createdAt: t
      });
    }
    writeAudit(db, session.userId, 'ACCEPT_PROJECT', 'Project', payload.projectId, {
      completedAt: t, firstSubmittedAt: project.firstSubmittedAt, reviewedAt: t
    });
    if (project.ownerId) {
      writeNotification(db, project.ownerId, 'ACCEPTED', 'ยอมรับแล้ว: ' + project.name, payload.message || 'กธพ. ยอมรับเอกสารครบ', 'project:' + payload.projectId);
    }
    saveDb(db);
    return ok({ project: updated });
  }

  function apiAddComment(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.KHT, ROLES.GTHP]);
    requireFields(payload || {}, ['projectId', 'body']);
    var db = loadDb();
    var project = findById(db, 'Projects', payload.projectId);
    if (!project) throw new Error('ไม่พบโครงการ');
    var comment = append(db, 'Comments', {
      id: uid('cmt'),
      projectId: payload.projectId,
      siteId: payload.siteId || '',
      authorId: session.userId,
      body: String(payload.body).trim(),
      createdAt: nowIso()
    });
    writeAudit(db, session.userId, 'ADD_COMMENT', 'Comment', comment.id, payload);
    if (session.role === ROLES.KHT) {
      notifyRole(db, ROLES.GTHP, 'COMMENT', 'ความเห็นใหม่: ' + project.name, payload.body, 'project:' + payload.projectId);
    } else if (project.ownerId) {
      writeNotification(db, project.ownerId, 'COMMENT', 'ความเห็นจาก กธพ.: ' + project.name, payload.body, 'project:' + payload.projectId);
    }
    saveDb(db);
    return ok({ comment: comment, author: sanitizeUser(getUserById(db, session.userId)) });
  }

  function apiGetReviewQueue(token) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    var dash = apiGetDashboard(token);
    var queue = dash.data.projects.filter(function (p) {
      return p.project.status === PROJECT_STATUS.SUBMITTED || p.project.status === PROJECT_STATUS.NEEDS_REVISION;
    });
    return ok({ queue: queue });
  }

  function apiListUsers(token) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    var db = loadDb();
    return ok({ users: list(db, 'Users').map(sanitizeUser) });
  }

  function apiSaveUser(token, payload) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    requireFields(payload || {}, ['employeeId', 'firstName', 'lastName', 'role']);
    if ([ROLES.KHT, ROLES.GTHP].indexOf(payload.role) === -1) throw new Error('กองต้องเป็น กขท. หรือ กธพ.');
    var firstName = String(payload.firstName).trim();
    var lastName = String(payload.lastName).trim();
    var fullName = buildUserFullName(firstName, lastName);
    if (!fullName) throw new Error('กรุณาระบุชื่อหรือนามสกุล');
    var employeeId = String(payload.employeeId).trim();
    if (!employeeId) throw new Error('กรุณาระบุรหัสประจำตัว');
    var db = loadDb();
    var t = nowIso();
    if (payload.id) {
      var before = getUserById(db, payload.id);
      if (!before) throw new Error('ไม่พบผู้ใช้');
      if (findOneWhere(db, 'Users', function (u) {
        return String(u.employeeId) === employeeId && String(u.id) !== String(payload.id);
      })) throw new Error('รหัสประจำตัวนี้มีในระบบแล้ว');
      var beforeParts = ensureUserNameParts(before);
      var updated = updateById(db, 'Users', payload.id, {
        employeeId: employeeId,
        firstName: firstName,
        lastName: lastName,
        name: fullName,
        role: payload.role,
        email: payload.email || '',
        active: payload.active !== false,
        updatedAt: t
      });
      writeAudit(db, session.userId, 'UPDATE_USER', 'User', payload.id, {
        at: t,
        employeeId: employeeId,
        firstName: firstName,
        lastName: lastName,
        role: payload.role,
        before: {
          employeeId: before.employeeId,
          firstName: beforeParts.firstName,
          lastName: beforeParts.lastName,
          role: before.role
        }
      });
      saveDb(db);
      return ok({ user: sanitizeUser(updated) });
    }
    if (findOneWhere(db, 'Users', function (u) { return String(u.employeeId) === employeeId; })) {
      throw new Error('รหัสประจำตัวนี้มีในระบบแล้ว');
    }
    var created = append(db, 'Users', {
      id: uid('usr'),
      employeeId: employeeId,
      firstName: firstName,
      lastName: lastName,
      name: fullName,
      role: payload.role,
      email: payload.email || '',
      emailPreferences: payload.emailPreferences || { submit: true, revision: true, accept: true, comment: true },
      active: true,
      createdAt: t,
      updatedAt: t
    });
    writeAudit(db, session.userId, 'CREATE_USER', 'User', created.id, {
      at: t,
      employeeId: employeeId,
      firstName: firstName,
      lastName: lastName,
      role: payload.role
    });
    saveDb(db);
    return ok({ user: sanitizeUser(created) });
  }

  function apiDeactivateUser(token, userId) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    requireFields({ userId: userId }, ['userId']);
    if (userId === session.userId) throw new Error('ไม่สามารถปิดใช้งานบัญชีตนเอง');
    var db = loadDb();
    var updated = updateById(db, 'Users', userId, { active: false, updatedAt: nowIso() });
    writeAudit(db, session.userId, 'DEACTIVATE_USER', 'User', userId, {});
    saveDb(db);
    return ok({ user: sanitizeUser(updated) });
  }

  function apiGetNotifications(token) {
    var session = requireSession(token);
    var db = loadDb();
    var notifications = findWhere(db, 'Notifications', function (n) { return n.userId === session.userId; })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return ok({ notifications: notifications });
  }

  function apiMarkNotificationRead(token, notificationId) {
    var session = requireSession(token);
    var db = loadDb();
    var n = findById(db, 'Notifications', notificationId);
    if (!n || n.userId !== session.userId) throw new Error('ไม่พบการแจ้งเตือน');
    var updated = updateById(db, 'Notifications', notificationId, { read: true });
    saveDb(db);
    return ok({ notification: updated });
  }

  function apiMarkAllNotificationsRead(token) {
    var session = requireSession(token);
    var db = loadDb();
    findWhere(db, 'Notifications', function (n) {
      return n.userId === session.userId && !n.read;
    }).forEach(function (n) { updateById(db, 'Notifications', n.id, { read: true }); });
    saveDb(db);
    return ok({ done: true });
  }

  function apiUpdateEmailPreferences(token, payload) {
    var session = requireSession(token);
    var db = loadDb();
    var user = getUserById(db, session.userId);
    if (!user) throw new Error('ไม่พบผู้ใช้');
    payload = payload || {};
    var existing = normalizeEmailPreferences(user.emailPreferences, user.email);
    var emails = existing.emails.slice();

    if (Object.prototype.hasOwnProperty.call(payload, 'emails')) {
      emails = normalizeNotificationEmails(payload.emails);
    } else if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
      emails = normalizeNotificationEmails([payload.email]);
    }
    if (!emails.length) throw new Error('กรุณาระบุอีเมลอย่างน้อย 1 ที่');

    var prefs = {
      submit: Object.prototype.hasOwnProperty.call(payload, 'submit') ? !!payload.submit : existing.submit,
      revision: Object.prototype.hasOwnProperty.call(payload, 'revision') ? !!payload.revision : existing.revision,
      accept: Object.prototype.hasOwnProperty.call(payload, 'accept') ? !!payload.accept : existing.accept,
      comment: Object.prototype.hasOwnProperty.call(payload, 'comment') ? !!payload.comment : existing.comment,
      emails: emails
    };

    var updated = updateById(db, 'Users', session.userId, {
      email: emails[0],
      emailPreferences: prefs,
      updatedAt: nowIso()
    });
    writeAudit(db, session.userId, 'UPDATE_EMAIL_PREFS', 'User', session.userId, {
      emails: emails,
      preferences: prefs
    });
    saveDb(db);
    var sessions = loadSessions();
    if (sessions[token]) {
      sessions[token].emailPreferences = prefs;
      sessions[token].email = emails[0];
    }
    saveSessions(sessions);
    return ok({ user: sanitizeUser(updated) });
  }

  function apiGetAuditLogs(token, limit) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    var db = loadDb();
    var logs = list(db, 'AuditLogs').slice().sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    }).slice(0, Number(limit) || 200);
    var users = list(db, 'Users');
    var enriched = logs.map(function (l) {
      var actor = users.filter(function (u) { return u.id === l.actorId; })[0];
      return { log: l, actor: actor ? sanitizeUser(actor) : { name: l.actorId || 'system' } };
    });
    return ok({ logs: enriched });
  }

  function apiGetUserAuditLogs(token, userId) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    requireFields({ userId: userId }, ['userId']);
    var db = loadDb();
    if (!getUserById(db, userId)) throw new Error('ไม่พบผู้ใช้');
    var logs = findWhere(db, 'AuditLogs', function (l) {
      return l.entityType === 'User' && String(l.entityId) === String(userId);
    }).sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    var users = list(db, 'Users');
    var enriched = logs.map(function (l) {
      var actor = users.filter(function (u) { return u.id === l.actorId; })[0];
      return { log: l, actor: actor ? sanitizeUser(actor) : { name: l.actorId || 'system' } };
    });
    return ok({ logs: enriched });
  }

  function apiGetSettings(token) {
    requireSession(token);
    var db = loadDb();
    var settings = {};
    list(db, 'Settings').forEach(function (s) { settings[s.key] = s.value; });
    settings.onedriveMode = getStorageMode(db);
    settings.storageFolderUrl = getFolderUrl(db);
    settings.spreadsheetId = settings.spreadsheetId || 'localStorage-mock';
    return ok({ settings: settings });
  }

  function apiRunSetup(token) {
    var db = loadDb();
    var session = token ? getSession(token) : null;
    if (session) {
      writeAudit(db, session.userId, 'RUN_SETUP', 'Settings', 'localStorage', { message: 'ensure seed present' });
      saveDb(db);
    }
    return ok({ ok: true, message: 'Mock data พร้อมใช้งาน (localStorage)', spreadsheetId: 'localStorage-mock' });
  }

  function apiResetAndSeed(token) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    var seed = buildSeed();
    writeAudit(seed, session.userId, 'RESET_AND_SEED', 'Settings', 'seed', { message: 'รีเซ็ต localStorage seed' });
    saveDb(seed);
    saveSessions({});
    return ok({ ok: true, message: 'รีเซ็ตและ seed ข้อมูลใหม่แล้ว' });
  }

  function setStorageMode(mode, token) {
    var session = requireSession(token);
    requireRole(session, [ROLES.GTHP]);
    if (mode !== STORAGE.MOCK && mode !== STORAGE.GRAPH) throw new Error('โหมดต้องเป็น Mock หรือ Graph');
    if (mode === STORAGE.GRAPH) {
      // Stub: allow switch but keep mock uploads working with a note path
    }
    var db = loadDb();
    upsertSetting(db, 'onedriveMode', mode);
    writeAudit(db, session.userId, 'SET_STORAGE_MODE', 'Settings', 'onedriveMode', { mode: mode });
    saveDb(db);
    return ok({ mode: mode });
  }

  // Ensure seed exists on first load
  loadDb();

  var api = {
    apiGetBootstrap: wrap(apiGetBootstrap),
    apiLogin: wrap(apiLogin),
    apiLogout: wrap(apiLogout),
    apiGetDashboard: wrap(apiGetDashboard),
    apiGetProject: wrap(apiGetProject),
    apiSaveContract: wrap(apiSaveContract),
    apiSaveProject: wrap(apiSaveProject),
    apiSaveSite: wrap(apiSaveSite),
    apiAddCustomChecklistItem: wrap(apiAddCustomChecklistItem),
    apiUploadFile: wrap(apiUploadFile),
    apiUploadFiles: wrap(apiUploadFiles),
    apiDeleteFile: wrap(apiDeleteFile),
    apiOpenFile: wrap(apiOpenFile),
    apiSubmitProject: wrap(apiSubmitProject),
    apiRequestRevision: wrap(apiRequestRevision),
    apiAcceptProject: wrap(apiAcceptProject),
    apiAddComment: wrap(apiAddComment),
    apiGetReviewQueue: wrap(apiGetReviewQueue),
    apiListUsers: wrap(apiListUsers),
    apiSaveUser: wrap(apiSaveUser),
    apiDeactivateUser: wrap(apiDeactivateUser),
    apiGetNotifications: wrap(apiGetNotifications),
    apiMarkNotificationRead: wrap(apiMarkNotificationRead),
    apiMarkAllNotificationsRead: wrap(apiMarkAllNotificationsRead),
    apiUpdateEmailPreferences: wrap(apiUpdateEmailPreferences),
    apiGetAuditLogs: wrap(apiGetAuditLogs),
    apiGetUserAuditLogs: wrap(apiGetUserAuditLogs),
    apiGetSettings: wrap(apiGetSettings),
    apiRunSetup: wrap(apiRunSetup),
    apiResetAndSeed: wrap(apiResetAndSeed),
    setStorageMode: wrap(setStorageMode),
    // test helpers
    _buildSeed: buildSeed,
    _loadDb: loadDb,
    _FOLDER_URL: FOLDER_URL
  };

  global.MockAPI = api;
})(typeof window !== 'undefined' ? window : global);

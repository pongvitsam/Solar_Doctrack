#!/usr/bin/env node
/**
 * Static validation: layout, JS syntax, seed + mock API smoke workflow.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var { execFileSync } = require('child_process');

var root = path.resolve(__dirname, '..');
var fails = 0;

function pass(msg) { console.log('  OK  ' + msg); }
function fail(msg) { console.error('  FAIL  ' + msg); fails++; }

function assert(cond, msg) {
  if (cond) pass(msg);
  else fail(msg);
}

console.log('1) File layout');
[
  'index.html',
  'assets/styles.css',
  'assets/mock-api.js',
  'assets/app.js',
  'README.md',
  '.gitignore',
  'package.json'
].forEach(function (f) {
  assert(fs.existsSync(path.join(root, f)), f + ' exists');
});

console.log('2) No GAS / backend leftovers in static root');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.indexOf('<?!=') === -1, 'index.html has no GAS template tags');
assert(html.indexOf('include(') === -1, 'index.html has no include()');
assert(html.indexOf('assets/styles.css') !== -1, 'index.html links styles.css');
assert(html.indexOf('assets/mock-api.js') !== -1, 'index.html loads mock-api.js');
assert(html.indexOf('assets/app.js') !== -1, 'index.html loads app.js');

var app = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
assert(app.indexOf('google.script.run') === -1, 'app.js has no google.script.run');
assert(app.indexOf('MockAPI') !== -1, 'app.js uses MockAPI');

['Code.gs', 'Config.gs', 'Repository.gs', 'Setup.gs', 'OneDriveService.gs', 'appsscript.json'].forEach(function (f) {
  assert(!fs.existsSync(path.join(root, f)), 'no backend file ' + f);
});

console.log('3) JS syntax (node --check)');
['assets/mock-api.js', 'assets/app.js', 'scripts/validate.js'].forEach(function (f) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
    pass(f + ' syntax');
  } catch (e) {
    fail(f + ' syntax: ' + (e.stderr && e.stderr.toString()) || e.message);
  }
});

console.log('4) Mock API seed + workflow (vm + localStorage polyfill)');
(function () {
  var store = Object.create(null);
  var sandbox = {
    console: console,
    Math: Math,
    Date: Date,
    JSON: JSON,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    Promise: Promise,
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; },
      clear: function () { store = Object.create(null); }
    },
    window: null
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;

  var code = fs.readFileSync(path.join(root, 'assets/mock-api.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'mock-api.js' });
  var API = sandbox.MockAPI;
  assert(!!API, 'MockAPI exported');

  return Promise.resolve()
    .then(function () { return API.apiGetBootstrap(''); })
    .then(function (boot) {
      assert(boot.demoAccounts && boot.demoAccounts.length === 2, 'bootstrap demo accounts (KHT + GTHP)');
      assert(String(boot.authWarning || '').length > 10, 'auth warning present');
      var db = API._loadDb();
      assert(db.Users.length >= 6, 'users seeded (>=6 incl inactive)');
      assert(db.Projects.length >= 4, 'projects seeded (>=4)');
      var statuses = db.Projects.map(function (p) { return p.status; });
      ['Draft', 'Submitted', 'NeedsRevision', 'Completed'].forEach(function (st) {
        assert(statuses.indexOf(st) !== -1, 'project status ' + st);
      });
      assert(db.Files.length > 10, 'files seeded');
      assert(db.Comments.length >= 4, 'comments seeded');
      assert(db.Notifications.length >= 5, 'notifications seeded');
      assert(db.AuditLogs.length >= 5, 'audit seeded');
      assert(API._FOLDER_URL.indexOf('sharepoint.com') !== -1, 'SharePoint folder URL');
      return API.apiLogin('KHT001');
    })
    .then(function (login) {
      assert(login.session && login.session.role === 'KHT', 'login KHT001');
      var tok = login.session.token;
      return API.apiGetDashboard(tok).then(function (dash) {
        assert(dash.kpi.totalProjects >= 4, 'dashboard kpi projects');
        assert(dash.contracts.length >= 3, 'contracts present');
        return API.apiSaveContract(tok, {
          contractNo: 'VAL-' + Date.now(),
          title: 'สัญญาทดสอบ validate',
          description: 'auto'
        }).then(function (ctr) {
          return API.apiSaveProject(tok, {
            contractId: ctr.contract.id,
            projectCode: 'VAL-' + Date.now(),
            name: 'โครงการ Validate',
            description: 'smoke',
            sites: [{ siteCode: 'S1', name: 'พื้นที่ทดสอบ', location: 'BKK' }]
          });
        }).then(function (prj) {
          return API.apiGetProject(tok, prj.project.id).then(function (detail) {
            var required = detail.sites[0].items.filter(function (i) { return i.item.required; });
            assert(required.length >= 8, 'required checklist items');
            var chain = Promise.resolve();
            required.forEach(function (iv, idx) {
              chain = chain.then(function () {
                return API.apiUploadFile(tok, {
                  checklistItemId: iv.item.id,
                  fileName: 'doc-' + (idx + 1) + '.pdf',
                  mimeType: 'application/pdf',
                  sizeBytes: 1000 * (idx + 1),
                  reason: ''
                });
              });
            });
            return chain.then(function () {
              return API.apiUploadFile(tok, {
                checklistItemId: required[0].item.id,
                fileName: 'doc-1-v2.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 2000
              });
            }).then(function (v2) {
              return API.apiDeleteFile(tok, {
                fileId: v2.file.id,
                reason: 'ลบเพื่อทดสอบ workflow'
              });
            }).then(function () {
              return API.apiSubmitProject(tok, prj.project.id);
            }).then(function (sub) {
              assert(sub.project.status === 'Submitted', 'submit → Submitted');
              return API.apiLogin('GTHP001');
            }).then(function (gLogin) {
              var gTok = gLogin.session.token;
              var newEmpId = 'VU' + String(Date.now()).slice(-7);
              return API.apiSaveUser(gTok, {
                firstName: 'Validate',
                lastName: 'Account',
                employeeId: newEmpId,
                role: 'KHT'
              }).then(function (uRes) {
                assert(uRes.user.firstName === 'Validate', 'gthp create user with first/last name');
                return API.apiGetUserAuditLogs(gTok, uRes.user.id);
              }).then(function (aRes) {
                assert(aRes.logs && aRes.logs.some(function (r) { return r.log.action === 'CREATE_USER'; }), 'user create audit trail');
                return API.apiRequestRevision(gTok, {
                  projectId: prj.project.id,
                  message: 'ปรับ SLD ให้ชัดขึ้น'
                }).then(function (rev) {
                  assert(rev.project.status === 'NeedsRevision', 'revision → NeedsRevision');
                  return API.apiSubmitProject(tok, prj.project.id);
                }).then(function () {
                  return API.apiAcceptProject(gTok, {
                    projectId: prj.project.id,
                    message: 'ยอมรับครบถ้วน'
                  });
                }).then(function (acc) {
                  assert(acc.project.status === 'Completed', 'accept → Completed');
                  return API.apiResetAndSeed(gTok);
                }).then(function () {
                  var db2 = API._loadDb();
                  assert(db2.Projects.some(function (p) { return p.id === 'prj_water_001'; }), 'reset restores seed');
                  pass('full KHT→GTHP workflow + reset');
                });
              });
            });
          });
        });
      });
    })
    .then(function () {
      console.log('');
      if (fails) {
        console.error('Validation finished with ' + fails + ' failure(s)');
        process.exit(1);
      }
      console.log('All validation checks passed.');
    })
    .catch(function (err) {
      fail('workflow error: ' + err.message);
      console.error(err.stack || err);
      process.exit(1);
    });
})();

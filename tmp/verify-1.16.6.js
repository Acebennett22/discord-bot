// Verify 1.16.6: local dashboard accounts (Admin/Staff/Viewer) + role gates.
// Exercises the REAL localAccounts util and dashboardAuth middleware/handlers
// with mocked req/res/next and an in-memory fake for src/utils/database
// (no live MySQL in this sandbox). Never prints a password or hash.
'use strict';

const path = require('path');

// --- Fake database (in-memory dashboard_accounts + staff_audit) -----------
const store = { accounts: [], audit: [], nextId: 1 };
let dbEnabled = true;
const fakeDb = {
  isEnabled: () => dbEnabled,
  query: async (sql, params = []) => {
    const s = String(sql);
    if (s.includes('FROM staff_users')) return [];
    if (s.includes('INSERT INTO staff_audit')) {
      store.audit.push({ actor_id: params[0], action: params[1], target_id: params[2], details: params[3] });
      return { insertId: store.audit.length };
    }
    // DELETE must be matched before the SELECT branch: it also contains
    // 'FROM dashboard_accounts'.
    if (s.startsWith('DELETE FROM dashboard_accounts')) {
      const i = store.accounts.findIndex((a) => String(a.id) === String(params[0]));
      if (i >= 0) store.accounts.splice(i, 1);
      return { affectedRows: i >= 0 ? 1 : 0 };
    }
    if (s.trimStart().startsWith('SELECT') && s.includes('FROM dashboard_accounts')) {
      if (s.includes('COUNT(*) AS n')) {
        return [{ n: store.accounts.filter((a) => a.role === 'admin' && !a.disabled).length }];
      }
      if (s.includes('LOWER(username)')) {
        const row = store.accounts.find((a) => a.username.toLowerCase() === String(params[0]).toLowerCase());
        return row ? [row] : [];
      }
      if (s.includes('WHERE id = ?')) {
        const row = store.accounts.find((a) => String(a.id) === String(params[0]));
        return row ? [row] : [];
      }
      if (s.includes('ORDER BY username')) {
        return [...store.accounts].sort((a, b) => a.username.localeCompare(b.username));
      }
      return [];
    }
    if (s.startsWith('INSERT INTO dashboard_accounts')) {
      const row = { id: store.nextId++, username: params[0], password_hash: params[1], role: params[2], disabled: 0, created_by: params[3], created_at: new Date().toISOString(), last_login_at: null };
      store.accounts.push(row);
      return { insertId: row.id };
    }
    if (s.startsWith('UPDATE dashboard_accounts SET role')) {
      const row = store.accounts.find((a) => String(a.id) === String(params[1]));
      if (row) row.role = params[0];
      return { affectedRows: row ? 1 : 0 };
    }
    if (s.startsWith('UPDATE dashboard_accounts SET disabled')) {
      const row = store.accounts.find((a) => String(a.id) === String(params[1]));
      if (row) row.disabled = params[0];
      return { affectedRows: row ? 1 : 0 };
    }
    if (s.startsWith('UPDATE dashboard_accounts SET password_hash')) {
      const row = store.accounts.find((a) => String(a.id) === String(params[1]));
      if (row) row.password_hash = params[0];
      return { affectedRows: row ? 1 : 0 };
    }
    if (s.includes('SET last_login_at = CURRENT_TIMESTAMP')) {
      const row = store.accounts.find((a) => String(a.id) === String(params[0]));
      if (row) row.last_login_at = new Date().toISOString();
      return { affectedRows: row ? 1 : 0 };
    }
    return [];
  },
};

// Install the stub BEFORE requiring anything that loads src/utils/database.
const dbPath = require.resolve('../src/utils/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const localAccounts = require('../src/utils/localAccounts');
const auth = require('../src/utils/dashboardAuth');
const config = require('../src/utils/config');
const fs = require('fs');

// --- Test harness -----------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
}
async function checkThrows(name, fn, match) {
  try { await fn(); check(name, false); }
  catch (e) { check(name, !match || String(e.message).includes(match)); }
}

// Mock req/res/next.
function mockSession(extra = {}) {
  return { regenerate: (cb) => cb(null), ...extra };
}
function mockReq({ session = mockSession(), path = '/api/staff/x', body = {}, params = {}, ip = '10.0.0.9' } = {}) {
  return { session, path, body, params, ip };
}
function mockRes() {
  const r = { statusCode: 200, body: null, redirected: null, rendered: null, jsonData: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (d) => { r.jsonData = d; return r; };
  r.send = (t) => { r.body = t; return r; };
  r.redirect = (u) => { r.redirected = u; return r; };
  r.render = (view, locals) => { r.rendered = { view, locals }; return r; };
  return r;
}
function nextSpy() {
  const f = (...args) => { f.called = true; f.args = args; };
  f.called = false;
  return f;
}
const OWNER_ID = '999999999999999999';
// The sandbox config.json has ownerId blank (placeholder), which makes
// isOwner() always false — set a test owner in-memory only (never written
// to the file) so the owner paths are actually exercised.
config.ownerId = OWNER_ID;
const STAFF_DISCORD_ID = '111111111111111111';
config.staffUserIds = [STAFF_DISCORD_ID];

(async () => {
  console.log('== hashing ==');
  const h1 = localAccounts.hashPassword('CorrectHorse99');
  check('hash/verify roundtrip', localAccounts.verifyPassword('CorrectHorse99', h1));
  check('wrong password rejected', !localAccounts.verifyPassword('WrongHorse99', h1));
  check('malformed stored hash rejected without throwing', !localAccounts.verifyPassword('x', 'not-a-hash'));
  check('empty stored hash rejected', !localAccounts.verifyPassword('x', ''));
  check('two hashes of same password differ (random salt)', localAccounts.hashPassword('SamePass99') !== localAccounts.hashPassword('SamePass99'));

  console.log('== validation ==');
  await checkThrows('short password rejected', () => localAccounts.createAccount({ username: 'validuser', password: 'short', role: 'viewer', createdBy: 'owner' }), 'at least 8');
  await checkThrows('short username rejected', () => localAccounts.createAccount({ username: 'ab', password: 'LongEnough1', role: 'viewer', createdBy: 'owner' }), '3–32');
  await checkThrows('bad username chars rejected', () => localAccounts.createAccount({ username: 'bad name!', password: 'LongEnough1', role: 'viewer', createdBy: 'owner' }), 'only contain');
  await checkThrows('bad role rejected', () => localAccounts.createAccount({ username: 'validuser', password: 'LongEnough1', role: 'superuser', createdBy: 'owner' }), 'admin, staff, or viewer');

  console.log('== CRUD ==');
  const a1 = await localAccounts.createAccount({ username: 'ModOne', password: 'SecretPass123', role: 'staff', createdBy: OWNER_ID });
  check('create returns id/username/role', a1.id > 0 && a1.username === 'ModOne' && a1.role === 'staff');
  await checkThrows('duplicate username rejected (case-insensitive)', () => localAccounts.createAccount({ username: 'modone', password: 'AnotherPass1', role: 'viewer', createdBy: OWNER_ID }), 'already taken');
  const found = await localAccounts.findByUsername('MODONE');
  check('findByUsername is case-insensitive', found && found.username === 'ModOne');
  const listed = await localAccounts.listAccounts();
  check('list shows account without password hash', listed.length === 1 && listed[0].username === 'ModOne' && !('password_hash' in listed[0]));
  await localAccounts.setRole(a1.id, 'admin');
  check('setRole works', (await localAccounts.findById(a1.id)).role === 'admin');
  await checkThrows('setRole rejects bad role', () => localAccounts.setRole(a1.id, 'nope'), 'admin, staff, or viewer');
  await localAccounts.resetPassword(a1.id, 'BrandNewPass9');
  const afterReset = await localAccounts.findById(a1.id);
  check('reset password: old fails, new verifies', !localAccounts.verifyPassword('SecretPass123', afterReset.password_hash) && localAccounts.verifyPassword('BrandNewPass9', afterReset.password_hash));
  await checkThrows('reset rejects short password', () => localAccounts.resetPassword(a1.id, 'tiny'), 'at least 8');
  const a2 = await localAccounts.createAccount({ username: 'ViewerTwo', password: 'ViewerPass12', role: 'viewer', createdBy: OWNER_ID });
  await localAccounts.deleteAccount(a2.id);
  check('delete removes account', (await localAccounts.findById(a2.id)) === null);

  console.log('== last-admin guards (util) ==');
  // Only one enabled admin (a1) right now.
  await checkThrows('demoting last enabled admin rejected', () => localAccounts.setRole(a1.id, 'staff'), 'last enabled admin');
  await checkThrows('disabling last enabled admin rejected', () => localAccounts.setDisabled(a1.id, true), 'last enabled admin');
  await checkThrows('deleting last enabled admin rejected', () => localAccounts.deleteAccount(a1.id), 'last enabled admin');
  const a3 = await localAccounts.createAccount({ username: 'AdminTwo', password: 'AdminTwoPass1', role: 'admin', createdBy: OWNER_ID });
  await localAccounts.setRole(a1.id, 'staff');
  check('demote ok once a second admin exists', (await localAccounts.findById(a1.id)).role === 'staff');
  await localAccounts.setRole(a1.id, 'admin');
  check('re-promote works', (await localAccounts.findById(a1.id)).role === 'admin');

  console.log('== login handler ==');
  const loginOk = async (username, password, ip = '10.0.0.9') => {
    const req = mockReq({ session: mockSession(), path: '/login/local', body: { username, password }, ip });
    const res = mockRes();
    await auth.handleLocalLogin(req, res);
    return { req, res };
  };
  let r = await loginOk('ModOne', 'BrandNewPass9');
  check('login success sets session + redirects to /staff', r.res.redirected === '/staff' && r.req.session.localAccount?.username === 'ModOne' && r.req.session.localAccount?.role === 'admin' && r.req.session.authType === 'local' && !r.req.session.user);
  check('login success stamps last_login_at', Boolean((await localAccounts.findById(a1.id)).last_login_at));
  const GENERIC = 'Invalid username or password.';
  r = await loginOk('ModOne', 'WrongPass99', '10.0.0.10');
  check('wrong password: generic error, 401, no session', r.res.statusCode === 401 && r.res.rendered?.locals?.error === GENERIC && !r.req.session.localAccount);
  r = await loginOk('NoSuchUser', 'WhateverPass1', '10.0.0.11');
  check('unknown user: same generic error', r.res.statusCode === 401 && r.res.rendered?.locals?.error === GENERIC);
  await localAccounts.setDisabled(a1.id, true);
  // a3 is still an enabled admin, so disabling a1 was allowed.
  r = await loginOk('ModOne', 'BrandNewPass9', '10.0.0.12');
  check('disabled account: same generic error even with right password', r.res.statusCode === 401 && r.res.rendered?.locals?.error === GENERIC && !r.req.session.localAccount);
  await localAccounts.setDisabled(a1.id, false);
  // Lockout: 5 failures on a fresh key, then locked.
  for (let i = 0; i < 5; i++) await loginOk('ModOne', 'WrongPass99', '10.0.0.13');
  check('locked out after 5 failures', localAccounts.isLockedOut('ModOne', '10.0.0.13'));
  r = await loginOk('ModOne', 'BrandNewPass9', '10.0.0.13');
  check('locked out: correct password still gets generic error', r.res.statusCode === 401 && r.res.rendered?.locals?.error === GENERIC && !r.req.session.localAccount);
  r = await loginOk('ModOne', 'BrandNewPass9', '10.0.0.14');
  check('other IP not locked out', r.res.redirected === '/staff');
  // Failures clear on success: 4 failures then success on a fresh key.
  for (let i = 0; i < 4; i++) await loginOk('ModOne', 'WrongPass99', '10.0.0.15');
  r = await loginOk('ModOne', 'BrandNewPass9', '10.0.0.15');
  check('success after 4 failures clears the counter', r.res.redirected === '/staff' && !localAccounts.isLockedOut('ModOne', '10.0.0.15'));

  console.log('== middleware matrix ==');
  const localSession = (role, id = 99) => mockSession({ localAccount: { id, username: `u${id}`, role }, authType: 'local' });
  const discordSession = (id) => mockSession({ user: { id, username: 'discorduser' }, authType: 'discord' });
  // requireStaff
  let nx = nextSpy();
  await auth.requireStaff(mockReq({ session: localSession('viewer') }), mockRes(), nx);
  check('requireStaff: local viewer passes', nx.called);
  nx = nextSpy();
  await auth.requireStaff(mockReq({ session: discordSession(STAFF_DISCORD_ID) }), mockRes(), nx);
  check('requireStaff: Discord staff passes', nx.called);
  nx = nextSpy();
  const res403 = mockRes();
  await auth.requireStaff(mockReq({ session: discordSession('222222222222222222') }), res403, nx);
  check('requireStaff: Discord non-staff 403', !nx.called && res403.statusCode === 403);
  nx = nextSpy();
  const resRedir = mockRes();
  await auth.requireStaff(mockReq({ session: mockSession() }), resRedir, nx);
  check('requireStaff: nobody redirects to /login', !nx.called && resRedir.redirected === '/login');
  // requireStaffWrite
  nx = nextSpy();
  const resW = mockRes();
  await auth.requireStaffWrite(mockReq({ session: localSession('viewer'), path: '/api/staff/errors/purge' }), resW, nx);
  check('requireStaffWrite: viewer POST /api 403 JSON', !nx.called && resW.statusCode === 403 && resW.jsonData?.error === 'Viewer accounts are read-only.');
  nx = nextSpy();
  const resW2 = mockRes();
  await auth.requireStaffWrite(mockReq({ session: localSession('viewer'), path: '/staff/bottracking/settings' }), resW2, nx);
  check('requireStaffWrite: viewer page POST 403 text', !nx.called && resW2.statusCode === 403 && typeof resW2.body === 'string');
  nx = nextSpy();
  await auth.requireStaffWrite(mockReq({ session: localSession('staff'), path: '/api/staff/errors/purge' }), mockRes(), nx);
  check('requireStaffWrite: local staff passes', nx.called);
  nx = nextSpy();
  await auth.requireStaffWrite(mockReq({ session: discordSession(STAFF_DISCORD_ID), path: '/api/staff/errors/purge' }), mockRes(), nx);
  check('requireStaffWrite: Discord staff passes', nx.called);
  nx = nextSpy();
  const resW3 = mockRes();
  await auth.requireStaffWrite(mockReq({ session: mockSession(), path: '/api/staff/errors/purge' }), resW3, nx);
  check('requireStaffWrite: nobody on /api gets 401 JSON', !nx.called && resW3.statusCode === 401);
  // requireAdmin
  nx = nextSpy();
  await auth.requireAdmin(mockReq({ session: localSession('admin', 7) }), mockRes(), nx);
  check('requireAdmin: local admin passes', nx.called);
  nx = nextSpy();
  const resA = mockRes();
  await auth.requireAdmin(mockReq({ session: localSession('staff', 8) }), resA, nx);
  check('requireAdmin: local staff 403', !nx.called && resA.statusCode === 403);
  nx = nextSpy();
  await auth.requireAdmin(mockReq({ session: discordSession(OWNER_ID) }), mockRes(), nx);
  check('requireAdmin: Discord owner passes', nx.called);
  nx = nextSpy();
  const resA2 = mockRes();
  await auth.requireAdmin(mockReq({ session: discordSession(STAFF_DISCORD_ID) }), resA2, nx);
  check('requireAdmin: Discord staff (non-owner) 403', !nx.called && resA2.statusCode === 403);
  // requireOwner stays Discord-owner-only
  nx = nextSpy();
  const resO = mockRes();
  await auth.requireOwner(mockReq({ session: localSession('admin', 7) }), resO, nx);
  check('requireOwner: local admin does NOT pass', !nx.called && resO.statusCode === 403);
  nx = nextSpy();
  await auth.requireOwner(mockReq({ session: discordSession(OWNER_ID) }), mockRes(), nx);
  check('requireOwner: Discord owner passes', nx.called);
  // staffFlag / canManageAccounts / actorId
  check('staffFlag: local viewer true', await auth.staffFlag(mockReq({ session: localSession('viewer') })));
  check('staffFlag: Discord staff true', await auth.staffFlag(mockReq({ session: discordSession(STAFF_DISCORD_ID) })));
  check('staffFlag: Discord non-staff false', !(await auth.staffFlag(mockReq({ session: discordSession('222222222222222222') }))));
  check('staffFlag: nobody false', !(await auth.staffFlag(mockReq({ session: mockSession() }))));
  check('canManageAccounts: local admin true', auth.canManageAccounts(mockReq({ session: localSession('admin') })));
  check('canManageAccounts: local staff false', !auth.canManageAccounts(mockReq({ session: localSession('staff') })));
  check('canManageAccounts: Discord owner true', auth.canManageAccounts(mockReq({ session: discordSession(OWNER_ID) })));
  check('canManageAccounts: Discord staff false', !auth.canManageAccounts(mockReq({ session: discordSession(STAFF_DISCORD_ID) })));
  check('actorId: local -> local:<id>', auth.actorId(mockReq({ session: localSession('staff', 42) })) === 'local:42');
  check('actorId: Discord -> discord id', auth.actorId(mockReq({ session: discordSession('555') })) === '555');

  console.log('== accounts API handlers ==');
  const ownerReq = (body = {}, params = {}) => mockReq({ session: discordSession(OWNER_ID), path: '/api/staff/accounts', body, params });
  const adminReq = (id, body = {}, params = {}) => mockReq({ session: localSession('admin', id), path: '/api/staff/accounts', body, params });
  const auditBefore = store.audit.length;
  r = mockRes();
  await auth.createAccountApi(ownerReq({ username: 'ApiUser', password: 'ApiUserPass1', role: 'viewer' }), r);
  check('createAccountApi: owner creates account', r.jsonData?.ok === true && r.jsonData.account?.username === 'ApiUser');
  check('create audited without password in details', store.audit.length === auditBefore + 1 && store.audit[store.audit.length - 1].action === 'account.create' && !String(store.audit[store.audit.length - 1].details).includes('ApiUserPass1'));
  const apiUser = await localAccounts.findByUsername('ApiUser');
  r = mockRes();
  await auth.createAccountApi(ownerReq({ username: 'apiuser', password: 'OtherPass123', role: 'viewer' }), r);
  check('createAccountApi: duplicate rejected', r.statusCode === 400);
  r = mockRes();
  await auth.setAccountRoleApi(ownerReq({ role: 'staff' }, { id: String(apiUser.id) }), r);
  check('setAccountRoleApi works', r.jsonData?.ok === true && (await localAccounts.findById(apiUser.id)).role === 'staff');
  r = mockRes();
  await auth.resetAccountPasswordApi(ownerReq({ password: 'ResetPass999' }, { id: String(apiUser.id) }), r);
  const afterApiReset = await localAccounts.findById(apiUser.id);
  check('resetAccountPasswordApi works', r.jsonData?.ok === true && localAccounts.verifyPassword('ResetPass999', afterApiReset.password_hash));
  // Self guards (local admin a3 acting on themselves).
  r = mockRes();
  await auth.deleteAccountApi(adminReq(a3.id, {}, { id: String(a3.id) }), r);
  check('deleteAccountApi: cannot delete own account', r.statusCode === 400 && /own account/.test(r.jsonData?.error || ''));
  r = mockRes();
  await auth.setAccountStatusApi(adminReq(a3.id, { disabled: true }, { id: String(a3.id) }), r);
  check('setAccountStatusApi: cannot disable own account', r.statusCode === 400 && /own account/.test(r.jsonData?.error || ''));
  // Last-admin guards via handlers (owner acting): only a3 is an enabled admin now? a1 is admin too — a1 was re-promoted. Disable a1 first via owner, then a3 is last.
  r = mockRes();
  await auth.setAccountStatusApi(ownerReq({ disabled: true }, { id: String(a1.id) }), r);
  check('owner can disable a non-last admin', r.jsonData?.ok === true);
  r = mockRes();
  await auth.deleteAccountApi(ownerReq({}, { id: String(a3.id) }), r);
  check('deleteAccountApi: last enabled admin refused', r.statusCode === 400 && /last enabled admin/.test(r.jsonData?.error || ''));
  r = mockRes();
  await auth.setAccountStatusApi(ownerReq({ disabled: true }, { id: String(a3.id) }), r);
  check('setAccountStatusApi: last enabled admin disable refused', r.statusCode === 400 && /last enabled admin/.test(r.jsonData?.error || ''));
  r = mockRes();
  await auth.setAccountRoleApi(ownerReq({ role: 'viewer' }, { id: String(a3.id) }), r);
  check('setAccountRoleApi: last enabled admin demote refused', r.statusCode === 400 && /last enabled admin/.test(r.jsonData?.error || ''));
  // Re-enable a1 so the store ends sane, then delete the viewer via owner.
  await localAccounts.setDisabled(a1.id, false);
  r = mockRes();
  await auth.deleteAccountApi(ownerReq({}, { id: String(apiUser.id) }), r);
  check('deleteAccountApi: owner deletes non-admin ok', r.jsonData?.ok === true && (await localAccounts.findById(apiUser.id)) === null);
  // DB-down path.
  dbEnabled = false;
  r = mockRes();
  await auth.createAccountApi(ownerReq({ username: 'DownDb', password: 'DownDbPass1', role: 'viewer' }), r);
  check('createAccountApi: DB down -> 503', r.statusCode === 503);
  dbEnabled = true;

  console.log('== source + template checks ==');
  const dashSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.js'), 'utf8');
  check('no POST/DELETE staff route still uses plain requireStaff', !/app\.(post|delete)\([^)]*requireStaff,/.test(dashSrc));
  check('GET /staff/accounts gated by requireAdmin', dashSrc.includes("app.get('/staff/accounts', requireAdmin"));
  check('POST /login/local wired', dashSrc.includes("app.post('/login/local', handleLocalLogin)"));
  check('GET /login/discord exists', dashSrc.includes("app.get('/login/discord'"));
  check('requireOwner in dashboardAuth ignores local accounts', (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'dashboardAuth.js'), 'utf8');
    const m = src.match(/async function requireOwner[\s\S]*?\n}/);
    return m && m[0].includes('isOwner') && !m[0].includes('localAccount');
  })());
  check('migration ensures dashboard_accounts table', fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'database.js'), 'utf8').includes('DASHBOARD_ACCOUNTS_CREATE'));
  check('schema.sql has dashboard_accounts', fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8').includes('CREATE TABLE IF NOT EXISTS dashboard_accounts'));
  const ejs = require('ejs');
  const render = (f, data) => ejs.render(fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'views', f), 'utf8'), data, { filename: path.join(__dirname, '..', 'dashboard', 'views', f) });
  const loginHtml = render('login.ejs', { error: null, username: '' });
  check('login page has Discord button + local form', loginHtml.includes('/login/discord') && loginHtml.includes('/login/local') && loginHtml.includes('name="password"'));
  const staffHtml = render('staff.ejs', { section: 'accounts', saved: false, isStaff: true, inviteUrl: '', localAccount: { username: 'ace', role: 'admin' }, canManageAccounts: true, data: { accounts: [{ id: 1, username: 'mod1', role: 'staff', disabled: 0, last_login_at: null, created_by: 'owner' }], selfId: 2 } });
  check('staff accounts section renders', staffHtml.includes('Dashboard accounts') && staffHtml.includes('mod1') && staffHtml.includes('add-account-form'));
  const headerHtml = render('partials/header.ejs', { user: null, isStaff: true, localAccount: { username: 'mod1', role: 'staff' }, canManageAccounts: false });
  check('header shows local username + role', headerHtml.includes('mod1') && headerHtml.includes('staff'));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failures:', failures.join(', ')); process.exit(1); }
})().catch((err) => { console.error('VERIFY CRASH:', err); process.exit(1); });

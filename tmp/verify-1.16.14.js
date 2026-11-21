// Verify 1.16.14: Express 4.22.3 → 5.3.0 — full route/form/error test pass.
// The REAL Express 5 app (src/dashboard.js) boots on a test port with a
// mocked config, an in-memory fake database, and a stubbed Discord API
// (axios), then every registered route is exercised over real HTTP with
// real login flows (local admin + stubbed Discord OAuth). The session
// store is stubbed to MemoryStore — the real code's own fallback when
// MySQL is unavailable — because express-mysql-session's onReady() never
// settles with no MySQL server at all and the first request would hang
// forever; the express-session middleware itself still runs for real.
// No live bot, no live Discord, no live MySQL, nothing written to config.json.
// Breaking changes checked from the OFFICIAL migration guide
// (expressjs.com/en/guide/migrating-5.html) and the installed package:
// Express 5 removes app.del(), req.param(), res.json(obj,status),
// res.send(obj,status), res.send(status), res.redirect(url,status),
// res.redirect('back'), res.sendfile(), the singular
// req.acceptsCharset/Encoding/Language(), express.static.mime, the
// hidden/from options, and the app.param(fn)/router.param(fn) signatures;
// path-to-regexp v8 requires named wildcards (/*splat) and braces for
// optional segments; urlencoded() defaults extended:false; the query parser
// defaults to "simple"; req.body is undefined when unparsed; async handler
// rejections go to the error handler; app.listen passes listen errors to
// its callback. Greps found ZERO removed-API hits in the codebase, no
// wildcard/?/regexp route paths, and all req.query reads are flat keys.
// The three code changes this release: (1) app.set('query parser',
// 'extended') pins the v4 behavior; (2) the error handler returns early
// when headers are already sent (v5 now forwards async rejections there);
// (3) the app.listen callback checks its error argument (v5 passes listen
// errors to the callback instead of throwing).
'use strict';

// The sandbox config.json holds placeholder credentials — the dashboard
// itself sets ALLOW_PLACEHOLDER_CONFIG=1, and this script replaces the
// config module entirely with fake non-placeholder values before the
// dashboard loads, so no real credential is ever read or used.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// --- Test harness (same shape as tmp/verify-1.16.13.js) ----------------------
let passed = 0;
let failed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

function src(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function installedVersion(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
}

// --- Test constants (all fake; nothing here is a real credential) ------------
const TEST_PORT = 3101;
const OWNER_ID = '999999999999999999';
const GUILD_ID = '1571439343976058970';
const CLIENT_ID = '123456789012345678';

// --- Fake config (replaces src/utils/config entirely) ------------------------
// Values are invented test strings, never read from config.json.
const fakeConfig = {
  token: 'FAKE_TEST_BOT_TOKEN_0123456789abcdef0123456789abcdef',
  clientId: CLIENT_ID,
  ownerId: OWNER_ID,
  setupComplete: true,
  staffUserIds: [],
  embedColor: '#5865F2',
  music: { maxQueueSize: 25 },
  presence: { activities: [] },
  dashboard: {
    port: TEST_PORT,
    redirectUri: `http://localhost:${TEST_PORT}/callback`,
    sessionSecret: 'test-session-secret-that-is-long-enough-0123456789abcdef',
    clientSecret: 'fake-test-client-secret',
    invitePermissions: '8',
    publicUrl: '',
  },
  database: { host: '127.0.0.1', port: 3306, user: 'test', password: 'test', database: 'test' },
  backups: { time: '03:00', retentionDays: 30 },
  streams: { twitch: {}, youtube: {} },
  steam: {},
};

// --- Fake database (in-memory; dashboard_accounts + staff_audit reuse the
// 1.16.6 fake's logic; everything else gets pattern-based defaults) ---------
const store = { accounts: [], audit: [], nextId: 1 };
let dbEnabled = true;
const fakeDb = {
  isEnabled: () => dbEnabled,
  initDatabase: async () => {},
  closePool: async () => {},
  logCommand: async () => {},
  withTransaction: async (fn) => fn(fakeDb),
  getGlobalStats: async () => ({ total_commands: 0, successes: 0 }),
  getUserStats: async () => ({}),
  getTopUsers: async () => [],
  getTopCommands: async () => [],
  getGuildStats: async () => ({}),
  incrementWarns: async () => {},
  incrementSongsPlayed: async () => {},
  incrementMembersJoined: async () => {},
  queryDetailed: async (sql, params = []) => ({ rows: await fakeDb.query(sql, params), error: null }),
  query: async (sql, params = []) => {
    const s = String(sql);
    // dashboard_accounts (1.16.6 fake logic).
    if (s.includes('INSERT INTO staff_audit')) {
      store.audit.push({ actor_id: params[0], action: params[1], target_id: params[2], details: params[3] });
      return { insertId: store.audit.length, affectedRows: 1 };
    }
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
      return { insertId: row.id, affectedRows: 1 };
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
    // Forced-error sentinel: GET /staff/errors/999999 must 500 through the
    // real error handler, proving it works on Express 5.
    if (s.includes('FROM error_logs') && String(params[0]) === '999999') {
      throw new Error('boom-test');
    }
    // COUNT(*)/SUM(*) aggregates always return one zero row (handlers read
    // row[0]?.alias || 0).
    if (/COUNT\(\*\)|SUM\(/.test(s)) {
      return [{ n: 0, total: 0, total_commands: 0, successes: 0, count: 0, t: 0, f: 0, c: 0 }];
    }
    if (s.trimStart().startsWith('SELECT')) return [];
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s)) return { affectedRows: 1, insertId: store.nextId++ };
    return [];
  },
};

// --- Fake Discord API (axios stub) -------------------------------------------
// Covers every discordApi / direct-axios call the dashboard makes: the OAuth
// token exchange + refresh, /users/@me (Bot and Bearer), the guild list,
// guild/channels/roles, message sends, and DM creation. Anything else gets
// a 404-shaped axios error so handlers take their real error paths.
function discordRouter(method, url, data) {
  const u = String(url).replace(/^https:\/\/discord\.com\/api\/v10/, '');
  const m = method.toUpperCase();
  if (m === 'POST' && u === '/oauth2/token') {
    return { data: { access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', expires_in: 3600, token_type: 'Bearer', scope: 'identify guilds' } };
  }
  if (m === 'GET' && u === '/users/@me') {
    return { data: { id: OWNER_ID, username: 'TestOwner', avatar: null, discriminator: '0' } };
  }
  if (m === 'GET' && u === '/users/@me/guilds') {
    return { data: [{ id: GUILD_ID, name: 'Test Guild', icon: null, owner: true, permissions: '32' }] };
  }
  if (m === 'GET' && /^\/guilds\/\d+$/.test(u)) {
    return { data: { id: u.split('/')[2], name: 'Test Guild', icon: null } };
  }
  if (m === 'GET' && /^\/guilds\/\d+\/channels$/.test(u)) {
    return { data: [{ id: '111', name: 'general', type: 0 }, { id: '112', name: 'voice', type: 2 }] };
  }
  if (m === 'GET' && /^\/guilds\/\d+\/roles$/.test(u)) {
    return { data: [{ id: GUILD_ID, name: '@everyone' }, { id: '222', name: 'Admin' }] };
  }
  if (m === 'POST' && /^\/channels\/\d+\/messages$/.test(u)) {
    return { data: { id: '333' } };
  }
  if (m === 'PATCH' && /^\/channels\/\d+\/messages\/\d+$/.test(u)) {
    return { data: { id: u.split('/').pop() } };
  }
  if (m === 'POST' && u === '/users/@me/channels') {
    return { data: { id: '444' } };
  }
  if (m === 'GET' && /^https?:\/\//.test(String(url))) {
    return { data: Buffer.alloc(0) };
  }
  if (m === 'DELETE' || m === 'PATCH' || m === 'PUT' || m === 'POST') {
    return { data: {} };
  }
  const err = new Error(`Request failed with status code 404 (stub: ${m} ${u})`);
  err.response = { status: 404, data: { message: 'Not found (stub)' } };
  throw err;
}
function fakeAxiosRequest(method, url, data, config) {
  // The setup wizard calls axios.get with a full URL and a Bot token; the
  // user identity is the same fake bot user.
  if (String(url).startsWith('https://discord.com/api/v10/users/@me') && method.toUpperCase() === 'GET') {
    const auth = config?.headers?.Authorization || '';
    if (auth.startsWith('Bot ')) return Promise.resolve({ data: { id: CLIENT_ID, username: 'TestBot', avatar: null } });
  }
  return Promise.resolve(discordRouter(method, url, data));
}
const fakeAxiosInstance = {
  get: (url, config) => fakeAxiosRequest('GET', url, undefined, config),
  post: (url, data, config) => fakeAxiosRequest('POST', url, data, config),
  delete: (url, config) => fakeAxiosRequest('DELETE', url, undefined, config),
  patch: (url, data, config) => fakeAxiosRequest('PATCH', url, data, config),
  put: (url, data, config) => fakeAxiosRequest('PUT', url, data, config),
};
const fakeAxios = {
  ...fakeAxiosInstance,
  create: () => fakeAxiosInstance,
  request: (config) => fakeAxiosRequest(config?.method || 'GET', config?.url, config?.data, config),
};

// Install the stubs BEFORE requiring anything that loads them.
function installStub(resolvedPath, exportsObj) {
  require.cache[resolvedPath] = { id: resolvedPath, filename: resolvedPath, loaded: true, exports: exportsObj };
}
installStub(require.resolve('../src/utils/config'), fakeConfig);
installStub(require.resolve('../src/utils/database'), fakeDb);
installStub(require.resolve('axios'), fakeAxios);
// Session store: the real code falls back to MemoryStore when MySQL is
// unavailable — but express-mysql-session's onReady() never settles with
// no MySQL server at all, so the first request would hang forever on the
// store. Stub the store module to MemoryStore directly (the same fallback
// the real code takes); the express-session middleware itself still runs
// for real, and the fake DB still reports enabled for the route handlers.
const session = require('express-session');
installStub(require.resolve('../src/utils/sessionStore'), {
  createSessionStore: () => new session.MemoryStore(),
  SESSION_MAX_AGE_MS: 30 * 24 * 60 * 60_000,
});

// --- Boot the REAL dashboard --------------------------------------------------
const localAccounts = require('../src/utils/localAccounts');
require('../src/dashboard');

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${TEST_PORT}/version`, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
      if (r.status === 200) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error('dashboard did not come up on the test port');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// --- HTTP driver (manual redirects + cookie jars; the client IP is
// rotated via X-Forwarded-For so the 300-requests/15-min rate limiter
// never engages during the pass — the dashboard trusts one proxy hop,
// exactly as it does behind nginx in production. The destination stays
// 127.0.0.1: this sandbox only routes that loopback address, so rotating
// the destination IP (tried first) hangs every other request.) -----------
const CLIENT_IPS = ['10.1.0.1', '10.1.0.2', '10.1.0.3', '10.1.0.4'];
let ipCounter = 0;
function nextClientIp() {
  return CLIENT_IPS[(ipCounter++) % CLIENT_IPS.length];
}
function cookieHeader(jar) {
  return jar.length ? jar.join('; ') : undefined;
}
async function req(method, path, { jar = null, body = undefined, contentType = 'application/json' } = {}) {
  const headers = { 'X-Forwarded-For': nextClientIp() };
  const cookie = jar && cookieHeader(jar);
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    if (contentType === 'application/json') {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    } else if (contentType === 'application/x-www-form-urlencoded') {
      payload = new URLSearchParams(body).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (Buffer.isBuffer(body)) {
      payload = body;
      headers['Content-Type'] = contentType;
    }
  }
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`, {
    method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(10000),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), setCookie, text, json: () => { try { return JSON.parse(text); } catch { return null; } } };
}
function jarFrom(setCookieHeaders) {
  const jar = [];
  for (const c of setCookieHeaders || []) {
    const pair = c.split(';')[0].trim();
    if (pair) jar.push(pair);
  }
  return jar;
}

// --- Route enumeration (parsed from the real dashboard source) --------------
const PARAMS = {
  eventId: '1', channelId: '111', mappingId: '1', roleId: '222', trigger: 'test',
  faqId: '1', msgId: '1', backupId: '1', filename: 'test.sql.gz', playlistId: '1',
  menuId: '1', widgetId: '1', userId: OWNER_ID, countdownId: '1', emojiId: '1',
  formId: '1', appId: '1', streamerId: '1', panelId: '1', code: 'TESTCODE',
  confessionId: '1', tempId: '1', step: '1', module: 'general', messageId: '333',
  invites: '5',
};
function substitute(routePath) {
  return routePath.replace(/:([a-zA-Z]+)/g, (m, name) => {
    if (name === 'id') return routePath.includes('/guilds/') ? GUILD_ID : '1';
    return PARAMS[name] || '1';
  });
}
function enumerateRoutes() {
  const text = src('src/dashboard.js');
  const routes = [];
  // Registrations are single-line; capture the middleware names on the
  // line so the unauthenticated pass can predict each route's guard
  // (requireAuth/requireStaffWrite answer 401 for /api/*, the other
  // guards always redirect to /login).
  for (const line of text.split('\n')) {
    const m = /app\.(get|post|delete|patch|put|all)\(\s*['"]([^'"]+)['"]/.exec(line);
    if (!m) continue;
    const guards = [...line.matchAll(/require(Auth|GuildAccess|StaffWrite|Staff|Admin|Owner|SetupAccess)\b/g)].map((g) => 'require' + g[1]);
    routes.push({ method: m[1].toUpperCase(), path: m[2], guards });
  }
  return routes;
}

// Routes whose correct answer is a 404 (no such row in the fake DB), a
// redirect, or a 500 for an environmental reason — the generic pass
// asserts these exactly instead of "not 404".
const EXPECTED = {
  'GET /staff/errors/1': 404,
  'GET /staff/transcripts/1': 404,
  'GET /staff/transcripts/1/download': 404,
  'GET /staff/backups/download/test.sql.gz': 404,
  'GET /staff/errors/999999': 500,
  'GET /guilds/1571439343976058970': 302,
  'GET /setup': 302,
  'GET /invite': 302,
  'GET /callback': 302,
  'GET /logout': 302,
  // No such backup/flag rows in the fake DB: the handlers correctly 404.
  'POST /api/staff/serverbackups/1/restore': 404,
  'DELETE /api/staff/serverbackups/1': 404,
  'GET /staff/serverbackups/download/1': 404,
  'POST /api/staff/botflags/1/clear': 404,
  'POST /api/staff/botflags/1/kick': 404,
  'POST /api/staff/botflags/1/ban': 404,
  // mysqldump is not installed in this sandbox, so the backup-now handler
  // correctly reports the spawn failure as a 500 JSON error.
  'POST /api/staff/backup-now': 500,
  // No such resource rows in the fake DB: the handlers correctly 404 with
  // a "not found" message instead of crashing.
  'POST /api/guilds/1571439343976058970/events/1/cancel': 404,
  'POST /api/guilds/1571439343976058970/embeds/333/edit': 404,
  'POST /api/guilds/1571439343976058970/embeds/333/delete': 404,
  'DELETE /api/guilds/1571439343976058970/reaction-roles/1': 404,
  'DELETE /api/guilds/1571439343976058970/playlists/1': 404,
  'DELETE /api/guilds/1571439343976058970/rolemenus/1': 404,
  'POST /api/guilds/1571439343976058970/streamers/1/clip': 404,
  'POST /api/guilds/1571439343976058970/modmail/1/close': 404,
  'POST /api/guilds/1571439343976058970/temproles/1/remove': 404,
  'PATCH /api/guilds/1571439343976058970/streamers/1': 404,
  'POST /api/guilds/1571439343976058970/streamers/1/refresh': 404,
  'GET /api/guilds/1571439343976058970/streamers/1/preview': 404,
  'POST /api/guilds/1571439343976058970/ticket-panels/1/repost': 404,
  'DELETE /api/guilds/1571439343976058970/ticket-panels/1': 404,
  'DELETE /api/guilds/1571439343976058970/invite-roles/TESTCODE': 404,
  'DELETE /api/guilds/1571439343976058970/countdowns/1': 404,
};
// 1x1 transparent PNG (for the avatar-upload route, which needs real image bytes).
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function main() {
  await waitForServer();

  // --- Static checks ---------------------------------------------------------
  await check('package.json pins Express ^5.3.0 with 5.3.0 installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.dependencies.express, '^5.3.0');
    assert.strictEqual(installedVersion('express'), '5.3.0');
    assert.strictEqual(pkg.version, '1.16.14');
    assert.ok(src('CHANGELOG.md').includes('## [1.16.14]'), 'no 1.16.14 CHANGELOG entry');
  });

  await check('migration patterns are gone from the code', () => {
    const dash = src('src/dashboard.js');
    const auth = src('src/utils/dashboardAuth.js');
    const all = dash + auth + src('src/utils/localAccounts.js');
    const banned = [
      [/\.del\(/, 'app.del()'],
      [/req\.acceptsCharset\(/, 'req.acceptsCharset()'],
      [/req\.acceptsEncoding\(/, 'req.acceptsEncoding()'],
      [/req\.acceptsLanguage\(/, 'req.acceptsLanguage()'],
      [/req\.param\(/, 'req.param()'],
      [/res\.json\(\{[^}]*\},\s*\d/, 'res.json(obj, status)'],
      [/res\.send\(\{[^}]*\},\s*\d/, 'res.send(obj, status)'],
      [/res\.send\(\d+\)/, 'res.send(status)'],
      [/res\.redirect\([^)]*,\s*\d+\s*\)/, 'res.redirect(url, status)'],
      [/redirect\(['"]back['"]\)/, "res.redirect('back')"],
      [/res\.sendfile\(/i, 'res.sendfile()'],
      [/express\.static\.mime/, 'express.static.mime'],
      [/hidden:\s*true/, 'sendFile/static hidden option'],
      [/from:\s*['"]/, 'sendFile/static from option'],
      [/\.param\(\[/, 'router.param(array)'],
      [/\.param\(['"]:/, "app.param(':name')"],
    ];
    for (const [re, label] of banned) assert.ok(!re.test(all), `${label} still present`);
    // Wildcards and optional segments in route paths (path-to-regexp v8).
    const routes = enumerateRoutes();
    for (const r of routes) {
      assert.ok(!r.path.includes('*'), `wildcard in route ${r.method} ${r.path}`);
      assert.ok(!/\?/.test(r.path), `optional segment in route ${r.method} ${r.path}`);
    }
    assert.strictEqual(routes.length, 156, `expected 156 routes, found ${routes.length}`);
  });

  await check('the three Express 5 code changes are present', () => {
    const dash = src('src/dashboard.js');
    assert.ok(dash.includes("app.set('query parser', 'extended')"), 'query parser not pinned to extended');
    assert.ok(dash.includes('if (res.headersSent) return next(err);'), 'error handler has no headersSent guard');
    assert.ok(dash.includes('app.listen(PORT, (err) => {'), 'listen callback does not take err');
    assert.ok(dash.includes('if (err) throw err;'), 'listen callback does not throw err');
  });

  // --- Login flows -----------------------------------------------------------
  let localJar = null;
  let discordJar = null;
  await check('local admin login works over a urlencoded form (Express 5 body parsing)', async () => {
    await localAccounts.createAccount({ username: 'testadmin', password: 'TestPass123!', role: 'admin', createdBy: 'test' });
    const bad = await req('POST', '/login/local', { body: { username: 'testadmin', password: 'wrong' }, contentType: 'application/x-www-form-urlencoded' });
    assert.strictEqual(bad.status, 401, `wrong password should 401, got ${bad.status}`);
    const ok = await req('POST', '/login/local', { body: { username: 'testadmin', password: 'TestPass123!' }, contentType: 'application/x-www-form-urlencoded' });
    assert.strictEqual(ok.status, 302, `good login should 302, got ${ok.status}`);
    assert.strictEqual(ok.location, '/staff');
    localJar = jarFrom(ok.setCookie);
    assert.ok(localJar.length > 0, 'no session cookie set by login');
  });

  await check('Discord OAuth callback works (stubbed) and lands on /servers', async () => {
    const r = await req('GET', '/callback?code=fakecode');
    assert.strictEqual(r.status, 302, `callback should 302, got ${r.status}`);
    assert.strictEqual(r.location, '/servers');
    discordJar = jarFrom(r.setCookie);
    assert.ok(discordJar.length > 0, 'no session cookie set by callback');
    const servers = await req('GET', '/servers', { jar: discordJar });
    assert.strictEqual(servers.status, 200, `GET /servers should 200, got ${servers.status}`);
    assert.ok(servers.text.includes('Test Guild'), '/servers does not list the stubbed guild');
  });

  // --- Exact-status spot checks ----------------------------------------------
  await check('public routes answer correctly', async () => {
    const version = await req('GET', '/version');
    assert.strictEqual(version.status, 200);
    // /version renders HTML (it is a page, not JSON) — the version string
    // must appear in the rendered page.
    assert.ok(version.text.includes('1.16.14'), '/version page does not show 1.16.14');
    const login = await req('GET', '/login');
    assert.strictEqual(login.status, 200);
    const docs = await req('GET', '/docs');
    assert.strictEqual(docs.status, 200);
    const invite = await req('GET', '/invite');
    assert.strictEqual(invite.status, 302);
    assert.ok(invite.location.startsWith('https://discord.com/oauth2/authorize'), `invite redirect went to ${invite.location}`);
    const home = await req('GET', '/');
    assert.ok([200, 302].includes(home.status), `GET / should 200/302, got ${home.status}`);
  });

  await check('query parser pin: nested query params do not break filtering', async () => {
    const r = await req('GET', '/staff/errors?level=error&command=test', { jar: localJar });
    assert.strictEqual(r.status, 200, `filtered errors page should 200, got ${r.status}`);
    const nested = await req('GET', '/staff/errors?filter[level]=error', { jar: localJar });
    assert.strictEqual(nested.status, 200, `nested query should not crash the page, got ${nested.status}`);
  });

  await check('backup-now 500 names the missing mysqldump (sandbox has none)', async () => {
    const r = await req('POST', '/api/staff/backup-now', { jar: localJar, body: {} });
    assert.strictEqual(r.status, 500, `backup-now should 500 in this sandbox, got ${r.status}`);
    assert.ok((r.json()?.error || '').includes('mysqldump'), `backup-now error is not the mysqldump one: ${r.text.slice(0, 120)}`);
  });

  await check('unknown path gets the Express default 404', async () => {
    const r = await req('GET', '/definitely-not-a-route');
    assert.strictEqual(r.status, 404);
  });

  await check('error handler returns 500 for a throwing route', async () => {
    const r = await req('GET', '/staff/errors/999999', { jar: localJar });
    assert.strictEqual(r.status, 500, `forced-error route should 500, got ${r.status}`);
    assert.ok(r.text.includes('Something went wrong'), 'error page body is not the handler text');
  });

  // --- Full route pass --------------------------------------------------------
  const routes = enumerateRoutes();
  // GET /logout destroys the session it is called with, so it runs LAST —
  // otherwise every guild route after it in the pass would see a dead
  // Discord session and 302 instead of exercising its handler.
  const orderedRoutes = [
    ...routes.filter((r) => !(r.method === 'GET' && r.path === '/logout')),
    ...routes.filter((r) => r.method === 'GET' && r.path === '/logout'),
  ];
  await check(`authenticated pass: all ${routes.length} routes answer (no 404/500 unless expected)`, async () => {
    const problems = [];
    for (const r of orderedRoutes) {
      const url = substitute(r.path);
      const jar = r.path.startsWith('/api/staff') || r.path.startsWith('/staff') ? localJar : discordJar;
      // The avatar upload needs real image bytes (express.raw image/*).
      const isAvatar = r.path.endsWith('/identity/avatar') && r.method === 'POST';
      const res = isAvatar
        ? await req('POST', url, { jar, body: PNG_1X1, contentType: 'image/png' })
        : await req(r.method, url, { jar, body: (r.method === 'POST' || r.method === 'PATCH' || r.method === 'DELETE') ? {} : undefined });
      const key = `${r.method} ${url}`;
      const expected = EXPECTED[key];
      if (expected !== undefined) {
        if (res.status !== expected) problems.push(`${key}: expected ${expected}, got ${res.status}`);
      } else if (res.status === 404 || res.status === 500) {
        problems.push(`${key}: got ${res.status} — ${res.text.slice(0, 120).replace(/\s+/g, ' ')}`);
      }
    }
    assert.strictEqual(problems.length, 0, `${problems.length} route(s) failed:\n  - ${problems.join('\n  - ')}`);
  });

  await check(`unauthenticated pass: all ${routes.length} routes enforce auth`, async () => {
    const problems = [];
    for (const r of routes) {
      const url = substitute(r.path);
      const res = await req(r.method, url, { body: (r.method === 'POST' || r.method === 'PATCH' || r.method === 'DELETE') ? {} : undefined });
      const key = `${r.method} ${url}`;
      // The login endpoint itself answers 401 for bad credentials.
      if (r.method === 'POST' && r.path === '/login/local') {
        if (res.status !== 401) problems.push(`${key}: expected 401, got ${res.status}`);
        continue;
      }
      if (r.guards.length === 0) {
        // Public route: it must answer, not 404/500.
        if (res.status === 404 || res.status === 500) problems.push(`${key}: public route got ${res.status}`);
      } else if (r.guards.includes('requireStaffWrite') || r.guards.includes('requireAuth')) {
        // These two guards answer 401 JSON for /api/* and redirect pages.
        if (r.path.startsWith('/api/')) {
          if (res.status !== 401) problems.push(`${key}: expected 401, got ${res.status}`);
        } else if (res.status !== 302) {
          problems.push(`${key}: expected 302 to /login, got ${res.status}`);
        }
      } else {
        // requireStaff / requireAdmin / requireOwner / requireSetupAccess
        // always redirect to /login, even for /api/* — that is the real
        // behavior (only requireAuth/requireStaffWrite have the 401 branch).
        if (res.status !== 302) problems.push(`${key}: expected 302 to /login, got ${res.status}`);
      }
    }
    assert.strictEqual(problems.length, 0, `${problems.length} route(s) failed:\n  - ${problems.join('\n  - ')}`);
  });

  await check('staff routes work for the local admin; guild routes stay Discord-only', async () => {
    // Fresh logins: the authenticated pass ends with GET /logout, which
    // destroys the Discord session it ran with.
    const localLogin = await req('POST', '/login/local', { body: { username: 'testadmin', password: 'TestPass123!' }, contentType: 'application/x-www-form-urlencoded' });
    assert.strictEqual(localLogin.status, 302, `re-login should 302, got ${localLogin.status}`);
    localJar = jarFrom(localLogin.setCookie);
    const discordLogin = await req('GET', '/callback?code=fakecode2');
    assert.strictEqual(discordLogin.status, 302, `re-callback should 302, got ${discordLogin.status}`);
    discordJar = jarFrom(discordLogin.setCookie);
    // Local admin can read staff pages but must NOT get guild access.
    const staff = await req('GET', '/staff', { jar: localJar });
    assert.strictEqual(staff.status, 200, `local admin GET /staff should 200, got ${staff.status}`);
    const guildAsLocal = await req('GET', `/guilds/${GUILD_ID}/general`, { jar: localJar });
    assert.ok([302, 401, 403].includes(guildAsLocal.status), `local account on a guild page should be denied, got ${guildAsLocal.status}`);
    // Discord owner can read guild pages.
    const guild = await req('GET', `/guilds/${GUILD_ID}/general`, { jar: discordJar });
    assert.strictEqual(guild.status, 200, `Discord owner GET guild page should 200, got ${guild.status}`);
    // Discord owner is not the local admin: owner-only staff routes 403 for
    // a local admin but the Discord owner passes requireOwner.
    const ownerPage = await req('GET', '/staff/manage', { jar: discordJar });
    assert.strictEqual(ownerPage.status, 200, `Discord owner GET /staff/manage should 200, got ${ownerPage.status}`);
    const ownerPageLocal = await req('GET', '/staff/manage', { jar: localJar });
    assert.strictEqual(ownerPageLocal.status, 403, `local admin GET /staff/manage should 403, got ${ownerPageLocal.status}`);
  });

  console.log(`\n${passed} passed, ${failed} failed${failed ? ` (${failures.join(', ')})` : ''}`);
  process.exitCode = failed ? 1 : 0;
  // The dashboard keeps listening on the test port; exit explicitly.
  process.exit(process.exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

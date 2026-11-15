// Verification for 1.15.4 — persistent dashboard login sessions.
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-session-store.js
// Exits non-zero if any check fails.
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

function expiresInDays(cookieStr) {
  // express-session serializes the cookie with an Expires date (not Max-Age).
  const m = /Expires=([^;]+)/.exec(cookieStr || '');
  if (!m) return null;
  return (new Date(m[1]).getTime() - Date.now()) / 86400000;
}
function cookieIs30Day(cookieStr) {
  const d = expiresInDays(cookieStr);
  return d !== null && d > 29 && d < 31;
}

function seedCache(resolvedPath, exportsObj) {
  require.cache[resolvedPath] = {
    id: resolvedPath, filename: resolvedPath, loaded: true, exports: exportsObj,
  };
}
function unseed(resolvedPath) { delete require.cache[resolvedPath]; }

const sessionStorePath = path.join(ROOT, 'src/utils/sessionStore.js');
const dbPath = path.join(ROOT, 'src/utils/database.js');
const configPath = path.join(ROOT, 'src/utils/config.js');
const session = require('express-session');

// --- Part 1: delegate unit tests -------------------------------------------
async function storeGet(store, sid) {
  return new Promise((resolve, reject) => store.get(sid, (err, sess) => (err ? reject(err) : resolve(sess))));
}
async function storeSet(store, sid, sess) {
  return new Promise((resolve, reject) => store.set(sid, sess, (err) => (err ? reject(err) : resolve())));
}
async function storeDestroy(store, sid) {
  return new Promise((resolve, reject) => store.destroy(sid, (err) => (err ? reject(err) : resolve())));
}

async function part1() {
  console.log('--- Part 1: session store delegate ---');
  const { SESSION_MAX_AGE_MS } = require(sessionStorePath);
  check('SESSION_MAX_AGE_MS is 30 days', SESSION_MAX_AGE_MS === 30 * 24 * 60 * 60_000, `${SESSION_MAX_AGE_MS}ms`);

  // Variant A: DB disabled -> MemoryStore fallback, sessions work.
  let warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    seedCache(dbPath, { isEnabled: () => false, initDatabase: async () => false, query: async () => [] });
    seedCache(configPath, { database: {} });
    delete require.cache[sessionStorePath];
    const { createSessionStore } = require(sessionStorePath);
    const store = createSessionStore();
    check('delegate is an express-session Store', store instanceof session.Store);
    await storeSet(store, 'sid-a', { cookie: { maxAge: 1000 }, user: { id: '1' } });
    const got = await storeGet(store, 'sid-a');
    check('MemoryStore fallback: set/get round-trip', got && got.user && got.user.id === '1');
    await storeDestroy(store, 'sid-a');
    check('MemoryStore fallback: destroy removes session', (await storeGet(store, 'sid-a')) == null);
    check('MemoryStore fallback: warning logged', warns.some((w) => w.includes('MemoryStore')));
  } finally {
    console.warn = origWarn;
    unseed(dbPath); unseed(configPath);
  }

  // Variant B: DB enabled but MySQL unreachable -> MySQLStore init fails -> MemoryStore fallback.
  warns = [];
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    seedCache(dbPath, { isEnabled: () => true, initDatabase: async () => true, query: async () => [] });
    seedCache(configPath, { database: { host: '127.0.0.1', port: 33999, user: 'u', password: 'p', database: 'd' } });
    delete require.cache[sessionStorePath];
    const { createSessionStore } = require(sessionStorePath);
    const store = createSessionStore();
    const t0 = Date.now();
    await storeSet(store, 'sid-b', { cookie: { maxAge: 1000 }, user: { id: '2' } });
    const gotB = await storeGet(store, 'sid-b');
    check('unreachable MySQL: falls back, set/get still works', gotB && gotB.user && gotB.user.id === '2', `${Date.now() - t0}ms`);
    check('unreachable MySQL: fallback warning logged', warns.some((w) => w.includes('falling back to MemoryStore')));
  } finally {
    console.warn = origWarn;
    unseed(dbPath); unseed(configPath);
  }

  // Variant C: a fresh delegate instance loses MemoryStore sessions (restart behavior in fallback mode).
  try {
    seedCache(dbPath, { isEnabled: () => false, initDatabase: async () => false, query: async () => [] });
    seedCache(configPath, { database: {} });
    delete require.cache[sessionStorePath];
    const { createSessionStore } = require(sessionStorePath);
    const s1 = createSessionStore();
    await storeSet(s1, 'sid-c', { cookie: { maxAge: 1000 }, user: { id: '3' } });
    const s2 = createSessionStore(); // simulates a dashboard restart (new process)
    check('fresh store instance does not see old MemoryStore session (expected in fallback mode)', (await storeGet(s2, 'sid-c')) == null);
  } finally {
    unseed(dbPath); unseed(configPath);
  }

  // Static source assertions (dashboard.js wiring).
  const src = fs.readFileSync(path.join(ROOT, 'src/dashboard.js'), 'utf8');
  check('dashboard: rolling: true', /rolling:\s*true/.test(src));
  check('dashboard: store: createSessionStore()', /store:\s*createSessionStore\(\)/.test(src));
  check('dashboard: cookie maxAge is SESSION_MAX_AGE_MS', /maxAge:\s*SESSION_MAX_AGE_MS/.test(src));
  check('dashboard: cookie keeps httpOnly + secure auto', /httpOnly:\s*true/.test(src) && /secure:\s*'auto'/.test(src));
  check('dashboard: OAuth scope is exactly identify guilds (no offline)', /scope:\s*'identify guilds'/.test(src) && !/scope:\s*'[^']*offline[^']*'/.test(src));
  check('dashboard: callback stores refreshToken', /req\.session\.refreshToken\s*=\s*tokenRes\.data\.refresh_token/.test(src));
  check('dashboard: callback stores tokenExpiresAt', /req\.session\.tokenExpiresAt\s*=/.test(src));
  check('dashboard: refresh uses grant_type refresh_token', /grant_type:\s*'refresh_token'/.test(src));
  check('dashboard: expired token keeps user, throws authExpired', /expired\.authExpired\s*=\s*true/.test(src));
}

// --- Part 2: end-to-end boot test of the real dashboard ---------------------
// Stub config + database + axios in require.cache, then require the real
// dashboard.js and drive /login -> /callback -> /servers over HTTP.
async function part2() {
  console.log('--- Part 2: dashboard boot + OAuth refresh flow ---');
  const PORT = 3101;
  const axiosPath = require.resolve('axios', { paths: [ROOT] });

  const stubState = { guildsMode: 'fail-once', refreshOk: true, guildsCalls: 0 };
  const apiStub = {
    get: async (url) => {
      if (url === '/users/@me') return { data: { id: '123', username: 'tester', global_name: 'Tester' } };
      if (url === '/users/@me/guilds') {
        stubState.guildsCalls++;
        if (stubState.guildsMode === 'unauthorized') {
          const e = new Error('401'); e.response = { status: 401 }; throw e;
        }
        if (stubState.guildsMode === 'fail-once' && stubState.guildsCalls === 1) {
          const e = new Error('401'); e.response = { status: 401 }; throw e;
        }
        return { data: [{ id: '1', name: 'Test Server', permissions: '32', icon: null }] };
      }
      if (url.startsWith('/guilds/')) return { data: {} };
      const e = new Error(`unexpected GET ${url}`); e.response = { status: 404 }; throw e;
    },
  };
  const axiosStub = {
    create: () => apiStub,
    get: apiStub.get,
    post: async (url, params) => {
      const body = Object.fromEntries(new URLSearchParams(params));
      if (url.includes('/oauth2/token') && body.grant_type === 'authorization_code') {
        return { data: { access_token: 'at1', refresh_token: 'rt1', expires_in: 604800, token_type: 'Bearer' } };
      }
      if (url.includes('/oauth2/token') && body.grant_type === 'refresh_token') {
        if (!stubState.refreshOk || body.refresh_token !== 'rt1') {
          const e = new Error('invalid_grant'); e.response = { status: 400, data: { error: 'invalid_grant' } }; throw e;
        }
        return { data: { access_token: 'at2', refresh_token: 'rt2', expires_in: 604800, token_type: 'Bearer' } };
      }
      throw new Error(`unexpected POST ${url}`);
    },
  };
  seedCache(axiosPath, axiosStub);
  seedCache(configPath, {
    token: 'bot-token', clientId: '111', ownerId: '999', setupComplete: true,
    staffUserIds: [],
    database: {},
    dashboard: {
      port: PORT, redirectUri: `http://localhost:${PORT}/callback`,
      clientSecret: 'secret', sessionSecret: 'test-secret-1234567890',
    },
  });
  seedCache(dbPath, { isEnabled: () => false, initDatabase: async () => false, query: async () => [], logCommand: () => {}, closePool: async () => {} });

  require(path.join(ROOT, 'src/dashboard.js'));
  const base = `http://127.0.0.1:${PORT}`;
  // Wait for the server to listen.
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/version`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  const noRedirect = { redirect: 'manual' };
  // 1. /login redirects to Discord with exactly the `identify guilds` scope
  // (Discord has no `offline` scope — 1.15.4 adding it broke login).
  const loginRes = await fetch(`${base}/login`, noRedirect);
  const loginLoc = loginRes.headers.get('location') || '';
  check('GET /login redirects to Discord authorize', loginRes.status === 302 && loginLoc.includes('discord.com/oauth2/authorize'));
  check('login scope is exactly identify guilds, no offline', new URL(loginLoc).searchParams.get('scope') === 'identify guilds' && !loginLoc.includes('offline'));

  // 2. /callback exchanges the code, sets a 30-day cookie, redirects to /servers.
  const cbRes = await fetch(`${base}/callback?code=fakecode`, noRedirect);
  const cbCookies = cbRes.headers.getSetCookie();
  const sessionCookie = (cbCookies.find((c) => c.startsWith('connect.sid=')) || '').split(';')[0];
  check('GET /callback redirects to /servers', cbRes.status === 302 && cbRes.headers.get('location') === '/servers');
  check('callback sets session cookie', Boolean(sessionCookie));
  check('session cookie expires in ~30 days', cookieIs30Day(cbCookies.find((c) => c.startsWith('connect.sid=')) || ''), cbCookies.join(' | '));
  check('session cookie is HttpOnly', cbCookies.some((c) => c.includes('HttpOnly')));

  // 3. /servers: first guilds call 401s -> refresh -> retry -> renders the guild.
  const srvRes = await fetch(`${base}/servers`, { headers: { Cookie: sessionCookie } });
  const srvHtml = await srvRes.text();
  check('GET /servers 200 after token refresh', srvRes.status === 200, `status ${srvRes.status}`);
  check('server list renders guild after refresh', srvHtml.includes('Test Server'));
  check('refresh was used (guilds called twice: 401 then retry)', stubState.guildsCalls === 2, `${stubState.guildsCalls} calls`);
  const srvCookies = srvRes.headers.getSetCookie();
  const refreshedCookie = srvCookies.find((c) => c.startsWith('connect.sid='));
  check('rolling: /servers re-issues the session cookie', Boolean(refreshedCookie));
  check('rolling: refreshed cookie expires in ~30 days', cookieIs30Day(refreshedCookie || ''), refreshedCookie || '(none)');

  // 4. Refresh failure: expired notice, still logged in (no redirect to /login).
  stubState.guildsMode = 'unauthorized';
  stubState.refreshOk = false;
  const expRes = await fetch(`${base}/servers`, { headers: { Cookie: sessionCookie } });
  const expHtml = await expRes.text();
  check('expired token: /servers renders notice, not a login redirect', expRes.status === 200 && expHtml.includes('Your Discord connection expired'));
  const homeRes = await fetch(`${base}/`, { headers: { Cookie: sessionCookie }, redirect: 'manual' });
  check('expired token: user is still logged in (GET / redirects to /servers, not /login)', homeRes.status === 302 && homeRes.headers.get('location') === '/servers');
}

(async () => {
  try {
    await part1();
    await part2();
  } catch (err) {
    console.error('ERROR', err);
    failures++;
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();

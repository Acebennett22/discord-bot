// Verify 1.16.19: automod page 500 fix — mysql2 returns JSON columns parsed.
// The REAL dashboard (src/dashboard.js) boots on a test port with a mocked
// config, an in-memory fake database, and a stubbed Discord API (axios).
// Checks: the 1.16.18 responsive layout + module picker and the 1.16.17
// Temp VC hub UI are intact, every module renders, no route or command
// changed, and the Automod page renders for a fresh guild (no saved row)
// and for guilds with a saved automod_settings row — as mysql2 returns it
// (JSON columns parsed into arrays), as JSON strings, and as NULL — with
// the saved banned words and exempt role/channel actually displayed.
// No live bot, no live Discord, no live MySQL, nothing written to
// config.json.
'use strict';

process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

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

// --- Test constants (all fake; nothing here is a real credential) ------------
const TEST_PORT = 3105;
const OWNER_ID = '999999999999999999';
const GUILD_ID = '1571439343976058970';
const CLIENT_ID = '123456789012345678';
const GUILD_AUTOMOD_ARRAYS = '692618749890527323'; // Angels Of Mist (live crash guild)
const GUILD_AUTOMOD_STRINGS = '333333333333333333';
const GUILD_AUTOMOD_NULLS = '444444444444444444';
const CAT_GAMING = '100000000000000001';
const CAT_CHILL = '100000000000000002';
const CAT_FORBIDDEN = '100000000000000003';
const LEGACY_HUB = '100000000000000011';
const HUB_LIVE = '100000000000000012';

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

// --- Fake database (in-memory) -----------------------------------------------
// Hubs + temp channels + guild settings rows are real in-memory state, so
// the migration, cap, register/unregister, and voice-spawn paths are
// tested against state that changes as the checks run.
const store = {
  accounts: [], audit: [], nextId: 1, errorLogs: [],
  hubs: [], tempChannels: [], guildSettings: {},
  channels: [
    { id: '111', name: 'general', type: 0 },
    { id: '112', name: 'voice', type: 2 },
    { id: CAT_GAMING, name: 'Gaming', type: 4 },
    { id: CAT_CHILL, name: 'Chill', type: 4 },
    { id: CAT_FORBIDDEN, name: 'Forbidden', type: 4 },
    { id: LEGACY_HUB, name: '➕ Join to Create', type: 2, parent_id: CAT_GAMING },
    { id: HUB_LIVE, name: '➕ Gaming Hub', type: 2, parent_id: CAT_GAMING },
  ],
  deletedChannels: [],
  nextChannelSeq: 1,
};
let dbEnabled = true;
let failNextHubInsert = false;
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
  queryDetailed: async (sql, params = []) => {
    try {
      return { rows: await fakeDb.query(sql, params), error: null };
    } catch (err) {
      return { rows: null, error: { code: err.code || null, errno: err.errno || null, sqlMessage: err.sqlMessage || null, message: err.message || String(err) } };
    }
  },
  query: async (sql, params = []) => {
    const s = String(sql);
    // staff_audit.
    if (s.includes('INSERT INTO staff_audit')) {
      store.audit.push({ actor_id: params[0], action: params[1], target_id: params[2], details: params[3] });
      return { insertId: store.audit.length, affectedRows: 1 };
    }
    // dashboard_accounts (1.16.6 fake logic, copied from verify-1.16.15.js).
    if (s.startsWith('DELETE FROM dashboard_accounts')) {
      const i = store.accounts.findIndex((a) => String(a.id) === String(params[0]));
      if (i >= 0) store.accounts.splice(i, 1);
      return { affectedRows: i >= 0 ? 1 : 0 };
    }
    if (s.trimStart().startsWith('SELECT') && s.includes('FROM dashboard_accounts')) {
      if (s.includes('COUNT(*) AS n')) return [{ n: store.accounts.filter((a) => a.role === 'admin' && !a.disabled).length }];
      if (s.includes('LOWER(username)')) {
        const row = store.accounts.find((a) => a.username.toLowerCase() === String(params[0]).toLowerCase());
        return row ? [row] : [];
      }
      if (s.includes('WHERE id = ?')) {
        const row = store.accounts.find((a) => String(a.id) === String(params[0]));
        return row ? [row] : [];
      }
      if (s.includes('ORDER BY username')) return [...store.accounts].sort((a, b) => a.username.localeCompare(b.username));
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
    // guild_settings: getGuildSettings reads one row by guild_id;
    // setGuildSettings upserts the full row (columns in COLUMNS order).
    if (s.includes('FROM guild_settings') && s.trimStart().startsWith('SELECT')) {
      const row = store.guildSettings[String(params[0])];
      return row ? [row] : [];
    }
    if (s.startsWith('INSERT INTO guild_settings')) {
      const cols = s.slice(s.indexOf('(') + 1, s.indexOf(')')).split(',').map((c) => c.trim());
      const row = {};
      cols.forEach((c, i) => { row[c] = params[i] === undefined ? null : params[i]; });
      store.guildSettings[String(params[0])] = row;
      return { affectedRows: 1, insertId: store.nextId++ };
    }
    // tempvc_hubs (1.16.17). Match on the table name, not 'FROM ...':
    // INSERT INTO has no FROM, so a FROM-only match let inserts fall
    // through to the generic handler (and consume nextId).
    if (s.includes('tempvc_hubs')) {
      if (s.startsWith('INSERT IGNORE INTO tempvc_hubs')) {
        const [guildId, createChannelId, categoryId] = params;
        if (!store.hubs.some((h) => h.guild_id === guildId && h.create_channel_id === createChannelId)) {
          store.hubs.push({ guild_id: guildId, create_channel_id: createChannelId, category_id: categoryId || null, created_by_bot: 0, created_at: new Date().toISOString() });
        }
        return { affectedRows: 1 };
      }
      if (s.startsWith('INSERT INTO tempvc_hubs')) {
        if (failNextHubInsert) {
          failNextHubInsert = false;
          const err = new Error("Duplicate entry 'x' for key 'tempvc_hubs.PRIMARY'");
          err.code = 'ER_DUP_ENTRY';
          err.errno = 1062;
          err.sqlMessage = "Duplicate entry 'x' for key 'tempvc_hubs.PRIMARY'";
          throw err;
        }
        const [guildId, createChannelId, categoryId, createdByBot] = params;
        const existing = store.hubs.find((h) => h.guild_id === guildId && h.create_channel_id === createChannelId);
        if (existing) {
          existing.category_id = categoryId || null;
          existing.created_by_bot = createdByBot ? 1 : 0;
        } else {
          store.hubs.push({ guild_id: guildId, create_channel_id: createChannelId, category_id: categoryId || null, created_by_bot: createdByBot ? 1 : 0, created_at: new Date().toISOString() });
        }
        return { affectedRows: 1 };
      }
      if (s.startsWith('DELETE FROM tempvc_hubs')) {
        const before = store.hubs.length;
        store.hubs = store.hubs.filter((h) => !(h.guild_id === params[0] && h.create_channel_id === params[1]));
        return { affectedRows: before - store.hubs.length };
      }
      if (s.includes('AND create_channel_id = ?')) {
        return store.hubs.filter((h) => h.guild_id === params[0] && h.create_channel_id === params[1]);
      }
      return store.hubs.filter((h) => h.guild_id === params[0]);
    }
    // temp_channels. Same table-name match as tempvc_hubs (INSERT has no FROM).
    if (s.includes('temp_channels')) {
      if (s.startsWith('INSERT INTO temp_channels')) {
        const [guildId, channelId, ownerId] = params;
        const existing = store.tempChannels.find((t) => t.guild_id === guildId && t.channel_id === channelId);
        if (existing) existing.owner_id = ownerId;
        else store.tempChannels.push({ guild_id: guildId, channel_id: channelId, owner_id: ownerId });
        return { affectedRows: 1 };
      }
      if (s.startsWith('DELETE FROM temp_channels')) {
        const before = store.tempChannels.length;
        store.tempChannels = store.tempChannels.filter((t) => !(t.guild_id === params[0] && t.channel_id === params[1]));
        return { affectedRows: before - store.tempChannels.length };
      }
      return store.tempChannels.filter((t) => t.guild_id === params[0] && t.channel_id === params[1]);
    }
    // automod_settings (1.16.19): the live crash. mysql2 returns JSON
    // columns already parsed, so a saved row arrives with arrays, not
    // strings — the template JSON.parses them. Return rows in that
    // shape for the automod guilds; the main guild has no row (fresh).
    if (s.includes('FROM automod_settings') && s.trimStart().startsWith('SELECT')) {
      const gid = String(params[0]);
      const row = (jsonMode) => {
        const json = (v) => (jsonMode === 'string' ? JSON.stringify(v) : jsonMode === 'null' ? null : v);
        return {
          guild_id: gid, enabled: 1, spam_max_messages: 5, spam_window_seconds: 5,
          spam_action: 'delete_warn', spam_timeout_minutes: 10,
          banned_words: json(['spam', 'scam']), block_links: 0, block_invites: 1,
          exempt_roles: json(['222']), exempt_channels: json(['111']), log_channel_id: null,
          dup_enabled: 0, dup_max: 3, caps_enabled: 0, caps_min_length: 10, caps_percent: 70,
          mention_enabled: 0, mention_max: 5, link_max: 0, antispam_action: 'delete_warn',
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
      };
      if (gid === GUILD_AUTOMOD_ARRAYS) return [row('array')];
      if (gid === GUILD_AUTOMOD_STRINGS) return [row('string')];
      if (gid === GUILD_AUTOMOD_NULLS) return [row('null')];
      return [];
    }
    // error_logs: the staff errors page reads these; empty is fine here.
    if (s.includes('FROM error_logs')) {
      if (s.trimStart().startsWith('SELECT')) return [];
      return { affectedRows: 0 };
    }
    // COUNT(*)/SUM(*) aggregates always return one zero row.
    if (/COUNT\(\*\)|SUM\(/.test(s)) {
      return [{ n: 0, total: 0, total_commands: 0, successes: 0, count: 0, t: 0, f: 0, c: 0 }];
    }
    if (s.trimStart().startsWith('SELECT')) return [];
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s)) return { affectedRows: 1, insertId: store.nextId++ };
    return [];
  },
};

// Seed the legacy single hub for the main test guild: the dashboard tab
// and the command list must migrate it into tempvc_hubs on first use.
store.guildSettings[GUILD_ID] = { guild_id: GUILD_ID, tempvc_create_channel_id: LEGACY_HUB, tempvc_category_id: CAT_GAMING };

// --- Fake Discord API (axios stub) -------------------------------------------
// Same shape as verify-1.16.15.js, plus a real in-memory channel store:
// GET /guilds/:id/channels lists it, POST /guilds/:id/channels creates a
// voice channel in it (403 for the Forbidden category, like a bot without
// Manage Channels), DELETE /channels/:id removes it. Anything else gets a
// 404-shaped axios error so handlers take their real error paths.
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
    return { data: [GUILD_ID, GUILD_AUTOMOD_ARRAYS, GUILD_AUTOMOD_STRINGS, GUILD_AUTOMOD_NULLS].map((id) => ({ id, name: 'Test Guild', icon: null, owner: true, permissions: '32' })) };
  }
  if (m === 'GET' && /^\/guilds\/\d+$/.test(u)) {
    return { data: { id: u.split('/')[2], name: 'Test Guild', icon: null } };
  }
  if (m === 'GET' && /^\/guilds\/\d+\/channels$/.test(u)) {
    return { data: [...store.channels] };
  }
  if (m === 'GET' && /^\/guilds\/\d+\/roles$/.test(u)) {
    return { data: [{ id: GUILD_ID, name: '@everyone' }, { id: '222', name: 'Admin' }] };
  }
  // 1.16.18: the reactionroles and emojis tabs fetch the guild's emoji list;
  // the live API returns it, the stub must too or both tabs 500.
  if (m === 'GET' && /^\/guilds\/\d+\/emojis$/.test(u)) {
    return { data: [] };
  }
  if (m === 'POST' && /^\/guilds\/\d+\/channels$/.test(u)) {
    if (data?.parent_id === CAT_FORBIDDEN) {
      const err = new Error('Request failed with status code 403');
      err.response = { status: 403, data: { message: 'Missing Permissions', code: 50013 } };
      throw err;
    }
    const created = { id: String(300000000000000000 + store.nextChannelSeq++), name: data.name, type: data.type, parent_id: data.parent_id || null };
    store.channels.push(created);
    return { data: created };
  }
  if (m === 'DELETE' && /^\/channels\/\d+$/.test(u)) {
    const id = u.split('/')[2];
    store.channels = store.channels.filter((c) => c.id !== id);
    store.deletedChannels.push(id);
    return { data: {} };
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

// --- HTTP driver (copied from verify-1.16.15.js) ------------------------------
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

// --- Route enumeration (copied from verify-1.16.15.js) ------------------------
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
  for (const line of text.split('\n')) {
    const m = /app\.(get|post|delete|patch|put|all)\(\s*['"]([^'"]+)['"]/.exec(line);
    if (!m) continue;
    const guards = [...line.matchAll(/require(Auth|GuildAccess|StaffWrite|Staff|Admin|Owner|SetupAccess)\b/g)].map((g) => 'require' + g[1]);
    routes.push({ method: m[1].toUpperCase(), path: m[2], guards });
  }
  return routes;
}

// Routes whose correct answer is a 404 (no such row in the fake DB), a
// redirect, or a 500 for an environmental reason — copied from
// verify-1.16.15.js (the generic pass asserts these exactly instead of
// "not 404"). The new tempvc-hub routes need no entries: POST with an
// empty body 400s on the missing category and DELETE /tempvc-hubs/111
// 400s on the short id, and neither is a 404/500.
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
  'POST /api/staff/serverbackups/1/restore': 404,
  'DELETE /api/staff/serverbackups/1': 404,
  'GET /staff/serverbackups/download/1': 404,
  'POST /api/staff/botflags/1/clear': 404,
  'POST /api/staff/botflags/1/kick': 404,
  'POST /api/staff/botflags/1/ban': 404,
  'POST /api/staff/backup-now': 500,
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
  // 1.16.18: the stub now returns a real (empty) emoji list, so the DELETE
  // handler reaches its own "Emoji not found" 404 for the fake id instead
  // of the stub's axios 404 (which the handler turned into a 400).
  'DELETE /api/guilds/1571439343976058970/emojis/1': 404,
};
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

// --- Fake Discord guild for the voice handler + command tests -----------------
// The voice handler and the setup command run against discord.js objects,
// not the dashboard's REST stub, so they get a fake guild here.
function fakeGuild(guildId) {
  const channels = new Map();
  const guild = {
    id: guildId,
    channels: {
      cache: { get: (id) => channels.get(id) || null },
      create: async ({ name, type, parent }) => {
        if (fakeGuild.failCreate) {
          const err = fakeGuild.failCreate;
          fakeGuild.failCreate = null;
          throw err;
        }
        const ch = {
          id: `4000000000000000${String(fakeGuild.seq++).padStart(2, '0')}`,
          name, type, parentId: parent || null, members: { size: 0 },
          delete: async () => { channels.delete(ch.id); fakeGuild.deleted.push(ch.id); },
          setUserLimit: async () => {},
          setName: async () => {},
          permissionOverwrites: { edit: async () => {} },
        };
        channels.set(ch.id, ch);
        return ch;
      },
    },
  };
  guild._channels = channels;
  return guild;
}
fakeGuild.seq = 1;
fakeGuild.deleted = [];
fakeGuild.failCreate = null;

function fakeMember() {
  return {
    id: '555555555555555555',
    displayName: 'Ace',
    user: { username: 'acebennett22', id: '555555555555555555' },
    voice: { setChannel: async (ch) => { fakeMember.movedTo = ch; } },
  };
}
fakeMember.movedTo = null;

function mockInteraction({ sub, guildId, guild, category, name, channel }) {
  const replies = [];
  return {
    interaction: {
      guildId,
      guild,
      options: {
        getSubcommand: () => sub,
        getChannel: (optName) => (optName === 'category' ? category : channel),
        getString: () => name,
      },
      reply: async (payload) => { replies.push(payload); return payload; },
    },
    replies,
  };
}
function embedText(reply) {
  const e = reply?.embeds?.[0];
  return { title: e?.data?.title || '', description: e?.data?.description || '' };
}

async function main() {
  await waitForServer();

  // --- Static checks ---------------------------------------------------------
  await check('package.json is 1.16.19 with the changelog entry; route normalizes the automod JSON columns', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.16.19');
    assert.ok(src('CHANGELOG.md').includes('## [1.16.19]'), 'no 1.16.19 CHANGELOG entry');
    assert.ok(src('CHANGELOG.md').includes('mysql2 returns JSON columns'), 'changelog does not name the root cause');
    const dash = src('src/dashboard.js');
    assert.ok(dash.includes("for (const key of ['banned_words', 'exempt_roles', 'exempt_channels'])"), 'no JSON-column normalization loop in the settings route');
    assert.ok(dash.includes("if (v != null && typeof v !== 'string') automodSettings[key] = JSON.stringify(v);"), 'normalization does not stringify non-string JSON columns');
  });

  await check('responsive CSS: stepped breakpoints, header wrap, table scroll, 16px form text', () => {
    const css = src('dashboard/public/style.css');
    assert.ok(css.includes('@media (min-width:1400px)'), 'no wide-screen breakpoint');
    assert.ok(css.includes('@media (max-width:1024px)'), 'no tablet breakpoint');
    assert.ok(css.includes('@media (max-width:820px)'), '820px breakpoint is gone');
    assert.ok(css.includes('@media (max-width:640px)'), 'no 640px phone breakpoint');
    assert.ok(css.includes('@media (max-width:480px)'), 'no 480px small-phone breakpoint');
    assert.ok(css.includes('header{flex-wrap:wrap'), 'header does not wrap on phones');
    assert.ok(css.includes('.settings-content :not(.table-scroll) > table{display:block;overflow-x:auto'), 'no small-screen table scroll rule');
    assert.ok(css.includes('font-size:16px'), 'no 16px form-text rule (iOS zoom)');
    assert.ok(css.includes('.bar-row{flex-wrap:wrap}'), 'bar rows do not wrap on phones');
    assert.ok(css.includes('main,footer{max-width:1240px}'), 'no wider content column on wide screens');
    assert.ok(css.includes('overflow-wrap:anywhere'), 'no long-string wrapping in the settings panel');
    assert.ok(css.includes('main img{max-width:100%}'), 'no image max-width safety');
  });

  await check('settings.ejs: module picker dropdown; old links only inside noscript; tempvc hub UI intact', () => {
    const view = src('dashboard/views/settings.ejs');
    assert.ok(view.includes('<select id="module-picker"'), 'no module-picker select');
    assert.ok(view.includes('<option value="<%= m %>"'), 'picker does not render an option per module');
    assert.ok(view.includes("<%= module === m ? 'selected' : '' %>"), 'picker does not mark the current module selected');
    const nsOpen = view.indexOf('<noscript>');
    const nsClose = view.indexOf('</noscript>');
    const linkLoop = view.indexOf('<a href="/guilds/<%= guild.id %>/<%= m %>"');
    assert.ok(nsOpen !== -1 && nsClose > nsOpen, 'no noscript fallback block');
    assert.ok(linkLoop > nsOpen && linkLoop < nsClose, 'the old module links are not inside the noscript block');
    assert.strictEqual(view.indexOf('<a href="/guilds/<%= guild.id %>/<%= m %>"', nsClose), -1, 'module links also appear outside noscript');
    assert.ok(view.includes('id="tempvc-hubs-list"'), 'tempvc hub list is gone');
    assert.ok(view.includes('id="add-tempvc-hub-form"'), 'tempvc add-hub form is gone');
    assert.ok(view.includes('data-remove-tempvc-hub'), 'tempvc hub Remove button is gone');
    assert.ok(view.includes('class="bar-row"'), 'analytics/polls rows do not use .bar-row');
  });

  await check('settings.js: picker change handler navigates to the module URL', () => {
    const js = src('dashboard/public/js/settings.js');
    assert.ok(js.includes("e.target.id === 'module-picker'"), 'no module-picker change handler');
    assert.ok(js.includes('`/guilds/${guildId}/${mod}`'), 'picker does not navigate to /guilds/:id/:module');
  });

  await check('no command or route changes: 158 routes, check-deploy unchanged', () => {
    const routes = enumerateRoutes();
    assert.strictEqual(routes.length, 158, `route count changed: ${routes.length}`);
    const out = execSync('node check-deploy.js', { cwd: root, encoding: 'utf8', env: { ...process.env, ALLOW_PLACEHOLDER_CONFIG: '1' } });
    assert.ok(out.includes('problems: 0'), `check-deploy.js reports problems:\n${out}`);
    assert.ok(out.includes('top-level commands: 39'), `top-level count changed:\n${out}`);
    assert.ok(src('src/dashboard.js').includes('1.16.19'), 'dashboard.js does not carry the 1.16.19 fix marker');
  });

  // --- Login flows (copied from verify-1.16.17.js) ----------------------------
  let localJar = null;
  let discordJar = null;
  await check('local admin login works over a urlencoded form', async () => {
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

  // --- Module picker (live) ----------------------------------------------------
  const MODULES = [...src('src/dashboard.js').match(/const MODULES = \[([^\]]+)\]/)[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  function pickerOptions(html) {
    const start = html.indexOf('<select id="module-picker"');
    assert.ok(start !== -1, 'picker select is missing from the rendered page');
    const end = html.indexOf('</select>', start);
    return html.slice(start, end);
  }

  await check('settings page renders the module picker with all 40 modules', async () => {
    assert.strictEqual(MODULES.length, 40, `expected 40 modules, got ${MODULES.length}`);
    const r = await req('GET', `/guilds/${GUILD_ID}/general`, { jar: discordJar });
    assert.strictEqual(r.status, 200, `general tab should 200, got ${r.status}`);
    const options = [...pickerOptions(r.text).matchAll(/<option value="([a-z-]+)"[^>]*>/g)].map((m) => m[1]);
    // The picker must cover exactly the routable modules, in the sidebar's
    // own order — the EJS MODS list and the route's MODULES list have the
    // same 40 modules but in a different order (applications/commands are
    // swapped), which is pre-existing and not this release's business.
    const EJS_MODS = [...src('dashboard/views/settings.ejs').match(/const MODS = \[(.*?)\];/s)[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual([...options].sort(), [...MODULES].sort(), 'picker options do not cover the MODULES list');
    assert.deepStrictEqual(options, EJS_MODS, 'picker options are not in the sidebar order');
    assert.ok(/<option value="general" selected>/.test(pickerOptions(r.text)), 'current module (general) is not selected');
    assert.ok(r.text.includes('<noscript>'), 'noscript fallback is missing from the rendered page');
    assert.ok(r.text.includes(`/guilds/${GUILD_ID}/tempvc`), 'noscript fallback has no tempvc link');
  });

  await check('every module renders with the picker and the right module selected (all 40)', async () => {
    const problems = [];
    for (const m of MODULES) {
      const r = await req('GET', `/guilds/${GUILD_ID}/${m}`, { jar: discordJar });
      if (r.status !== 200) { problems.push(`${m}: ${r.status}`); continue; }
      const picker = pickerOptions(r.text);
      if (!new RegExp(`<option value="${m}" selected>`).test(picker)) problems.push(`${m}: not selected in picker`);
    }
    assert.strictEqual(problems.length, 0, `${problems.length} module(s) failed:\n  - ${problems.join('\n  - ')}`);
  });

  await check('Temp VC tab still lists hubs with the add form (1.16.17 intact)', async () => {
    const r = await req('GET', `/guilds/${GUILD_ID}/tempvc`, { jar: discordJar });
    assert.strictEqual(r.status, 200, `tempvc tab should 200, got ${r.status}`);
    assert.ok(r.text.includes('Temporary Voice Channels'), 'tab heading is missing');
    assert.ok(r.text.includes('Join to Create'), 'migrated legacy hub channel is not listed');
    assert.ok(r.text.includes('Gaming'), 'migrated legacy hub category is not listed');
    assert.ok(r.text.includes('add-tempvc-hub-form'), 'add-hub form is missing');
    assert.ok(r.text.includes('data-remove-tempvc-hub'), 'hub Remove button is missing');
    assert.ok(r.text.includes('id="module-picker"'), 'module picker is missing from the tempvc tab');
  });

  // --- Automod 500 fix (1.16.19) ----------------------------------------------
  await check('automod page renders for a fresh guild (no saved row)', async () => {
    const r = await req('GET', `/guilds/${GUILD_ID}/automod`, { jar: discordJar });
    assert.strictEqual(r.status, 200, `fresh guild automod should 200, got ${r.status}`);
    assert.ok(r.text.includes('id="automod-form"'), 'automod form is missing for the fresh guild');
  });

  await check('automod page renders for a guild with a saved row (mysql2 JSON arrays) and shows the saved data', async () => {
    const r = await req('GET', `/guilds/${GUILD_AUTOMOD_ARRAYS}/automod`, { jar: discordJar });
    assert.strictEqual(r.status, 200, `saved-row guild automod should 200, got ${r.status}`);
    assert.ok(r.text.includes('id="automod-form"'), 'automod form is missing for the saved-row guild');
    assert.ok(r.text.includes('spam'), 'saved banned word "spam" is not shown');
    assert.ok(r.text.includes('scam'), 'saved banned word "scam" is not shown');
    assert.ok(/<option value="222" selected>/.test(r.text), 'exempt role 222 is not marked selected');
    assert.ok(/<option value="111" selected>/.test(r.text), 'exempt channel 111 is not marked selected');
  });

  await check('automod page renders for saved rows stored as JSON strings and as NULL', async () => {
    for (const gid of [GUILD_AUTOMOD_STRINGS, GUILD_AUTOMOD_NULLS]) {
      const r = await req('GET', `/guilds/${gid}/automod`, { jar: discordJar });
      assert.strictEqual(r.status, 200, `guild ${gid} automod should 200, got ${r.status}`);
      assert.ok(r.text.includes('id="automod-form"'), `automod form is missing for guild ${gid}`);
    }
  });

  await check('home, staff, docs, version, and style.css render', async () => {
    const staff = await req('GET', '/staff', { jar: localJar });
    assert.strictEqual(staff.status, 200, `GET /staff should 200, got ${staff.status}`);
    const docs = await req('GET', '/docs', { jar: discordJar });
    assert.strictEqual(docs.status, 200, `GET /docs should 200, got ${docs.status}`);
    const version = await req('GET', '/version', { jar: discordJar });
    assert.strictEqual(version.status, 200, `GET /version should 200, got ${version.status}`);
    assert.ok(version.text.includes('1.16.19'), 'version page does not show 1.16.19');
    const css = await req('GET', '/style.css');
    assert.strictEqual(css.status, 200, `GET /style.css should 200, got ${css.status}`);
    assert.ok(css.text.includes('@media (max-width:640px)'), 'served CSS has no 640px breakpoint');
    assert.ok(css.text.includes('@media (max-width:480px)'), 'served CSS has no 480px breakpoint');
    assert.ok(css.text.includes('.bar-row{flex-wrap:wrap}'), 'served CSS has no bar-row wrap rule');
  });

  // --- Full route pass (copied from verify-1.16.17.js) -------------------------
  const routes = enumerateRoutes();
  const orderedRoutes = [
    ...routes.filter((r) => !(r.method === 'GET' && r.path === '/logout')),
    ...routes.filter((r) => r.method === 'GET' && r.path === '/logout'),
  ];
  await check(`authenticated pass: all ${routes.length} routes answer (no 404/500 unless expected)`, async () => {
    const problems = [];
    for (const r of orderedRoutes) {
      const url = substitute(r.path);
      const jar = r.path.startsWith('/api/staff') || r.path.startsWith('/staff') ? localJar : discordJar;
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
      if (r.method === 'POST' && r.path === '/login/local') {
        if (res.status !== 401) problems.push(`${key}: expected 401, got ${res.status}`);
        continue;
      }
      if (r.guards.length === 0) {
        if (res.status === 404 || res.status === 500) problems.push(`${key}: public route got ${res.status}`);
      } else if (r.guards.includes('requireStaffWrite') || r.guards.includes('requireAuth')) {
        if (r.path.startsWith('/api/')) {
          if (res.status !== 401) problems.push(`${key}: expected 401, got ${res.status}`);
        } else if (res.status !== 302) {
          problems.push(`${key}: expected 302 to /login, got ${res.status}`);
        }
      } else if (res.status !== 302) {
        problems.push(`${key}: expected 302 to /login, got ${res.status}`);
      }
    }
    assert.strictEqual(problems.length, 0, `${problems.length} route(s) failed:\n  - ${problems.join('\n  - ')}`);
  });

  await check('staff routes work for the local admin; guild routes stay Discord-only', async () => {
    const localLogin = await req('POST', '/login/local', { body: { username: 'testadmin', password: 'TestPass123!' }, contentType: 'application/x-www-form-urlencoded' });
    assert.strictEqual(localLogin.status, 302, `re-login should 302, got ${localLogin.status}`);
    localJar = jarFrom(localLogin.setCookie);
    const discordLogin = await req('GET', '/callback?code=fakecode2');
    assert.strictEqual(discordLogin.status, 302, `re-callback should 302, got ${discordLogin.status}`);
    discordJar = jarFrom(discordLogin.setCookie);
    const staff = await req('GET', '/staff', { jar: localJar });
    assert.strictEqual(staff.status, 200, `local admin GET /staff should 200, got ${staff.status}`);
    const guildAsLocal = await req('GET', `/guilds/${GUILD_ID}/general`, { jar: localJar });
    assert.ok([302, 401, 403].includes(guildAsLocal.status), `local account on a guild page should be denied, got ${guildAsLocal.status}`);
    const guild = await req('GET', `/guilds/${GUILD_ID}/general`, { jar: discordJar });
    assert.strictEqual(guild.status, 200, `Discord owner GET guild page should 200, got ${guild.status}`);
    const ownerPage = await req('GET', '/staff/manage', { jar: discordJar });
    assert.strictEqual(ownerPage.status, 200, `Discord owner GET /staff/manage should 200, got ${ownerPage.status}`);
    const ownerPageLocal = await req('GET', '/staff/manage', { jar: localJar });
    assert.strictEqual(ownerPageLocal.status, 403, `local admin GET /staff/manage should 403, got ${ownerPageLocal.status}`);
  });

  console.log(`\n${passed} passed, ${failed} failed${failed ? ` (${failures.join(', ')})` : ''}`);
  process.exitCode = failed ? 1 : 0;
  process.exit(process.exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

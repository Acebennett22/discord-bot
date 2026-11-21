// Verify 1.16.17: multiple temp VC hubs per server, bot creates the hub channel.
// The REAL dashboard (src/dashboard.js) boots on a test port with a mocked
// config, an in-memory fake database (tempvc_hubs + temp_channels +
// guild_settings + dashboard_accounts + staff_audit), and a stubbed Discord
// API (axios) that really creates/deletes channels in a fake channel store.
// The real /tempvc setup command and the real voice handler are exercised
// in-process against the same fake DB. No live bot, no live Discord, no
// live MySQL, nothing written to config.json.
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
const TEST_PORT = 3102;
const OWNER_ID = '999999999999999999';
const GUILD_ID = '1571439343976058970';
const CLIENT_ID = '123456789012345678';
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
    return { data: [{ id: GUILD_ID, name: 'Test Guild', icon: null, owner: true, permissions: '32' }] };
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
  await check('package.json is 1.16.17 with the changelog entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.16.17');
    assert.ok(src('CHANGELOG.md').includes('## [1.16.17]'), 'no 1.16.17 CHANGELOG entry');
    assert.ok(src('CHANGELOG.md').includes('tempvc_hubs'), 'changelog does not name the new table');
  });

  await check('tempvc_hubs table: schema.sql + database.js self-heal', () => {
    const schema = src('sql/schema.sql');
    assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS tempvc_hubs'), 'schema.sql has no tempvc_hubs table');
    assert.ok(schema.includes('created_by_bot TINYINT(1) NOT NULL DEFAULT 1'), 'schema.sql table is missing created_by_bot');
    assert.ok(schema.includes('PRIMARY KEY (guild_id, create_channel_id)'), 'schema.sql table has the wrong primary key');
    const dbCode = src('src/utils/database.js');
    assert.ok(dbCode.includes('TEMPVC_HUBS_CREATE'), 'database.js has no TEMPVC_HUBS_CREATE');
    assert.ok(dbCode.includes('await pool.execute(TEMPVC_HUBS_CREATE)'), 'runMigrations does not ensure tempvc_hubs');
  });

  await check('deploy shape: /tempvc setup is a group with add/remove/list; /tempvc owner group untouched', () => {
    const { buildConsolidated } = require('../src/handlers/consolidate');
    const { topLevel } = buildConsolidated();
    const tempvc = topLevel.find((c) => c.data.name === 'tempvc');
    assert.ok(tempvc, 'no /tempvc parent');
    const json = tempvc.data.toJSON();
    const setup = json.options.find((o) => o.name === 'setup');
    assert.ok(setup, 'no setup child under /tempvc');
    assert.strictEqual(setup.type, 2, `setup should be a group (type 2), got type ${setup.type}`);
    assert.deepStrictEqual(setup.options.map((o) => o.name), ['add', 'remove', 'list'], 'setup group subcommands are not add/remove/list');
    const add = setup.options.find((o) => o.name === 'add');
    assert.ok(add.options.some((o) => o.name === 'category' && o.required), 'add has no required category option');
    assert.ok(add.options.some((o) => o.name === 'name' && o.required && o.max_length === 100), 'add has no required name option (max 100)');
    const remove = setup.options.find((o) => o.name === 'remove');
    assert.ok(remove.options.some((o) => o.name === 'create_channel' && o.required), 'remove has no required create_channel option');
    const owner = json.options.find((o) => o.name === 'tempvc');
    assert.ok(owner && owner.type === 2, 'owner group /tempvc tempvc is gone');
    assert.deepStrictEqual(owner.options.map((o) => o.name), ['limit', 'lock', 'unlock', 'rename', 'kick', 'claim'], 'owner subcommands changed');
  });

  await check('check-deploy.js passes with unchanged counts', () => {
    const out = execSync('node check-deploy.js', { cwd: root, encoding: 'utf8', env: { ...process.env, ALLOW_PLACEHOLDER_CONFIG: '1' } });
    assert.ok(out.includes('problems: 0'), `check-deploy.js reports problems:\n${out}`);
    assert.ok(out.includes('top-level commands: 39'), `top-level count changed:\n${out}`);
  });

  await check('dashboard no longer saves the legacy tempvc keys from the settings form', () => {
    const dash = src('src/dashboard.js');
    assert.ok(!dash.includes('patch.tempvcCreateChannelId'), 'settings POST still writes tempvcCreateChannelId');
    assert.ok(!dash.includes('patch.tempvcCategoryId'), 'settings POST still writes tempvcCategoryId');
    assert.ok(dash.includes("app.post('/api/guilds/:id/tempvc-hubs'"), 'no POST /tempvc-hubs route');
    assert.ok(dash.includes("app.delete('/api/guilds/:id/tempvc-hubs/:channelId'"), 'no DELETE /tempvc-hubs route');
    const view = src('dashboard/views/settings.ejs');
    assert.ok(!view.includes('name="tempvcCreateChannelId"'), 'tempvc tab still has the legacy create-channel dropdown');
    assert.ok(view.includes('id="tempvc-hubs-list"'), 'tempvc tab has no hubs list container');
    assert.ok(view.includes('id="add-tempvc-hub-form"'), 'tempvc tab has no add-hub form');
    assert.ok(view.includes('data-remove-tempvc-hub'), 'tempvc tab has no hub Remove button');
    const js = src('dashboard/public/js/settings.js');
    assert.ok(js.includes("'add-tempvc-hub-form'"), 'settings.js has no add-hub form handler');
    assert.ok(js.includes('[data-remove-tempvc-hub]'), 'settings.js has no hub remove handler');
  });

  // --- Voice handler + hub helpers (real src/utils/tempvc.js) -----------------
  const tempvc = require('../src/utils/tempvc');
  const { invalidate } = require('../src/utils/guildSettings');

  await check('hub join spawns a temp channel in the hub category; non-hub join with hubs does nothing', async () => {
    const guildId = '200000000000000001';
    store.hubs.push({ guild_id: guildId, create_channel_id: '210000000000000001', category_id: CAT_GAMING, created_by_bot: 1, created_at: new Date().toISOString() });
    store.hubs.push({ guild_id: guildId, create_channel_id: '210000000000000002', category_id: CAT_CHILL, created_by_bot: 1, created_at: new Date().toISOString() });
    const guild = fakeGuild(guildId);
    const member = fakeMember();
    fakeMember.movedTo = null;
    await tempvc.handleVoiceState(
      { guild, channelId: null },
      { guild, channelId: '210000000000000001', channel: { parentId: CAT_CHILL }, member },
    );
    assert.ok(fakeMember.movedTo, 'member was not moved into a temp channel');
    assert.strictEqual(fakeMember.movedTo.name, "Ace's Channel", `temp channel name is ${fakeMember.movedTo.name}`);
    assert.strictEqual(fakeMember.movedTo.parentId, CAT_GAMING, `temp channel parent is ${fakeMember.movedTo.parentId}, not the hub category`);
    assert.strictEqual(store.tempChannels.length, 1, 'temp channel was not recorded in temp_channels');
    assert.strictEqual(store.tempChannels[0].owner_id, member.user.id, 'temp channel owner is wrong');
    // Joining a non-hub channel while hubs exist spawns nothing.
    fakeMember.movedTo = null;
    const before = store.tempChannels.length;
    await tempvc.handleVoiceState(
      { guild, channelId: null },
      { guild, channelId: '210000000000000099', channel: { parentId: CAT_GAMING }, member },
    );
    assert.strictEqual(fakeMember.movedTo, null, 'joining a non-hub channel spawned a temp channel');
    assert.strictEqual(store.tempChannels.length, before, 'a temp channel row was added for a non-hub join');
  });

  await check('legacy fallback: no hub rows, the old single create channel still spawns (and DB-down too)', async () => {
    const guildId = '200000000000000002';
    store.guildSettings[guildId] = { guild_id: guildId, tempvc_create_channel_id: '220000000000000001', tempvc_category_id: CAT_CHILL };
    invalidate(guildId);
    const guild = fakeGuild(guildId);
    const member = fakeMember();
    fakeMember.movedTo = null;
    await tempvc.handleVoiceState(
      { guild, channelId: null },
      { guild, channelId: '220000000000000001', channel: { parentId: CAT_GAMING }, member },
    );
    assert.ok(fakeMember.movedTo, 'legacy create channel did not spawn');
    assert.strictEqual(fakeMember.movedTo.parentId, CAT_CHILL, 'legacy temp channel did not use the legacy category');
    // Database down: hubs cannot be read, legacy settings still work.
    dbEnabled = false;
    try {
      fakeMember.movedTo = null;
      await tempvc.handleVoiceState(
        { guild, channelId: null },
        { guild, channelId: '220000000000000001', channel: { parentId: CAT_GAMING }, member },
      );
      assert.ok(fakeMember.movedTo, 'legacy create channel did not spawn with the DB down');
    } finally {
      dbEnabled = true;
    }
  });

  await check('leaving an empty temp channel deletes it and its row', async () => {
    const guildId = '200000000000000001';
    const guild = fakeGuild(guildId);
    const tempId = store.tempChannels[0].channel_id;
    guild._channels.set(tempId, { id: tempId, members: { size: 0 }, delete: async () => { guild._channels.delete(tempId); fakeGuild.deleted.push(tempId); } });
    await tempvc.handleVoiceState(
      { guild, channelId: tempId },
      { guild, channelId: null },
    );
    assert.ok(!guild._channels.has(tempId), 'empty temp channel was not deleted on leave');
    assert.ok(!store.tempChannels.some((t) => t.channel_id === tempId), 'temp_channels row was not deleted on leave');
  });

  await check('migrateLegacyHub inserts the legacy hub once (created_by_bot=0), then is a no-op', async () => {
    const guildId = '200000000000000003';
    store.guildSettings[guildId] = { guild_id: guildId, tempvc_create_channel_id: '230000000000000001', tempvc_category_id: '' };
    invalidate(guildId);
    const settings = { tempvcCreateChannelId: '230000000000000001', tempvcCategoryId: '' };
    const first = await tempvc.migrateLegacyHub(guildId, settings);
    assert.ok(first, 'migrateLegacyHub returned nothing');
    assert.strictEqual(first.created_by_bot, 0, 'migrated legacy hub is marked bot-created');
    assert.strictEqual(first.category_id, null, 'empty legacy category should migrate as NULL');
    const count = store.hubs.filter((h) => h.guild_id === guildId).length;
    assert.strictEqual(count, 1, `expected 1 migrated hub, got ${count}`);
    const second = await tempvc.migrateLegacyHub(guildId, settings);
    assert.strictEqual(second, null, 'second migration should be a no-op');
    assert.strictEqual(store.hubs.filter((h) => h.guild_id === guildId).length, 1, 'second migration duplicated the hub');
  });

  // --- /tempvc setup command (real execute(), mocked interactions) ------------
  const setupCmd = require('../src/commands/tempvc/tempvc-setup');

  await check('setup add creates the hub channel and registers it; cap enforced', async () => {
    const guildId = '200000000000000004';
    const guild = fakeGuild(guildId);
    const category = { id: CAT_GAMING, name: 'Gaming', type: 4 };
    const { interaction, replies } = mockInteraction({ sub: 'add', guildId, guild, category, name: '➕ New Hub' });
    await setupCmd.execute(interaction);
    const t = embedText(replies[0]);
    assert.ok(t.title.includes('hub added'), `add reply title: ${t.title}`);
    assert.ok(t.description.includes('Gaming'), 'add reply does not name the category');
    const hubs = await tempvc.listHubs(guildId);
    assert.strictEqual(hubs.length, 1, 'hub was not registered');
    assert.strictEqual(hubs[0].created_by_bot, 1, 'hub is not marked bot-created');
    assert.strictEqual(hubs[0].category_id, CAT_GAMING, 'hub category is wrong');
    const created = [...guild._channels.values()][0];
    assert.ok(created && created.name === '➕ New Hub' && created.parentId === CAT_GAMING, 'hub channel was not created in the category with the given name');
    // Fill to the cap, then one more add must fail.
    for (let i = 1; i < 10; i++) {
      store.hubs.push({ guild_id: guildId, create_channel_id: `2400000000000000${String(i).padStart(2, '0')}`, category_id: CAT_CHILL, created_by_bot: 1, created_at: new Date().toISOString() });
    }
    const over = mockInteraction({ sub: 'add', guildId, guild, category, name: '➕ One Too Many' });
    await setupCmd.execute(over.interaction);
    assert.ok(embedText(over.replies[0]).title.includes('Too many hubs'), 'cap was not enforced');
  });

  await check('setup add: missing Manage Channels (50013) is a clear error; a failed save deletes the channel again', async () => {
    const guildId = '200000000000000005';
    const guild = fakeGuild(guildId);
    const category = { id: CAT_GAMING, name: 'Gaming', type: 4 };
    fakeGuild.failCreate = Object.assign(new Error('Missing Permissions'), { code: 50013 });
    const denied = mockInteraction({ sub: 'add', guildId, guild, category, name: '➕ Denied' });
    await setupCmd.execute(denied.interaction);
    const dt = embedText(denied.replies[0]);
    assert.ok(dt.title.includes('Could not create channel'), `50013 reply title: ${dt.title}`);
    assert.ok(dt.description.includes('Manage Channels'), '50013 reply does not name the missing permission');
    assert.strictEqual((await tempvc.listHubs(guildId)).length, 0, 'a hub was registered for the denied create');
    // Save failure: the channel is created, the insert fails, the channel
    // is deleted again and the error is reported.
    failNextHubInsert = true;
    const failing = mockInteraction({ sub: 'add', guildId, guild, category, name: '➕ Unsaved' });
    await setupCmd.execute(failing.interaction);
    const ft = embedText(failing.replies[0]);
    assert.ok(ft.title.includes('Could not save hub'), `save-failure reply title: ${ft.title}`);
    assert.strictEqual((await tempvc.listHubs(guildId)).length, 0, 'failed hub was registered anyway');
    const createdId = [...guild._channels.values()].map((c) => c.id);
    assert.ok(createdId.length === 0 || fakeGuild.deleted.length > 0, 'orphan channel was not deleted after the failed save');
  });

  await check('setup remove: bot-created hub deletes the channel, legacy hub keeps it, non-hub errors', async () => {
    const guildId = '200000000000000006';
    const guild = fakeGuild(guildId);
    const botHub = { id: '260000000000000001', name: '➕ Bot Hub', type: 2, parentId: CAT_GAMING, delete: async () => { guild._channels.delete(botHub.id); fakeGuild.deleted.push(botHub.id); } };
    const legacyHub = { id: '260000000000000002', name: '➕ Old Hub', type: 2, parentId: CAT_GAMING, delete: async () => { guild._channels.delete(legacyHub.id); fakeGuild.deleted.push(legacyHub.id); } };
    guild._channels.set(botHub.id, botHub);
    guild._channels.set(legacyHub.id, legacyHub);
    store.hubs.push(
      { guild_id: guildId, create_channel_id: botHub.id, category_id: CAT_GAMING, created_by_bot: 1, created_at: new Date().toISOString() },
      { guild_id: guildId, create_channel_id: legacyHub.id, category_id: CAT_GAMING, created_by_bot: 0, created_at: new Date().toISOString() },
    );
    const rmBot = mockInteraction({ sub: 'remove', guildId, guild, channel: botHub });
    await setupCmd.execute(rmBot.interaction);
    assert.ok(embedText(rmBot.replies[0]).title.includes('hub removed'), 'bot-hub remove reply is wrong');
    assert.ok(!guild._channels.has(botHub.id), 'bot-created hub channel was not deleted');
    assert.ok(!(await tempvc.getHub(guildId, botHub.id)), 'bot hub row was not deleted');
    const rmLegacy = mockInteraction({ sub: 'remove', guildId, guild, channel: legacyHub });
    await setupCmd.execute(rmLegacy.interaction);
    assert.ok(embedText(rmLegacy.replies[0]).description.includes('left alone'), 'legacy remove reply does not say the channel was left alone');
    assert.ok(guild._channels.has(legacyHub.id), 'legacy hub channel was deleted — only bot-created channels are deleted');
    assert.ok(!(await tempvc.getHub(guildId, legacyHub.id)), 'legacy hub row was not deleted');
    const rmNone = mockInteraction({ sub: 'remove', guildId, guild, channel: { id: '260000000000000099', name: 'Not A Hub', type: 2 } });
    await setupCmd.execute(rmNone.interaction);
    assert.ok(embedText(rmNone.replies[0]).title.includes('Not a hub'), 'removing a non-hub did not error');
  });

  await check('setup list shows hubs, flags stale ones, and migrates the legacy hub', async () => {
    const guildId = '200000000000000007';
    const guild = fakeGuild(guildId);
    const live = { id: '270000000000000001', name: '➕ Live Hub', type: 2, parentId: CAT_GAMING };
    guild._channels.set(live.id, live);
    guild._channels.set(CAT_GAMING, { id: CAT_GAMING, name: 'Gaming', type: 4 });
    store.hubs.push(
      { guild_id: guildId, create_channel_id: live.id, category_id: CAT_GAMING, created_by_bot: 1, created_at: new Date().toISOString() },
      { guild_id: guildId, create_channel_id: '270000000000000099', category_id: '270000000000000098', created_by_bot: 1, created_at: new Date().toISOString() },
    );
    const { interaction, replies } = mockInteraction({ sub: 'list', guildId, guild });
    await setupCmd.execute(interaction);
    const t = embedText(replies[0]);
    assert.ok(t.title.includes('(2/10)'), `list title should show 2/10, got: ${t.title}`);
    assert.ok(t.description.includes('Gaming'), 'list does not show the live hub category');
    assert.ok(t.description.includes('stale'), 'list does not flag the stale hub');
    assert.ok(t.description.includes('dashboard'), 'stale note does not point at the dashboard');
    // Legacy migration on list: no hub rows + legacy settings => the
    // legacy hub shows up.
    const legacyGuild = '200000000000000008';
    store.guildSettings[legacyGuild] = { guild_id: legacyGuild, tempvc_create_channel_id: '280000000000000001', tempvc_category_id: CAT_CHILL };
    invalidate(legacyGuild);
    const legacyInteraction = mockInteraction({ sub: 'list', guildId: legacyGuild, guild: fakeGuild(legacyGuild) });
    await setupCmd.execute(legacyInteraction.interaction);
    const lt = embedText(legacyInteraction.replies[0]);
    assert.ok(lt.title.includes('(1/10)'), `legacy list should show 1/10 after migration, got: ${lt.title}`);
    assert.ok((await tempvc.listHubs(legacyGuild)).length === 1, 'legacy hub was not migrated by list');
  });

  // --- Login flows (copied from verify-1.16.15.js) ----------------------------
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

  // --- Dashboard: Temp VC tab + hub API (real HTTP) ---------------------------
  let createdHubChannelId = null;
  await check('Temp VC tab migrates the legacy hub and lists it with the add form', async () => {
    assert.strictEqual(store.hubs.filter((h) => h.guild_id === GUILD_ID).length, 0, 'test guild should start with no hub rows');
    const r = await req('GET', `/guilds/${GUILD_ID}/tempvc`, { jar: discordJar });
    assert.strictEqual(r.status, 200, `tempvc tab should 200, got ${r.status}`);
    assert.ok(r.text.includes('Temporary Voice Channels'), 'tab heading is missing');
    assert.ok(r.text.includes('Join to Create'), 'migrated legacy hub channel is not listed');
    assert.ok(r.text.includes('Gaming'), 'migrated legacy hub category is not listed');
    assert.ok(r.text.includes('add-tempvc-hub-form'), 'add-hub form is missing');
    assert.ok(r.text.includes('data-remove-tempvc-hub'), 'hub Remove button is missing');
    assert.ok(!r.text.includes('name="tempvcCreateChannelId"'), 'tab still renders the legacy dropdown');
    const hubs = store.hubs.filter((h) => h.guild_id === GUILD_ID);
    assert.strictEqual(hubs.length, 1, 'legacy hub was not migrated by the tab load');
    assert.strictEqual(hubs[0].created_by_bot, 0, 'migrated legacy hub is marked bot-created');
    // The AFK section in the same tab is untouched.
    assert.ok(r.text.includes('AFK channel auto-create'), 'AFK section is missing from the tempvc tab');
  });

  await check('hub API: add creates the Discord channel and registers the hub; bad input 400s; forbidden category 403s', async () => {
    const badCat = await req('POST', `/api/guilds/${GUILD_ID}/tempvc-hubs`, { jar: discordJar, body: { categoryId: '999999999999999999', name: '➕ Nope' } });
    assert.strictEqual(badCat.status, 400, `unknown category should 400, got ${badCat.status}`);
    const badName = await req('POST', `/api/guilds/${GUILD_ID}/tempvc-hubs`, { jar: discordJar, body: { categoryId: CAT_CHILL, name: '   ' } });
    assert.strictEqual(badName.status, 400, `blank name should 400, got ${badName.status}`);
    const forbidden = await req('POST', `/api/guilds/${GUILD_ID}/tempvc-hubs`, { jar: discordJar, body: { categoryId: CAT_FORBIDDEN, name: '➕ Forbidden' } });
    assert.strictEqual(forbidden.status, 403, `forbidden category should 403, got ${forbidden.status}`);
    assert.ok((forbidden.json()?.error || '').includes('Manage Channels'), '403 does not name the missing permission');
    const ok = await req('POST', `/api/guilds/${GUILD_ID}/tempvc-hubs`, { jar: discordJar, body: { categoryId: CAT_CHILL, name: '➕ Chill Hub' } });
    assert.strictEqual(ok.status, 200, `hub add should 200, got ${ok.status}: ${ok.text.slice(0, 200)}`);
    const j = ok.json();
    assert.ok(j?.ok && j.channelId, 'hub add did not return ok + channelId');
    createdHubChannelId = j.channelId;
    assert.ok(store.channels.some((c) => c.id === createdHubChannelId && c.name === '➕ Chill Hub' && c.parent_id === CAT_CHILL), 'Discord channel was not created in the category');
    const hubs = store.hubs.filter((h) => h.guild_id === GUILD_ID);
    assert.strictEqual(hubs.length, 2, `expected 2 hubs (legacy + new), got ${hubs.length}`);
    assert.ok(store.audit.some((a) => a.action === 'tempvc-hub.add' && a.target_id === createdHubChannelId), 'hub add was not audited');
    // The tab now lists both hubs.
    const tab = await req('GET', `/guilds/${GUILD_ID}/tempvc`, { jar: discordJar });
    assert.strictEqual(tab.status, 200);
    assert.ok(tab.text.includes('Chill Hub'), 'new hub is not listed on the tab');
  });

  await check('hub API: remove deletes a bot-created channel but keeps a legacy one; unknown hub 404s', async () => {
    // Remove the bot-created hub: channel deleted too.
    const rm = await req('DELETE', `/api/guilds/${GUILD_ID}/tempvc-hubs/${createdHubChannelId}`, { jar: discordJar });
    assert.strictEqual(rm.status, 200, `hub remove should 200, got ${rm.status}: ${rm.text.slice(0, 200)}`);
    assert.strictEqual(rm.json()?.channelDeleted, true, 'bot-created hub remove did not report channelDeleted');
    assert.ok(store.deletedChannels.includes(createdHubChannelId), 'bot-created hub channel was not deleted from Discord');
    assert.ok(!store.hubs.some((h) => h.create_channel_id === createdHubChannelId), 'hub row was not deleted');
    // Remove the legacy (migrated) hub: unregistered, channel kept.
    const rmLegacy = await req('DELETE', `/api/guilds/${GUILD_ID}/tempvc-hubs/${LEGACY_HUB}`, { jar: discordJar });
    assert.strictEqual(rmLegacy.status, 200, `legacy hub remove should 200, got ${rmLegacy.status}`);
    assert.strictEqual(rmLegacy.json()?.channelDeleted, false, 'legacy hub remove reported the channel deleted');
    assert.ok(store.channels.some((c) => c.id === LEGACY_HUB), 'legacy hub channel was deleted — only bot-created channels are deleted');
    assert.ok(!store.hubs.some((h) => h.create_channel_id === LEGACY_HUB), 'legacy hub row was not deleted');
    // Removing the migrated legacy hub clears the legacy settings, or the
    // next hub action would migrate it straight back.
    const settingsAfter = (await req('GET', `/api/guilds/${GUILD_ID}/settings`, { jar: discordJar })).json();
    assert.strictEqual(settingsAfter.tempvcCreateChannelId, '', 'legacy settings were not cleared on legacy hub removal');
    assert.strictEqual(settingsAfter.tempvcCategoryId, '', 'legacy category was not cleared on legacy hub removal');
    const gone = await req('DELETE', `/api/guilds/${GUILD_ID}/tempvc-hubs/${LEGACY_HUB}`, { jar: discordJar });
    assert.strictEqual(gone.status, 404, `removing an unknown hub should 404, got ${gone.status}`);
  });

  await check('hub API: stale hub renders as stale on the tab', async () => {
    store.hubs.push({ guild_id: GUILD_ID, create_channel_id: '100000000000000099', category_id: '100000000000000098', created_by_bot: 1, created_at: new Date().toISOString() });
    const r = await req('GET', `/guilds/${GUILD_ID}/tempvc`, { jar: discordJar });
    assert.strictEqual(r.status, 200, `tempvc tab should 200, got ${r.status}`);
    assert.ok(r.text.includes('100000000000000099'), 'stale hub channel id is not shown');
    assert.ok(r.text.includes('stale'), 'stale hub is not flagged as stale');
  });

  await check('settings POST ignores the legacy tempvc keys (fallback-only)', async () => {
    // Re-seed the legacy settings: the earlier remove test cleared them
    // when the migrated legacy hub was removed.
    store.guildSettings[GUILD_ID] = { guild_id: GUILD_ID, tempvc_create_channel_id: LEGACY_HUB, tempvc_category_id: CAT_GAMING };
    invalidate(GUILD_ID);
    const before = (await req('GET', `/api/guilds/${GUILD_ID}/settings`, { jar: discordJar })).json();
    assert.strictEqual(before.tempvcCreateChannelId, LEGACY_HUB, 'legacy setting was not the seeded value before the test');
    const res = await req('POST', `/api/guilds/${GUILD_ID}/settings`, { jar: discordJar, body: { tempvcCreateChannelId: '100000000000000055', tempvcCategoryId: CAT_CHILL } });
    assert.strictEqual(res.status, 200, `settings POST should 200, got ${res.status}`);
    const after = (await req('GET', `/api/guilds/${GUILD_ID}/settings`, { jar: discordJar })).json();
    assert.strictEqual(after.tempvcCreateChannelId, LEGACY_HUB, 'settings POST overwrote the legacy create channel');
    assert.strictEqual(after.tempvcCategoryId, CAT_GAMING, 'settings POST overwrote the legacy category');
  });

  // --- Full route pass (copied from verify-1.16.15.js) -------------------------
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

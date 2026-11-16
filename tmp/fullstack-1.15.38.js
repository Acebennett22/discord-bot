// Full-stack reproduction for 1.15.38: the REAL dashboard.js (Express app) +
// REAL reactionRoles.js, with a stubbed MySQL (exactly the 2 live rows) and
// stubbed Discord REST. Hits POST /api/guilds/:id/reaction-roles with the
// exact client bodies the browser sent. If the live bug is in the route
// stack, this reproduces it here and the query log shows the exact params.
'use strict';
const path = require('path');
const session = require('express-session');
const signature = require('cookie-signature');

const GUILD = '1571439343976058970';
const CHANNEL = '1571556681320632520';
const MESSAGE = '1571727320597663745';
const PC = '111111111111111111';
const YT = '222222222222222222';
const XBOX = '333333333333333333';
const BOT_ID = '999999999999999999';
const PORT = 18099;
const SECRET = 'test-secret-123';
const SID = 'test-session-id-1';

// --- Fake DB: exactly the 2 live rows --------------------------------------
const table = [
  { id: 1, guild_id: GUILD, channel_id: CHANNEL, message_id: MESSAGE, emoji: '💻', role_id: PC, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
  { id: 2, guild_id: GUILD, channel_id: CHANNEL, message_id: MESSAGE, emoji: '▶️', role_id: YT, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
];
let nextId = 3;
const queriesSeen = [];
const eq = (a, b) => String(a) === String(b);

const fakeDb = {
  isEnabled: () => true,
  initDatabase: async () => true,
  closePool: async () => {},
  logCommand: async () => {},
  withTransaction: async (fn) => fn(fakeDb.query),
  incrementSongsPlayed: async () => {},
  incrementMembersJoined: async () => {},
  incrementWarns: async () => {},
  getGlobalStats: async () => ({ totalCommands: 0, successes: 0, songsPlayed: 0, guilds: 0, users: 0, topCommands: [] }),
  getGuildStats: async () => ({ commandsUsed: 0, songsPlayed: 0, membersJoined: 0, warns: 0 }),
  getUserStats: async () => ({ commands_used: 0, warns: 0, last_seen: null }),
  getTopCommands: async () => [],
  getTopUsers: async () => [],
  query: async (sql, params = []) => {
    queriesSeen.push({ sql, params: [...params] });
    const p = params.map((v) => (v === undefined ? null : v));
    if (sql.startsWith('SELECT id FROM reaction_roles WHERE guild_id = ? AND channel_id = ? AND message_id = ? AND emoji = ?')) {
      const [g, c, m, e] = p;
      return table.filter((r) => eq(r.guild_id, g) && eq(r.channel_id, c) && eq(r.message_id, m) && eq(r.emoji, e)).map((r) => ({ id: r.id }));
    }
    if (sql.startsWith('SELECT channel_id, role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
      const [g, m, e] = p;
      return table.filter((r) => eq(r.guild_id, g) && eq(r.message_id, m) && eq(r.emoji, e)).map((r) => ({ channel_id: r.channel_id, role_id: r.role_id }));
    }
    if (sql.startsWith('INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id)')) {
      const [g, c, m, e, r] = p;
      if (table.some((row) => eq(row.guild_id, g) && eq(row.message_id, m) && eq(row.emoji, e))) return null; // ER_DUP_ENTRY swallowed
      table.push({ id: nextId++, guild_id: g, channel_id: c, message_id: m, emoji: e, role_id: r, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
      return { affectedRows: 1, insertId: nextId - 1 };
    }
    if (sql.startsWith('UPDATE reaction_roles SET channel_id = ? WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
      const [c, g, m, e] = p;
      const row = table.find((r) => eq(r.guild_id, g) && eq(r.message_id, m) && eq(r.emoji, e));
      if (!row) return { affectedRows: 0 };
      row.channel_id = c;
      return { affectedRows: 1 };
    }
    if (sql.startsWith('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
      const [g, m, e] = p;
      const before = table.length;
      for (let i = table.length - 1; i >= 0; i--) {
        if (eq(table[i].guild_id, g) && eq(table[i].message_id, m) && eq(table[i].emoji, e)) table.splice(i, 1);
      }
      return { affectedRows: before - table.length };
    }
    if (sql.startsWith('SELECT * FROM reaction_roles WHERE message_id = ?')) {
      return table.filter((r) => eq(r.message_id, p[0])).map((r) => ({ ...r }));
    }
    // Guild-wide list read (1.15.38) — shared by the duplicate check and
    // the list. Must return full row objects.
    if (sql.includes('FROM reaction_roles WHERE guild_id = ? ORDER BY message_id')) {
      return table.filter((r) => eq(r.guild_id, p[0])).map((r) => ({ ...r }));
    }
    if (sql.startsWith('SELECT emoji FROM reaction_roles WHERE guild_id = ? AND message_id = ?')) {
      return table.filter((r) => eq(r.guild_id, p[0]) && eq(r.message_id, p[1])).map((r) => ({ emoji: r.emoji }));
    }
    if (sql.startsWith('SELECT id FROM reaction_roles WHERE guild_id = ? AND channel_id = ? AND message_id = ?')) {
      return table.filter((r) => eq(r.guild_id, p[0]) && eq(r.channel_id, p[1]) && eq(r.message_id, p[2])).map((r) => ({ id: r.id }));
    }
    // Generic fallback for every other table the dashboard touches.
    if (/^\s*SELECT/i.test(sql)) return [];
    return { affectedRows: 1 };
  },
  // 1.15.39: insertMappingRow() now uses queryDetailed() (same SQL, but
  // the real error is returned instead of swallowed). Mirrors the real
  // implementation: a duplicate INSERT becomes { rows: null, error }.
  queryDetailed: async (sql, params = []) => {
    queriesSeen.push({ sql, params: [...params] });
    const p = params.map((v) => (v === undefined ? null : v));
    if (sql.startsWith('INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id)')) {
      const [g, c, m, e, r] = p;
      if (table.some((row) => eq(row.guild_id, g) && eq(row.message_id, m) && eq(row.emoji, e))) {
        const msg = `Duplicate entry '${g}-${m}-${e}' for key 'uq_reaction_role'`;
        return { rows: null, error: { code: 'ER_DUP_ENTRY', errno: 1062, sqlMessage: msg, message: msg } };
      }
      table.push({ id: nextId++, guild_id: g, channel_id: c, message_id: m, emoji: e, role_id: r, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
      return { rows: { affectedRows: 1, insertId: nextId - 1 }, error: null };
    }
    return { rows: await fakeDb.query(sql, params), error: null };
  },
};

// --- Fake Discord REST (axios shape) ---------------------------------------
const channels = [
  { id: CHANNEL, name: 'choose-your-rank', type: 0 },
  { id: '1571556681320632521', name: 'staff-council', type: 0 },
  { id: '1571556681320632522', name: 'member-reports', type: 0 },
  { id: '1571556681320632523', name: 'announcements', type: 0 },
];
const roles = [
  { id: GUILD, name: '@everyone' },
  { id: PC, name: 'PC Warrior' },
  { id: YT, name: 'YouTube Creator' },
  { id: XBOX, name: 'Xbox Warrior' },
  { id: '444444444444444444', name: 'PlayStation Warrior' },
  { id: '555555555555555555', name: 'Nintendo Wanderer' },
  { id: '666666666666666666', name: 'Twitch Creator' },
  { id: '777777777777777777', name: 'TikTok Creator' },
  { id: '888888888888888888', name: 'Variety Gamer' },
  { id: '999999999999999998', name: 'Norse Lore Seeker' },
  { id: '101010101010101010', name: 'Late-Night Raven' },
  { id: '121212121212121212', name: "Raven's Herald" },
];
const patched = [];
const fakeApi = {
  get: async (url) => {
    if (url === '/users/@me/guilds') return { data: [{ id: GUILD, name: "THE VIKING'S LONGHOUSE", permissions: '32' }] };
    if (url === `/guilds/${GUILD}`) return { data: { id: GUILD } };
    if (url === `/guilds/${GUILD}/channels`) return { data: channels };
    if (url === `/guilds/${GUILD}/roles`) return { data: roles };
    if (url === `/guilds/${GUILD}/emojis`) return { data: [] };
    if (url === `/channels/${CHANNEL}/messages/${MESSAGE}`) return { data: { id: MESSAGE, channel_id: CHANNEL, author: { id: BOT_ID } } };
    console.log('[fakeApi] UNEXPECTED GET', url);
    return { data: {} };
  },
  post: async () => ({ data: {} }),
  patch: async (url, body) => { patched.push({ url, body }); return { data: {} }; },
  delete: async () => ({ data: {} }),
  put: async () => ({ data: {} }),
};
function axiosStub() { return fakeApi; }
axiosStub.create = () => fakeApi;
axiosStub.get = fakeApi.get;
axiosStub.post = fakeApi.post;
axiosStub.patch = fakeApi.patch;
axiosStub.delete = fakeApi.delete;
axiosStub.put = fakeApi.put;

// --- Fake config ------------------------------------------------------------
const fakeConfig = {
  token: 'test-token',
  clientId: BOT_ID,
  setupComplete: true,
  dashboard: { port: PORT, sessionSecret: SECRET, redirectUri: `http://localhost:${PORT}/callback`, publicUrl: '', invitePermissions: 1099951041558 },
  database: { host: '127.0.0.1', port: 3306, user: 'test', password: 'test', database: 'test' },
  _whereToGetKeys: {},
};

// --- Fake session store (my own MemoryStore so I can seed the session) -----
const myStore = new session.MemoryStore();
const fakeSessionStore = {
  SESSION_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000,
  createSessionStore: () => myStore,
};

// --- Inject stubs into require cache BEFORE dashboard.js loads -------------
function stubModule(resolvedPath, exportsObj) {
  require.cache[resolvedPath] = { id: resolvedPath, filename: resolvedPath, loaded: true, exports: exportsObj };
}
stubModule(require.resolve('../src/utils/database.js'), fakeDb);
stubModule(require.resolve('axios'), axiosStub);
stubModule(require.resolve('../src/utils/sessionStore.js'), fakeSessionStore);
stubModule(require.resolve('../src/utils/config.js'), fakeConfig);

const store = myStore;
store.set(SID, {
  cookie: { originalMaxAge: 30 * 24 * 60 * 60 * 1000, expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), httpOnly: true, path: '/' },
  user: { id: 'owner1', username: 'Ace', avatar: null },
  accessToken: 'test-access',
  refreshToken: null,
  tokenExpiresAt: Date.now() + 3600 * 1000,
}, () => {});

require('../src/dashboard.js');

const cookie = `connect.sid=s:${signature.sign(SID, SECRET)}`;
const base = `http://127.0.0.1:${PORT}`;

async function waitUp() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${base}/version`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

(async () => {
  const up = await waitUp();
  check('dashboard up', up === true);
  if (!up) { console.log(`${pass} passed, ${fail} failed`); process.exit(1); }
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  // 1) Exact single-add client body from the browser test.
  let res = await fetch(`${base}/api/guilds/${GUILD}/reaction-roles`, {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: CHANNEL, messageId: MESSAGE, emojiCustom: '', emojiUnicode: '🟢', roleId: XBOX }),
  });
  const singleBody = await res.text();
  check('single add 🟢 Xbox returns 200', res.status === 200, `status=${res.status} body=${singleBody}`);
  check('single add stored the mapping (table has 3)', table.length === 3, `table=${table.length}`);

  // 2) Exact bulk-add client body (the other 8, as the browser submitted).
  const bulk = [
    ['🔵', '444444444444444444'], ['🍄', '555555555555555555'], ['💜', '666666666666666666'],
    ['🎵', '777777777777777777'], ['🎲', '888888888888888888'], ['📜', '999999999999999998'],
    ['🌙', '101010101010101010'], ['🔔', '121212121212121212'],
  ].map(([emoji, roleId]) => ({ channelId: CHANNEL, messageId: MESSAGE, emojiCustom: '', emojiUnicode: emoji, roleId }));
  res = await fetch(`${base}/api/guilds/${GUILD}/reaction-roles`, {
    method: 'POST', headers, body: JSON.stringify({ mappings: bulk }),
  });
  const bulkBody = await res.text();
  let bulkJson = {};
  try { bulkJson = JSON.parse(bulkBody); } catch {}
  check('bulk add returns 200', res.status === 200, `status=${res.status} body=${bulkBody}`);
  check('bulk add saved all 8', bulkJson.saved === 8, `saved=${bulkJson.saved} body=${bulkBody}`);
  check('store now holds all 11 mappings', table.length === 11, `table=${table.length}`);

  // 3) True duplicate through the real route: named rejection.
  res = await fetch(`${base}/api/guilds/${GUILD}/reaction-roles`, {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: CHANNEL, messageId: MESSAGE, emojiCustom: '', emojiUnicode: '💻', roleId: PC }),
  });
  const dupBody = await res.text();
  check('true duplicate returns 400', res.status === 400, `status=${res.status} body=${dupBody}`);
  check('true duplicate error names the matched mapping', /mapping #\d+/.test(dupBody), dupBody);
  check('true duplicate did not create a second row', table.length === 11, `table=${table.length}`);

  // 4) /version shows the process start time (1.15.38).
  res = await fetch(`${base}/version`);
  const versionHtml = await res.text();
  check('/version renders 200', res.status === 200, `status=${res.status}`);
  check('/version shows the process start time', versionHtml.includes('Dashboard process started'), 'startedAt line missing');

  // 5) The settings list page shows all 11 mappings.
  res = await fetch(`${base}/guilds/${GUILD}/reactionroles`, { headers: { Cookie: cookie } });
  const listHtml = await res.text();
  check('list page renders 200', res.status === 200, `status=${res.status}`);
  // EJS escapes the apostrophe in "Raven's Herald" as &#39; in the HTML.
  const missingNames = ['PC Warrior', 'Xbox Warrior', 'PlayStation Warrior', 'Nintendo Wanderer', 'Twitch Creator', 'YouTube Creator', 'TikTok Creator', 'Variety Gamer', 'Norse Lore Seeker', 'Late-Night Raven', 'Raven&#39;s Herald'].filter((n) => !listHtml.includes(n));
  check('list page shows all 11 role names', missingNames.length === 0, `missing: ${missingNames.join(', ')}`);
  check('list page group header says 11 role(s)', /11 role\(s\)/.test(listHtml));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });

// Full-stack reproduction for 1.15.39: the REAL dashboard.js (Express app) +
// REAL reactionRoles.js, with a stubbed MySQL (exactly the 2 live rows) and
// stubbed Discord REST. The fake DB models the live column collation
// (utf8mb4_unicode_ci — see tmp/verify-1.15.39.js for the MariaDB 10.11
// measurements), so the real route reproduces the live failure, then the
// test flips the collation to utf8mb4_bin — what the startup migration
// (database.js runMigrations) does on the real server — and the same bulk
// add succeeds. Also proves a failed save is now recorded in the error log
// (INSERT INTO error_logs), which the live Staff Errors page previously
// had no row for at all.
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

// --- Fake DB: exactly the 2 live rows, collation-aware ----------------------
// utf8mb4_unicode_ci (UCA 4.0): every astral-plane emoji shares one weight,
// so the unique key (guild_id, message_id, emoji) rejects a second emoji
// for the same message with ER_DUP_ENTRY 1062. Only ▶️ (U+25B6, a pre-4.0
// shape with a real weight) compares different. utf8mb4_bin compares exact
// bytes. flipCollation('utf8mb4_bin') simulates the startup migration.
const table = [
  { id: 1, guild_id: GUILD, channel_id: CHANNEL, message_id: MESSAGE, emoji: '💻', role_id: PC, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
  { id: 2, guild_id: GUILD, channel_id: CHANNEL, message_id: MESSAGE, emoji: '▶️', role_id: YT, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
];
let nextId = 3;
let emojiCollation = 'utf8mb4_unicode_ci';
const queriesSeen = [];
const eq = (a, b) => String(a) === String(b);
function ucaWeight(emoji) {
  const cps = [...String(emoji)].filter((c) => c.codePointAt(0) !== 0xFE0F && c.codePointAt(0) !== 0xFE0E).map((c) => c.codePointAt(0));
  if (cps.length === 1 && cps[0] < 0x10000) return `bmp:${cps[0].toString(16)}`;
  return 'unweighted';
}
function collationEqual(a, b) {
  if (a === b) return true;
  if (emojiCollation === 'utf8mb4_bin') return false;
  return ucaWeight(a) === ucaWeight(b);
}
function dupError(g, m, e) {
  const msg = `Duplicate entry '${g}-${m}-${e}' for key 'uq_reaction_role'`;
  const err = new Error(msg);
  err.code = 'ER_DUP_ENTRY'; err.errno = 1062; err.sqlMessage = msg;
  return err;
}

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
  // Test hook: simulate the startup migration having run.
  __setEmojiCollation(c) { emojiCollation = c; },
  __emojiCollation() { return emojiCollation; },
  queryDetailed: async (sql, params = []) => {
    queriesSeen.push({ sql, params: [...params] });
    const p = params.map((v) => (v === undefined ? null : v));
    if (sql.startsWith('INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id)')) {
      const [g, c, m, e, r] = p;
      if (table.some((row) => eq(row.guild_id, g) && eq(row.message_id, m) && collationEqual(row.emoji, e))) {
        return { rows: null, error: (() => { const err = dupError(g, m, e); return { code: err.code, errno: err.errno, sqlMessage: err.sqlMessage, message: err.message }; })() };
      }
      table.push({ id: nextId++, guild_id: g, channel_id: c, message_id: m, emoji: e, role_id: r, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
      return { rows: { affectedRows: 1, insertId: nextId - 1 }, error: null };
    }
    return { rows: await fakeDb.query(sql, params), error: null };
  },
  query: async (sql, params = []) => {
    queriesSeen.push({ sql, params: [...params] });
    const p = params.map((v) => (v === undefined ? null : v));
    if (sql.startsWith('INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id)')) {
      const [g, c, m, e, r] = p;
      if (table.some((row) => eq(row.guild_id, g) && eq(row.message_id, m) && collationEqual(row.emoji, e))) return null; // ER_DUP_ENTRY swallowed
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
    if (sql.includes('FROM reaction_roles WHERE guild_id = ? ORDER BY message_id')) {
      return table.filter((r) => eq(r.guild_id, p[0])).map((r) => ({ ...r }));
    }
    if (sql.startsWith('SELECT emoji FROM reaction_roles WHERE guild_id = ? AND message_id = ?')) {
      return table.filter((r) => eq(r.guild_id, p[0]) && eq(r.message_id, p[1])).map((r) => ({ emoji: r.emoji }));
    }
    if (sql.startsWith('SELECT id FROM reaction_roles WHERE guild_id = ? AND channel_id = ? AND message_id = ?')) {
      return table.filter((r) => eq(r.guild_id, p[0]) && eq(r.channel_id, p[1]) && eq(r.message_id, p[2])).map((r) => ({ id: r.id }));
    }
    if (/^\s*SELECT/i.test(sql)) return [];
    return { affectedRows: 1 };
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

// --- Fake session store ------------------------------------------------------
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

const MISSING9 = [
  ['🟢', XBOX], ['🔵', '444444444444444444'], ['🍄', '555555555555555555'],
  ['💜', '666666666666666666'], ['🎵', '777777777777777777'], ['🎲', '888888888888888888'],
  ['📜', '999999999999999998'], ['🌙', '101010101010101010'], ['🔔', '121212121212121212'],
];

(async () => {
  const up = await waitUp();
  check('dashboard up', up === true);
  if (!up) { console.log(`${pass} passed, ${fail} failed`); process.exit(1); }
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  // 1) Pre-migration: single add of 🟢 fails with the surfaced MySQL error.
  let res = await fetch(`${base}/api/guilds/${GUILD}/reaction-roles`, {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: CHANNEL, messageId: MESSAGE, emojiCustom: '', emojiUnicode: '🟢', roleId: XBOX }),
  });
  let body = await res.text();
  check('pre-migration: single add 🟢 returns 500', res.status === 500, `status=${res.status} body=${body}`);
  check('pre-migration: single-add error names MySQL 1062 (ER_DUP_ENTRY)', /MySQL 1062 \(ER_DUP_ENTRY\)/.test(body), body);
  check('pre-migration: single add stored nothing (table still 2)', table.length === 2, `table=${table.length}`);

  // 2) Pre-migration: bulk re-add of the 9 fails the same way, honestly.
  const bulk = MISSING9.map(([emoji, roleId]) => ({ channelId: CHANNEL, messageId: MESSAGE, emojiCustom: '', emojiUnicode: emoji, roleId }));
  res = await fetch(`${base}/api/guilds/${GUILD}/reaction-roles`, {
    method: 'POST', headers, body: JSON.stringify({ mappings: bulk }),
  });
  body = await res.text();
  let bulkJson = {};
  try { bulkJson = JSON.parse(body); } catch {}
  check('pre-migration: bulk add returns 200 with per-row results', res.status === 200, `status=${res.status} body=${body}`);
  check('pre-migration: bulk saved 0 of 9', bulkJson.saved === 0, `saved=${bulkJson.saved} body=${body}`);
  check('pre-migration: all 9 per-row errors name MySQL 1062 (ER_DUP_ENTRY)',
    Array.isArray(bulkJson.results) && bulkJson.results.length === 9 && bulkJson.results.every((r) => !r.ok && /MySQL 1062 \(ER_DUP_ENTRY\)/.test(r.error || '')),
    body);
  check('pre-migration: table still holds only the 2 live rows', table.length === 2, `table=${table.length}`);
  check('failed saves were recorded in the error log (INSERT INTO error_logs ran)',
    queriesSeen.some((q) => /INSERT INTO error_logs/i.test(q.sql)),
    JSON.stringify(queriesSeen.map((q) => q.sql).filter((s) => /error_logs/i.test(s))));

  // 3) Simulate the startup migration, then the same bulk add succeeds.
  fakeDb.__setEmojiCollation('utf8mb4_bin');
  check('migration simulated: collation is now utf8mb4_bin', fakeDb.__emojiCollation() === 'utf8mb4_bin');
  res = await fetch(`${base}/api/guilds/${GUILD}/reaction-roles`, {
    method: 'POST', headers, body: JSON.stringify({ mappings: bulk }),
  });
  body = await res.text();
  try { bulkJson = JSON.parse(body); } catch { bulkJson = {}; }
  check('post-migration: bulk add returns 200', res.status === 200, `status=${res.status} body=${body}`);
  check('post-migration: bulk saved all 9', bulkJson.saved === 9, `saved=${bulkJson.saved} body=${body}`);
  check('post-migration: store now holds all 11 mappings', table.length === 11, `table=${table.length}`);

  // 4) True duplicate through the real route is still a named 400.
  res = await fetch(`${base}/api/guilds/${GUILD}/reaction-roles`, {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: CHANNEL, messageId: MESSAGE, emojiCustom: '', emojiUnicode: '💻', roleId: PC }),
  });
  body = await res.text();
  check('true duplicate returns 400', res.status === 400, `status=${res.status} body=${body}`);
  check('true duplicate error names the matched mapping', /mapping #\d+/.test(body), body);
  check('true duplicate did not create a second row', table.length === 11, `table=${table.length}`);

  // 5) /version + list page still behave (1.15.38 regressions).
  res = await fetch(`${base}/version`);
  const versionHtml = await res.text();
  check('/version renders 200', res.status === 200, `status=${res.status}`);
  check('/version shows the process start time', versionHtml.includes('Dashboard process started'), 'startedAt line missing');
  res = await fetch(`${base}/guilds/${GUILD}/reactionroles`, { headers: { Cookie: cookie } });
  const listHtml = await res.text();
  check('list page renders 200', res.status === 200, `status=${res.status}`);
  const missingNames = ['PC Warrior', 'Xbox Warrior', 'PlayStation Warrior', 'Nintendo Wanderer', 'Twitch Creator', 'YouTube Creator', 'TikTok Creator', 'Variety Gamer', 'Norse Lore Seeker', 'Late-Night Raven', 'Raven&#39;s Herald'].filter((n) => !listHtml.includes(n));
  check('list page shows all 11 role names', missingNames.length === 0, `missing: ${missingNames.join(', ')}`);
  check('list page group header says 11 role(s)', /11 role\(s\)/.test(listHtml));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });

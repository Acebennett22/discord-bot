// Verify 1.15.39: reaction-role INSERTs fail on the emoji collation.
//
// ROOT CAUSE, verified on a real MariaDB 10.11 server against the exact
// schema in sql/schema.sql (not guessed): reaction_roles.emoji is
// utf8mb4_unicode_ci (UCA 4.0), under which every emoji added after
// Unicode 4.0 has the SAME collation weight — so the UNIQUE KEY
// (guild_id, message_id, emoji) rejects a second emoji for the same
// message with ER_DUP_ENTRY 1062 even though the emoji is different.
// Measured: '💻' = '🟢' = '🔵' = '🍄' = '🎵' = '🔔' -> 1 under
// utf8mb4_unicode_ci (all 0 under utf8mb4_bin); '💻' = '▶️' -> 0, because
// ▶️ (U+25B6) is a pre-4.0 geometric shape with a real DUCET weight. The
// 11-row bulk add against the exact table stored exactly rows 1 (💻) and
// 6 (▶️) and failed the other 9 with ERROR 1062 — the exact live pattern.
//
// The fake DB below models that collation faithfully (ucaWeight), so the
// reproduction runs through the REAL reactionRoles.js code paths:
//   - pre-fix DB state (emoji collation utf8mb4_unicode_ci): bulk 11
//     stores exactly rows 1 and 6; the other 9 fail, and the failure now
//     surfaces the real MySQL error (MySQL 1062 (ER_DUP_ENTRY) ...) in
//     the API error, the dashboard console, instead of the generic
//     "could not be saved" with the cause lost.
//   - the migration (runMigrations, also run by initDatabase) flips the
//     column to utf8mb4_bin; after it, the same bulk add stores all 11.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.39.js
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const mysql = require('mysql2/promise');
const fs = require('fs');

const GUILD = '1571439343976058970';
const CH = '1571556681320632520'; // #choose-your-rank
const MSG = '1571727320597663745'; // Choose Your Path embed (final version)
const BOT_ID = '333333333333333333';

const ELEVEN = [
  ['💻', 'PC Warrior', '555555555555555551'],
  ['🟢', 'Xbox Warrior', '555555555555555552'],
  ['🔵', 'PlayStation Warrior', '555555555555555553'],
  ['🍄', 'Nintendo Wanderer', '555555555555555554'],
  ['💜', 'Twitch Creator', '555555555555555555'],
  ['▶️', 'YouTube Creator', '555555555555555556'],
  ['🎵', 'TikTok Creator', '555555555555555557'],
  ['🎲', 'Variety Gamer', '555555555555555558'],
  ['📜', 'Norse Lore Seeker', '555555555555555559'],
  ['🌙', 'Late-Night Raven', '555555555555555560'],
  ['🔔', "Raven's Herald", '555555555555555561'],
];

// --- Collation model (measured on MariaDB 10.11.14, exact schema) ---------
// utf8mb4_unicode_ci is UCA 4.0: code points with no DUCET entry share one
// weight. Every astral-plane emoji in play (U+1F300+) is unweighted, so
// they all compare equal to each other; ▶️ (U+25B6, variation selector
// ignored at the primary level) has a real weight and compares different.
// utf8mb4_bin compares exact bytes, so nothing but identical strings are
// equal. This is the whole bug: the unique key uses the column collation,
// while every JS-side check in the repo uses exact string equality.
let emojiCollation = 'utf8mb4_unicode_ci';
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

// --- Fake pool (same mysql2 mimicry as verify-1.15.37/38.js) ---------------
const table = [];
let nextId = 100;
const executed = [];
const patches = [];
const failInsertEmojis = new Set();
const zeroAffectedEmojis = new Set();
const hideFromCrossCheck = new Set();
let failCrossCheckRead = false;

const fakeConn = {
  async ping() {},
  release() {},
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  async execute(sql, params) { return fakeExecute(sql, params); },
};

async function fakeExecute(sql, params = []) {
  const p = params || [];
  executed.push({ sql, params: [...p] });
  for (const v of p) {
    if (v === undefined) throw new TypeError('Bind parameters must not contain undefined. To pass SQL NULL specify JS null');
  }
  if (/SELECT COLLATION_NAME FROM INFORMATION_SCHEMA/.test(sql)) {
    return [[{ COLLATION_NAME: emojiCollation }], undefined];
  }
  if (/FROM INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }], undefined];
  if (/^CREATE TABLE/i.test(sql)) return [[], undefined];
  if (/ALTER TABLE `reaction_roles` MODIFY `emoji`/.test(sql)) {
    emojiCollation = 'utf8mb4_bin';
    return [{ affectedRows: 0 }, undefined];
  }
  if (/SELECT \* FROM reaction_roles WHERE message_id/.test(sql)) {
    return [table.filter((r) => r.message_id === p[0]), undefined];
  }
  if (/SELECT id, message_id, channel_id, emoji, role_id, required_role_id, min_days_in_server, min_level FROM reaction_roles WHERE guild_id/.test(sql)) {
    return [table.filter((r) => r.guild_id === p[0]).map((r) => ({ ...r })), undefined];
  }
  if (/SELECT emoji FROM reaction_roles WHERE guild_id/.test(sql)) {
    if (failCrossCheckRead) throw new Error('Connection lost');
    return [table.filter((r) => r.guild_id === p[0] && r.message_id === p[1] && !hideFromCrossCheck.has(r.emoji)).map((r) => ({ emoji: r.emoji })), undefined];
  }
  if (/INSERT INTO reaction_roles/.test(sql)) {
    const [guild_id, channel_id, message_id, emoji, role_id] = p;
    if (failInsertEmojis.has(emoji)) throw new Error('Connection lost during INSERT');
    // The unique key compares with the COLUMN COLLATION, not byte equality.
    if (table.some((r) => r.guild_id === guild_id && r.message_id === message_id && collationEqual(r.emoji, emoji))) {
      const msg = `Duplicate entry '${guild_id}-${message_id}-${emoji}' for key 'uq_reaction_role'`;
      const e = new Error(msg);
      e.code = 'ER_DUP_ENTRY'; e.errno = 1062; e.sqlMessage = msg;
      throw e;
    }
    if (zeroAffectedEmojis.has(emoji)) return [{ affectedRows: 0, insertId: 0 }, undefined];
    const row = { id: nextId++, guild_id, channel_id, message_id, emoji, role_id, enabled: 1 };
    table.push(row);
    return [{ insertId: row.id, affectedRows: 1 }, undefined];
  }
  if (/UPDATE reaction_roles SET channel_id/.test(sql)) {
    let changed = 0;
    for (const r of table) {
      if (r.guild_id === p[1] && r.message_id === p[2] && r.emoji === p[3] && r.channel_id !== p[0]) { r.channel_id = p[0]; changed++; }
    }
    return [{ affectedRows: changed }, undefined];
  }
  if (/DELETE FROM reaction_roles/.test(sql)) {
    const before = table.length;
    for (let i = table.length - 1; i >= 0; i--) {
      if (table[i].guild_id === p[0] && table[i].message_id === p[1] && table[i].emoji === p[2]) table.splice(i, 1);
    }
    return [{ affectedRows: before - table.length }, undefined];
  }
  return [[], undefined];
}

const fakePool = {
  async getConnection() { return fakeConn; },
  async execute(sql, params) { return fakeExecute(sql, params); },
  async end() {},
};
mysql.createPool = () => fakePool;

const config = require('../src/utils/config');
config.database = { host: '127.0.0.1', user: 'test', password: 'test-password', database: 'test' };
config.clientId = BOT_ID;

const db = require('../src/utils/database');
const rr = require('../src/utils/reactionRoles');

const discord = {
  listGuildEmojis: async () => [],
  listGuildRoles: async () => ELEVEN.map(([, name, id]) => ({ id, name })),
  getMessage: async () => ({ author: { id: BOT_ID } }),
  patchMessage: async (channelId, messageId, body) => {
    patches.push({ channelId, messageId, components: body.components });
    return { id: messageId };
  },
};

function seed(rows) {
  table.length = 0;
  patches.length = 0;
  failInsertEmojis.clear();
  zeroAffectedEmojis.clear();
  hideFromCrossCheck.clear();
  failCrossCheckRead = false;
  for (const r of rows) table.push({ enabled: 1, ...r });
}
const row11 = ([emoji, , roleId]) => ({ channelId: CH, messageId: MSG, emoji, roleId });
const patchButtons = () => patches.flatMap((p) => p.components).flatMap((r) => r.components || []);
const alterCount = () => executed.filter((q) => /ALTER TABLE `reaction_roles` MODIFY/.test(q.sql)).length;

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Capture the dashboard-console lines the insert path writes on failure.
const errorLines = [];
const origError = console.error;
console.error = (...args) => { errorLines.push(args.join(' ')); origError(...args); };

(async () => {
  // --- 0. The migration fires on startup ----------------------------------
  console.log('== migration: initDatabase flips the collation ==');
  const ok = await db.initDatabase();
  check('initDatabase enables the DB against the fake pool', ok === true && db.isEnabled());
  check('startup migration issued the ALTER for the emoji collation', alterCount() === 1, `alters=${alterCount()}`);
  check('startup migration flipped the collation to utf8mb4_bin', emojiCollation === 'utf8mb4_bin', emojiCollation);

  // Simulate the pre-fix live table for the reproduction below: the live
  // server still has utf8mb4_unicode_ci until its restart runs the
  // migration. (The migration itself is already proven by the checks
  // above; the rest of this script runs against the old collation, then
  // runs the migration again and proves the fix.)
  emojiCollation = 'utf8mb4_unicode_ci';

  // --- 1. Reproduction: the exact live failure, through the real code -----
  console.log('== reproduction: bulk 11 on utf8mb4_unicode_ci ==');
  seed([]);
  errorLines.length = 0;
  const res1 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: ELEVEN.map(row11) }, discord);
  check('repro: exactly rows 1 (💻) and 6 (▶️) ok, the other 9 failed',
    res1[0].ok && res1[5].ok && res1.filter((r) => !r.ok).length === 9, JSON.stringify(res1.map((r) => r.ok)));
  check('repro: failed rows report the real MySQL error (1062 ER_DUP_ENTRY)',
    res1.filter((r) => !r.ok).every((r) => /MySQL 1062 \(ER_DUP_ENTRY\)/.test(r.error || '') && /could not be saved/.test(r.error || '')),
    JSON.stringify(res1.filter((r) => !r.ok).map((r) => r.error)));
  check('repro: saved count is 2, not 11', res1.filter((r) => r.ok).length === 2);
  check('repro: only 2 rows in the table (💻 and ▶️)', table.length === 2 && table.some((r) => r.emoji === '💻') && table.some((r) => r.emoji === '▶️'), JSON.stringify(table.map((r) => r.emoji)));
  check('repro: refresh PATCH carries exactly 2 buttons', patchButtons().length === 2, `buttons=${patchButtons().length}`);
  const insertLog = errorLines.find((l) => l.includes('[reaction-roles] INSERT failed'));
  check('repro: the INSERT failure was logged to console.error with the MySQL error',
    !!insertLog && insertLog.includes('MySQL 1062 (ER_DUP_ENTRY)') && insertLog.includes('Duplicate entry'),
    insertLog || JSON.stringify(errorLines));
  check('repro: the log line carries the emoji code points (e.g. U+1F7E2 for 🟢)',
    !!insertLog && insertLog.includes('U+1F7E2'), insertLog || '');
  check('repro: the log line carries the SQL and parameters',
    !!insertLog && insertLog.includes('INSERT INTO reaction_roles') && insertLog.includes(GUILD), insertLog || '');

  // Single add of 🟢 against the same 2-row store, same failure class.
  seed([
    { id: 1, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
    { id: 2, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '▶️', role_id: '555555555555555556' },
  ]);
  errorLines.length = 0;
  let threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '🟢', roleId: '555555555555555552', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('repro: single add of 🟢 fails (500, not a false 400 duplicate)',
    threw && threw.status === 500 && /MySQL 1062 \(ER_DUP_ENTRY\)/.test(threw.message), threw && `${threw.status}: ${threw.message}`);
  check('repro: single add stored nothing new', table.length === 2, `table=${table.length}`);

  // --- 2. The migration, run explicitly, is idempotent ---------------------
  console.log('== migration: runMigrations flips + is a no-op second time ==');
  const altersBefore = alterCount();
  await db.runMigrations('test');
  check('migration: the ALTER ran once more', alterCount() === altersBefore + 1, `alters=${alterCount()} before=${altersBefore}`);
  check('migration: collation is now utf8mb4_bin', emojiCollation === 'utf8mb4_bin', emojiCollation);
  await db.runMigrations('test');
  check('migration: second run issues no further ALTER', alterCount() === altersBefore + 1, `alters=${alterCount()}`);

  // --- 3. Post-fix: the same bulk add now stores all 11 --------------------
  console.log('== post-fix: re-add the 9 from the 2-row store ==');
  const res3 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: ELEVEN.filter(([e]) => e !== '💻' && e !== '▶️').map(row11) }, discord);
  check('post-fix: all 9 missing mappings succeed', res3.every((r) => r.ok), JSON.stringify(res3.filter((r) => !r.ok)));
  check('post-fix: table now holds all 11 mappings', table.length === 11, `table=${table.length}`);
  check('post-fix: list read returns all 11', (await rr.listGuildMappings(GUILD)).length === 11);
  check('post-fix: refresh PATCH carries 11 buttons', patchButtons().length === 11, `buttons=${patchButtons().length}`);

  console.log('== post-fix: bulk 11 from empty ==');
  seed([]);
  const res3b = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: ELEVEN.map(row11) }, discord);
  check('post-fix: bulk 11 from empty saves all 11', res3b.every((r) => r.ok) && table.length === 11, JSON.stringify(res3b.filter((r) => !r.ok)));

  // --- 4. True duplicates / repair / cross-message still behave ------------
  console.log('== exact duplicate, role change, repair, cross-message ==');
  seed([
    { id: 1, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
    { id: 2, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '▶️', role_id: '555555555555555556' },
  ]);
  threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555551', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('exact duplicate: still rejected as already mapped (named)',
    threw && threw.status === 400 && /already mapped on this message \(mapping #1/.test(threw.message), threw && `${threw.status}: ${threw.message}`);
  check('exact duplicate: no second row created', table.length === 2);
  // Same emoji, different role: still a duplicate, not a save error.
  threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555552', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('role change via add: still rejected as already mapped',
    threw && threw.status === 400 && /already mapped/.test(threw.message), threw && `${threw.status}: ${threw.message}`);
  // Wrong-channel row is repaired, not blocked.
  seed([
    { id: 1, guild_id: GUILD, channel_id: '1571556681320632521', message_id: MSG, emoji: '🟢', role_id: '555555555555555552' },
  ]);
  threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '🟢', roleId: '555555555555555552', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('wrong-channel repair: add succeeds by re-keying the channel', threw === null, threw && `${threw.status}: ${threw.message}`);
  check('wrong-channel repair: stored channel is now the right one', table[0].channel_id === CH, table[0]?.channel_id);
  // Same emoji on a different message adds cleanly.
  seed([
    { id: 1, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
  ]);
  threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: '1571727320597663746', emoji: '💻', roleId: '555555555555555551', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('same emoji on a different message: adds cleanly', threw === null && table.length === 2, threw && `${threw.status}: ${threw.message}`);

  // --- 5. A non-duplicate INSERT failure still 500s with the reason -------
  console.log('== non-duplicate INSERT failure ==');
  seed([]);
  failInsertEmojis.add('💻');
  threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555551', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('failing INSERT: 500 with the surfaced reason',
    threw && threw.status === 500 && /could not be saved/.test(threw.message) && /Connection lost during INSERT/.test(threw.message),
    threw && `${threw.status}: ${threw.message}`);
  check('failing INSERT: stored nothing', table.length === 0);

  seed([]);
  zeroAffectedEmojis.add('💻');
  threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555551', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('affectedRows 0: still 500 could-not-be-saved',
    threw && threw.status === 500 && /could not be saved/.test(threw.message), threw && `${threw.status}: ${threw.message}`);

  // --- 6. Source checks ------------------------------------------------------
  console.log('== source checks ==');
  const schema = fs.readFileSync('sql/schema.sql', 'utf8');
  check('schema.sql: reaction_roles.emoji is utf8mb4_bin',
    /emoji VARCHAR\(64\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/.test(schema));
  const dbSrc = fs.readFileSync('src/utils/database.js', 'utf8');
  check('database.js: queryDetailed exists and returns { rows, error }',
    /async function queryDetailed/.test(dbSrc) && /return \{ rows, error/.test(dbSrc));
  check('database.js: startup migration checks the emoji collation',
    /ensureReactionRolesEmojiCollation/.test(dbSrc) && /COLLATION_NAME FROM INFORMATION_SCHEMA/.test(dbSrc));
  check('database.js: migration ALTERs the emoji column to utf8mb4_bin',
    /MODIFY `emoji` VARCHAR\(64\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/.test(dbSrc));
  const rrSrc = fs.readFileSync('src/utils/reactionRoles.js', 'utf8');
  check('reactionRoles.js: insertMappingRow uses queryDetailed',
    /await db\.queryDetailed\(\s*\n?\s*'INSERT INTO reaction_roles/.test(rrSrc));
  check('reactionRoles.js: INSERT failure logs SQL + params to console.error',
    /\[reaction-roles\] INSERT failed/.test(rrSrc) && /INSERT INTO reaction_roles \(guild_id, channel_id, message_id, emoji, role_id\)/.test(rrSrc));
  const dashSrc = fs.readFileSync('src/dashboard.js', 'utf8');
  check('dashboard.js: failed saves are logged to errorLogger (single + bulk)',
    (dashSrc.match(/errorLogger\.log\(\{ level: 'error', guildId, commandName: 'reactionroles-add'/g) || []).length === 2,
    `occurrences=${(dashSrc.match(/errorLogger\.log\(\{ level: 'error', guildId, commandName: 'reactionroles-add'/g) || []).length}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });

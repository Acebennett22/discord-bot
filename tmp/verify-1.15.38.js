// Verify 1.15.38: the duplicate check reads the same rows as the list.
//
// Finding: two full-stack reproductions (unit mock through the real
// reactionRoles.js, and the real Express route with a stubbed DB holding
// exactly the 2 live rows) both proved the repo code at 1.15.37 is CORRECT
// for the live inputs — a single add of 🟢 succeeds and a bulk re-add of
// the 9 succeeds. The live false duplicate ("That emoji is already mapped
// on this message." while the list showed only 2 rows) cannot be produced
// by any repo version's check: every version's check requires a stored row
// matching (guild, channel, message, emoji), and the live table holds
// exactly 2 rows (confirmed independently by the bot's /reactionroles-list
// and the dashboard list). The live cause is therefore a deployment
// difference — almost certainly a stale dashboard process. Note /version
// cannot rule that out: it requires package.json inside the handler, so
// it reads the file on disk on first request, not the process's code.
//
// 1.15.38 therefore does two things:
//   1. The duplicate check (and the insert lookup) now read the SAME
//      guild-wide rows the list shows (listGuildMappings) and match in
//      JS — one shared read, so check and list cannot disagree by
//      construction, whatever scoping drifted before.
//   2. Every duplicate rejection names the matched mapping (mapping #id,
//      role id) and logs the exact params (emoji code points included) to
//      the dashboard console, so a recurrence is diagnosable at once.
//   3. /version also shows the dashboard process start time, so a stale
//      process is visible on the page itself.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.38.js
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GUILD = '1571439343976058970';
const CH = '1571556681320632520'; // #choose-your-rank
const CH2 = '1571556681320632521'; // another text channel (wrong-key case)
const MSG = '1571727320597663745'; // Choose Your Path embed (final version)
const MSG2 = '1571727320597663746'; // an older copy of the same embed
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

// --- Fake pool (same mysql2 mimicry as verify-1.15.37.js) -------------------
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
  if (/FROM INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }], undefined];
  if (/^CREATE TABLE/i.test(sql)) return [[], undefined];
  if (/SELECT \* FROM reaction_roles WHERE message_id/.test(sql)) {
    return [table.filter((r) => r.message_id === p[0]), undefined];
  }
  if (/SELECT id, message_id, channel_id, emoji, role_id, required_role_id, min_days_in_server, min_level FROM reaction_roles WHERE guild_id/.test(sql)) {
    // Guild-wide list read (1.15.38) — shared by the duplicate check and
    // the list. Returns full row objects.
    return [table.filter((r) => r.guild_id === p[0]).map((r) => ({ ...r })), undefined];
  }
  if (/SELECT emoji FROM reaction_roles WHERE guild_id/.test(sql)) {
    if (failCrossCheckRead) throw new Error('Connection lost');
    return [table.filter((r) => r.guild_id === p[0] && r.message_id === p[1] && !hideFromCrossCheck.has(r.emoji)).map((r) => ({ emoji: r.emoji })), undefined];
  }
  if (/INSERT INTO reaction_roles/.test(sql)) {
    const [guild_id, channel_id, message_id, emoji, role_id] = p;
    if (failInsertEmojis.has(emoji)) throw new Error('Connection lost during INSERT');
    if (table.some((r) => r.guild_id === guild_id && r.message_id === message_id && r.emoji === emoji)) {
      const e = new Error("Duplicate entry for key 'uq_reaction_role'"); e.code = 'ER_DUP_ENTRY'; throw e;
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
  executed.length = 0;
  failInsertEmojis.clear();
  zeroAffectedEmojis.clear();
  hideFromCrossCheck.clear();
  failCrossCheckRead = false;
  for (const r of rows) table.push({ enabled: 1, ...r });
}
const row11 = ([emoji, , roleId]) => ({ channelId: CH, messageId: MSG, emoji, roleId });
const patchButtons = () => patches.flatMap((p) => p.components).flatMap((r) => r.components || []);

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Capture the diagnostic log lines the new code writes on rejections.
const errorLines = [];
const origError = console.error;
console.error = (...args) => { errorLines.push(args.join(' ')); };

(async () => {
  const ok = await db.initDatabase();
  check('initDatabase enables the DB against the fake pool', ok === true && db.isEnabled());

  // --- 1. The contradiction case, through the real code ---------------------
  console.log('== contradiction: 2 stored, add a 3rd ==');
  seed([
    { id: 1, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
    { id: 2, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '▶️', role_id: '555555555555555556' },
  ]);
  let threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '🟢', roleId: '555555555555555552', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('contradiction: single add of 🟢 to a 2-row message succeeds', threw === null, threw && `${threw.status}: ${threw.message}`);
  check('contradiction: store now holds 3 mappings', table.length === 3, `table=${table.length}`);
  const usedGuildRead = executed.some((q) => /SELECT id, message_id, channel_id, emoji, role_id, required_role_id/.test(q.sql));
  const usedOldDupSelect = executed.some((q) => /SELECT id FROM reaction_roles WHERE guild_id = \? AND channel_id/.test(q.sql));
  const usedOldLookup = executed.some((q) => /SELECT channel_id, role_id FROM reaction_roles WHERE guild_id/.test(q.sql));
  check('contradiction: the check ran the guild-wide list read', usedGuildRead, JSON.stringify(executed.map((q) => q.sql)));
  check('contradiction: no separately-scoped duplicate SELECT ran', !usedOldDupSelect);
  check('contradiction: no separate insert-lookup SELECT ran', !usedOldLookup);
  check('contradiction: refresh PATCH carries 3 buttons', patchButtons().length === 3, `buttons=${patchButtons().length}`);

  // --- 2. Full 11-row incident end to end ----------------------------------
  console.log('== incident end to end: bulk 11 from empty ==');
  seed([]);
  const res2 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: ELEVEN.map(row11) }, discord);
  check('incident: all 11 rows ok', res2.every((r) => r.ok), JSON.stringify(res2.filter((r) => !r.ok)));
  check('incident: 11 rows in the table', table.length === 11);
  check('incident: list read (guild-wide) returns all 11',
    (await rr.listGuildMappings(GUILD)).length === 11);
  check('incident: refresh PATCH carries 11 buttons', patchButtons().length === 11, `buttons=${patchButtons().length}`);

  // --- 3. Re-add the 9 missing from the 2-row store -------------------------
  console.log('== re-add the 9 missing ==');
  seed([
    { id: 1, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
    { id: 2, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '▶️', role_id: '555555555555555556' },
  ]);
  const missing9 = ELEVEN.filter(([e]) => e !== '💻' && e !== '▶️').map(row11);
  const res3 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: missing9 }, discord);
  check('re-add: all 9 missing mappings succeed (no false duplicates)', res3.every((r) => r.ok), JSON.stringify(res3.filter((r) => !r.ok)));
  check('re-add: table now holds all 11 mappings', table.length === 11, `table=${table.length}`);

  // --- 4. Exact duplicate: named rejection + diagnostic log -----------------
  console.log('== exact duplicate ==');
  seed([
    { id: 1, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
    { id: 2, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '▶️', role_id: '555555555555555556' },
  ]);
  errorLines.length = 0;
  threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555551', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('exact duplicate: still rejected as already mapped',
    threw && threw.status === 400 && /already mapped/.test(threw.message), threw && `${threw.status}: ${threw.message}`);
  check('exact duplicate: error names the matched mapping #1',
    threw && /mapping #1/.test(threw.message), threw && threw.message);
  check('exact duplicate: error names the matched role',
    threw && /555555555555555551/.test(threw.message), threw && threw.message);
  check('exact duplicate: no second row created', table.length === 2);
  const logLine = errorLines.find((l) => l.includes('[reaction-roles] duplicate rejected'));
  check('exact duplicate: a diagnostic line was logged to console.error', !!logLine, JSON.stringify(errorLines));
  check('exact duplicate: log line carries params + matched mapping',
    !!logLine && logLine.includes('guild=1571439343976058970') && logLine.includes('U+1F4BB') && logLine.includes('mapping #1') && logLine.includes('role=555555555555555551'),
    logLine || '');

  // Same emoji, different role: still a duplicate (role changes are not an add).
  seed([
    { id: 1, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
  ]);
  threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555552', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('role change via add: still rejected as already mapped (named)',
    threw && threw.status === 400 && /already mapped on this message \(mapping #1/.test(threw.message), threw && `${threw.status}: ${threw.message}`);
  check('role change via add: stored role unchanged', table[0].role_id === '555555555555555551');

  // --- 5. Same emoji on a different message is not a duplicate ---------------
  console.log('== same emoji, different message ==');
  seed([
    { id: 1, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
  ]);
  threw = null;
  try {
    await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG2, emoji: '💻', roleId: '555555555555555551', botUserId: BOT_ID }, discord);
  } catch (e) { threw = e; }
  check('different message: same emoji adds cleanly', threw === null, threw && `${threw.status}: ${threw.message}`);
  check('different message: table now holds 2 rows across messages', table.length === 2);

  // --- 6. Wrong-channel repair (same role) / rejection (different role) -----
  console.log('== wrong-channel repair ==');
  seed([
    { id: 20, guild_id: GUILD, channel_id: CH2, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
  ]);
  const res6 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: [row11(ELEVEN[0])] }, discord);
  check('wrong channel: re-add with the right channel succeeds (repaired, not duplicate)',
    res6.length === 1 && res6[0].ok === true, JSON.stringify(res6));
  check('wrong channel: stored channel_id is now the right channel',
    table.length === 1 && table[0].channel_id === CH, JSON.stringify(table));

  seed([
    { id: 21, guild_id: GUILD, channel_id: CH2, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
  ]);
  const res6b = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: [{ channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555552' }] }, discord);
  check('wrong channel, different role: still rejected as already mapped (named)',
    res6b.length === 1 && !res6b[0].ok && /already mapped on this message \(mapping #21/.test(res6b[0].error || ''), JSON.stringify(res6b));

  // --- 7. Persistence verification intact (1.15.37 behavior) ----------------
  console.log('== persistence verification intact ==');
  seed([]);
  failInsertEmojis.add('💻');
  threw = null;
  try { await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555551', botUserId: BOT_ID }, discord); } catch (e) { threw = e; }
  check('failing INSERT still throws 500 (not a false success)',
    threw && threw.status === 500 && /could not be saved/.test(threw.message), threw && `${threw.status}: ${threw.message}`);
  check('failing INSERT stored nothing', table.length === 0);

  // --- 8. /version startedAt + source checks ---------------------------------
  console.log('== /version startedAt + source checks ==');
  const dash = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.js'), 'utf8');
  check('/version: route passes process start time to the template',
    dash.includes('new Date(Date.now() - process.uptime() * 1000).toISOString()') && dash.includes('startedAt });'));
  const versionTpl = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'views', 'version.ejs'), 'utf8');
  check('/version: template shows the process start time (typeof-guarded)',
    versionTpl.includes('Dashboard process started') && versionTpl.includes("typeof startedAt !== 'undefined'"));
  const rrSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'reactionRoles.js'), 'utf8');
  check('helper: duplicate decision uses listGuildMappings (the list read)',
    rrSrc.includes('const stored = await listGuildMappings(guildId);'));
  check('helper: no separately-scoped duplicate SELECT remains',
    !rrSrc.includes('WHERE guild_id = ? AND channel_id = ? AND message_id = ? AND emoji = ?'));
  check('helper: no separate insert-lookup SELECT remains',
    !rrSrc.includes('SELECT channel_id, role_id FROM reaction_roles WHERE guild_id'));
  check('helper: insert still verifies affectedRows === 1', rrSrc.includes('affectedRows === 1'));
  check('helper: cross-check re-read still present',
    rrSrc.includes('SELECT emoji FROM reaction_roles WHERE guild_id = ? AND message_id = ?'));
  check('helper: wrong-channel rows are still re-keyed',
    rrSrc.includes('UPDATE reaction_roles SET channel_id = ?'));

  // --- 9. Full-stack: real dashboard route (separate process) ----------------
  console.log('== full-stack (real dashboard.js, stubbed DB/REST) ==');
  const full = spawnSync(process.execPath, [path.join(__dirname, 'fullstack-1.15.38.js')], { encoding: 'utf8' });
  process.stdout.write(full.stdout || '');
  if (full.stderr) process.stdout.write(full.stderr);
  check('full-stack: real-route test exits 0', full.status === 0, `exit=${full.status}`);

  console.error = origError;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });

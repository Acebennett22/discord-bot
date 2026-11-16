// Verify 1.15.37: bulk reaction-role add must verify mappings actually
// persisted — never report success for rows that did not save. Plus the
// duplicate-check / list contradiction from the live incident.
//
// Live incident: a bulk add of 11 mappings reported "11 added" with every
// row ✅, but only 2 were stored (PC Warrior 💻 and YouTube Creator ▶️ —
// rows 1 and 6). A later Refresh re-applied only 2 buttons. Then re-adding
// the 9 missing mappings to the same message failed with "0 added, 9
// failed" — every row "That emoji is already mapped on this message." —
// while the list still showed only 2 mappings for that message.
//
// Traced root causes (see code comments in src/utils/reactionRoles.js):
// 1. db.query() swallows every error and returns null, so insertMappingRow()
//    could never see an INSERT failure — its ER_DUP_ENTRY catch was dead
//    code in production, and addMappingsBatch() marked rows ok:true even
//    when the insert did not land.
// 2. The four reads of reaction_roles used four different scopings:
//    the duplicate check ignored channel_id, the list grouped by
//    (channel, message) while its header count filtered by message only
//    and its rows rendered flat with no per-group filter, the refresh
//    count required channel_id, and buildRows read by message only. Rows
//    stored under a wrong key were invisible as such, and the duplicate
//    check read a different truth than the list.
//
// NOTE (1.15.38): the duplicate check no longer runs its own SELECT — it
// reads the same guild-wide rows as the list (listGuildMappings) and the
// insert lookup was unified the same way. The fake below was updated for
// the new query shapes; every behavioral assertion in this file is
// unchanged and must still pass.
//
// The fake pool below mimics mysql2 (verified in node_modules): pool.execute
// throws TypeError('Bind parameters must not contain undefined...') on an
// undefined bind, returns an OkPacket object (with affectedRows) for
// INSERT/UPDATE, and enforces the UNIQUE KEY (guild_id, message_id, emoji).
// It also keeps a real in-memory reaction_roles table, so the tests prove
// rows are actually stored — not just that nothing throws.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.37.js
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const mysql = require('mysql2/promise');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const GUILD = '1571439343976058970';
const CH = '1571556681320632520'; // #choose-your-rank
const CH2 = '1571556681320632521'; // another text channel (wrong-key case)
const MSG = '1571727320597663745'; // Choose Your Path embed (final version)
const MSG2 = '1571727320597663746'; // an older copy of the same embed
const BOT_ID = '333333333333333333';
const MYSQL2_UNDEFINED_MSG = 'Bind parameters must not contain undefined. To pass SQL NULL specify JS null';

// The 11 Choose Your Path mappings, in the order the owner listed them.
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
const ROLE_NAMES = new Map(ELEVEN.map(([e, name, id]) => [id, name]));

// --- Fake pool ---------------------------------------------------------------
const table = []; // reaction_roles rows, snake_case exactly as mysql2 returns them
let nextId = 100;
const executed = [];
const patches = [];
const goneMessages = new Set();
// Failure injection, reset per test:
const failInsertEmojis = new Set(); // INSERT throws (db.query swallows -> null)
const zeroAffectedEmojis = new Set(); // INSERT returns affectedRows 0, no row
const hideFromCrossCheck = new Set(); // SELECT emoji hides these emojis
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
    if (v === undefined) throw new TypeError(MYSQL2_UNDEFINED_MSG);
  }
  if (/FROM INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }], undefined];
  if (/^CREATE TABLE/i.test(sql)) return [[], undefined];
  if (/SELECT \* FROM reaction_roles WHERE message_id/.test(sql)) {
    return [table.filter((r) => r.message_id === p[0]), undefined];
  }
  if (/SELECT id, message_id, channel_id, emoji, role_id, required_role_id, min_days_in_server, min_level FROM reaction_roles WHERE guild_id/.test(sql)) {
    // Guild-wide list read (1.15.38) — the duplicate check AND the list
    // read these rows, so they cannot disagree. Returns full row objects.
    return [table.filter((r) => r.guild_id === p[0]).map((r) => ({ ...r })), undefined];
  }
  if (/SELECT emoji FROM reaction_roles WHERE guild_id/.test(sql)) {
    // Post-refresh cross-check read (1.15.37).
    if (failCrossCheckRead) throw new Error('Connection lost');
    return [table.filter((r) => r.guild_id === p[0] && r.message_id === p[1] && !hideFromCrossCheck.has(r.emoji)).map((r) => ({ emoji: r.emoji })), undefined];
  }
  if (/INSERT INTO reaction_roles/.test(sql)) {
    const [guild_id, channel_id, message_id, emoji, role_id] = p;
    if (failInsertEmojis.has(emoji)) throw new Error('Connection lost during INSERT');
    // UNIQUE KEY (guild_id, message_id, emoji) — enforced like real MySQL.
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
  if (/FORCE_FAIL/.test(sql)) throw new Error('boom');
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
    if (goneMessages.has(messageId)) {
      const e = new Error('Unknown Message');
      e.response = { status: 404, data: { code: 10008, message: 'Unknown Message' } };
      throw e;
    }
    patches.push({ channelId, messageId, components: body.components });
    return { id: messageId };
  },
};

function seed(rows) {
  table.length = 0;
  patches.length = 0;
  goneMessages.clear();
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

(async () => {
  const ok = await db.initDatabase();
  check('initDatabase enables the DB against the fake pool', ok === true && db.isEnabled());

  // --- 1. The mechanism: db.query() swallows a failing INSERT --------------
  console.log('== mechanism: the swallow ==');
  seed([]);
  failInsertEmojis.add('💻');
  const swallowed = await db.query(
    'INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?, ?)',
    [GUILD, CH, MSG, '💻', '555555555555555551'],
  );
  check('a failing INSERT through db.query() returns null (the swallow)', swallowed === null, JSON.stringify(swallowed));
  check('the swallowed INSERT stored nothing', table.length === 0);

  // --- 2. insertMappingRow verifies persistence -----------------------------
  console.log('== insertMappingRow ==');
  seed([]);
  failInsertEmojis.add('💻');
  let threw = null;
  try { await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555551', botUserId: BOT_ID }, discord); } catch (e) { threw = e; }
  check('single add with failing INSERT throws instead of reporting success', threw !== null, 'no throw');
  check('single add with failing INSERT says the save failed (500)',
    threw && threw.status === 500 && /could not be saved/.test(threw.message), threw && `${threw.status}: ${threw.message}`);
  check('single add with failing INSERT stored nothing', table.length === 0);

  seed([]);
  zeroAffectedEmojis.add('💻');
  threw = null;
  try { await rr.addMapping({ guildId: GUILD, channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555551', botUserId: BOT_ID }, discord); } catch (e) { threw = e; }
  check('single add with affectedRows 0 throws 500', threw && threw.status === 500 && /could not be saved/.test(threw.message), threw && `${threw.status}: ${threw.message}`);
  check('single add with affectedRows 0 stored nothing', table.length === 0);

  // --- 3. Incident reproduction: 11-row batch, 9 inserts fail --------------
  console.log('== incident: 11-row batch, 9 inserts fail ==');
  seed([]);
  for (const [emoji] of ELEVEN) {
    if (emoji !== '💻' && emoji !== '▶️') failInsertEmojis.add(emoji);
  }
  const res3 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: ELEVEN.map(row11) }, discord);
  const saved3 = res3.filter((r) => r.ok).length;
  check('incident: exactly rows 1 (💻) and 6 (▶️) ok, the other 9 failed',
    res3[0].ok && res3[5].ok && res3.filter((r) => !r.ok).length === 9, JSON.stringify(res3.map((r) => r.ok)));
  check('incident: failed rows say the save failed (not ok)',
    res3.filter((r) => !r.ok).every((r) => /could not be saved|did not save/.test(r.error || '')), JSON.stringify(res3.filter((r) => !r.ok).map((r) => r.error)));
  check('incident: saved count is 2, not 11', saved3 === 2, `saved=${saved3}`);
  check('incident: only 2 rows in the table', table.length === 2, `table=${table.length}`);
  check('incident: refresh PATCH carries exactly 2 buttons', patchButtons().length === 2, `buttons=${patchButtons().length}`);
  check('incident: the 2 buttons are PC Warrior + YouTube Creator',
    patchButtons().some((b) => b.label === 'PC Warrior') && patchButtons().some((b) => b.label === 'YouTube Creator'),
    JSON.stringify(patchButtons().map((b) => b.label)));

  // --- 4. Fully-successful 11-row batch --------------------------------------
  console.log('== happy path: 11-row batch ==');
  seed([]);
  const res4 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: ELEVEN.map(row11) }, discord);
  check('happy path: all 11 rows ok', res4.every((r) => r.ok), JSON.stringify(res4.filter((r) => !r.ok)));
  check('happy path: saved is 11', res4.filter((r) => r.ok).length === 11);
  check('happy path: 11 rows in the table', table.length === 11);
  check('happy path: PATCH carries 11 buttons', patchButtons().length === 11, `buttons=${patchButtons().length}`);

  // --- 5. Cross-check: row hidden from the post-refresh read ----------------
  console.log('== cross-check ==');
  seed([]);
  hideFromCrossCheck.add('🎲');
  const res5 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: [
    row11(ELEVEN[0]), row11(ELEVEN[7]), row11(ELEVEN[1]),
  ] }, discord);
  check('cross-check: hidden row is reported failed, others ok',
    res5[0].ok && !res5[1].ok && res5[2].ok, JSON.stringify(res5));
  check('cross-check: hidden row says it did not save', /did not save/.test(res5[1].error || ''), res5[1].error);
  check('cross-check: no rollback — the hidden row is still in the table', table.length === 3, `table=${table.length}`);
  check('cross-check: PATCH still carried 3 buttons', patchButtons().length === 3, `buttons=${patchButtons().length}`);

  seed([]);
  failCrossCheckRead = true;
  const res5b = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: [row11(ELEVEN[0]), row11(ELEVEN[1])] }, discord);
  check('cross-check: unreadable verification says "could not be confirmed", not ok',
    res5b.every((r) => !r.ok && /could not be confirmed/.test(r.error || '')), JSON.stringify(res5b));
  check('cross-check: unreadable verification still leaves the rows stored', table.length === 2);

  // --- 6. Contradiction case: 2 stored, re-add the other 9 -----------------
  console.log('== contradiction: re-add the 9 missing ==');
  seed([
    { id: 1, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
    { id: 2, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '▶️', role_id: '555555555555555556' },
  ]);
  const missing9 = ELEVEN.filter(([e]) => e !== '💻' && e !== '▶️').map(row11);
  const res6 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: missing9 }, discord);
  check('re-add: all 9 missing mappings succeed (no false duplicates)', res6.every((r) => r.ok), JSON.stringify(res6.filter((r) => !r.ok)));
  check('re-add: table now holds all 11 mappings for the message', table.length === 11, `table=${table.length}`);
  check('re-add: refresh PATCH carries 11 buttons', patchButtons().length === 11, `buttons=${patchButtons().length}`);

  // --- 7. Phantom rows: same emoji lives on another message -----------------
  console.log('== phantom rows on another message ==');
  seed(ELEVEN.slice(0, 9).map(([emoji, , roleId], i) => (
    { id: 10 + i, guild_id: GUILD, channel_id: CH, message_id: MSG2, emoji, role_id: roleId }
  )));
  // Re-adding those 9 to MSG2 correctly fails as duplicates (they ARE there).
  const res7a = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: ELEVEN.slice(0, 9).map(([emoji, , roleId]) => ({ channelId: CH, messageId: MSG2, emoji, roleId })) }, discord);
  check('phantom: re-adding to the message they live on still 400s as duplicates',
    res7a.every((r) => !r.ok && /already mapped/.test(r.error || '')), JSON.stringify(res7a.map((r) => r.error)));
  // But adding the SAME 9 to the NEW message MSG succeeds — different
  // message, no conflict. (This is the re-add the owner actually wanted.)
  const res7b = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: ELEVEN.slice(0, 9).map(row11) }, discord);
  check('phantom: adding the same 9 to the new message succeeds', res7b.every((r) => r.ok), JSON.stringify(res7b.filter((r) => !r.ok)));
  check('phantom: table now holds 9 + 9 across the two messages', table.length === 18, `table=${table.length}`);

  // --- 8. Wrong-channel re-key ----------------------------------------------
  console.log('== wrong-channel repair ==');
  seed([
    { id: 20, guild_id: GUILD, channel_id: CH2, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
  ]);
  const res8 = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: [row11(ELEVEN[0])] }, discord);
  check('wrong channel: re-add with the right channel succeeds (repaired, not duplicate)',
    res8.length === 1 && res8[0].ok === true, JSON.stringify(res8));
  check('wrong channel: stored channel_id is now the right channel',
    table.length === 1 && table[0].channel_id === CH, JSON.stringify(table));
  check('wrong channel: no second row was created', table.length === 1);

  // Exact duplicate still 400s.
  seed([
    { id: 21, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
  ]);
  const res8b = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: [row11(ELEVEN[0])] }, discord);
  check('exact duplicate: still rejected as already mapped',
    res8b.length === 1 && !res8b[0].ok && /already mapped/.test(res8b[0].error || ''), JSON.stringify(res8b));
  check('exact duplicate: no second row created', table.length === 1);

  // Same emoji, different role: still a duplicate (role changes are not an add).
  seed([
    { id: 22, guild_id: GUILD, channel_id: CH, message_id: MSG, emoji: '💻', role_id: '555555555555555551' },
  ]);
  const res8c = await rr.addMappingsBatch({ guildId: GUILD, botUserId: BOT_ID, rows: [{ channelId: CH, messageId: MSG, emoji: '💻', roleId: '555555555555555552' }] }, discord);
  check('role change via add: still rejected as already mapped',
    res8c.length === 1 && !res8c[0].ok && /already mapped/.test(res8c[0].error || ''), JSON.stringify(res8c));
  check('role change via add: stored role unchanged', table[0].role_id === '555555555555555551');

  // --- 9. List rendering: rows grouped under their own header ---------------
  console.log('== list rendering (EJS) ==');
  const TEMPLATE = path.join(__dirname, '..', 'dashboard', 'views', 'settings.ejs');
  const locals = {
    guild: { id: GUILD, name: "THE VIKING'S LONGHOUSE", icon: null },
    saved: false, module: 'reactionroles', settings: {},
    channels: [{ id: CH, name: 'choose-your-rank', type: 0 }, { id: CH2, name: 'general', type: 0 }],
    roles: ELEVEN.map(([, name, id]) => ({ id, name })),
    reactionRoleMappings: [
      { id: 1, message_id: MSG, channel_id: CH, emoji: '💻', role_id: '555555555555555551', required_role_id: null, min_days_in_server: null, min_level: null },
      { id: 2, message_id: MSG, channel_id: CH, emoji: '▶️', role_id: '555555555555555556', required_role_id: null, min_days_in_server: null, min_level: null },
      ...ELEVEN.slice(0, 9).map(([emoji, , roleId], i) => (
        { id: 10 + i, message_id: MSG2, channel_id: CH, emoji, role_id: roleId, required_role_id: null, min_days_in_server: null, min_level: null }
      )),
    ],
    emojis: [],
  };
  const html = await ejs.renderFile(TEMPLATE, locals);
  const headerCount = (html.match(/message <code>\d+<\/code> · \d+ role\(s\)/g) || []).length;
  check('list: one group header per (channel, message) — 2 groups', headerCount === 2, `headers=${headerCount}`);
  check('list: MSG group header says 2 role(s), not the message-wide count',
    new RegExp(`message <code>${MSG}</code> · 2 role\\(s\\)`).test(html));
  check('list: MSG2 group header says 9 role(s)',
    new RegExp(`message <code>${MSG2}</code> · 9 role\\(s\\)`).test(html));
  const msgHeader = `message <code>${MSG}</code>`;
  const msg2Header = `message <code>${MSG2}</code>`;
  const msgSection = (html.split(msgHeader)[1] || '').split(msg2Header)[0];
  const msg2Section = html.split(msg2Header)[1] || '';
  check('list: rows for MSG appear under the MSG header (grouped, not flat)',
    msgSection.includes('PC Warrior · 💻') && msgSection.includes('YouTube Creator · ▶️'));
  check('list: rows for MSG2 appear under the MSG2 header, not the MSG one',
    msg2Section.includes('Xbox Warrior · 🟢') && !msgSection.includes('Xbox Warrior · 🟢'));

  // --- 10. Route + source checks ---------------------------------------------
  console.log('== route + source checks ==');
  const dash = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.js'), 'utf8');
  check('route: saved is counted from honest per-row results', dash.includes('const saved = results.filter((r) => r.ok).length;'));
  const rrSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'reactionRoles.js'), 'utf8');
  check('helper: duplicate check reads the same guild-wide rows as the list',
    rrSrc.includes('SELECT id, message_id, channel_id, emoji, role_id, required_role_id, min_days_in_server, min_level FROM reaction_roles WHERE guild_id = ? ORDER BY message_id'));
  check('helper: no separately-scoped duplicate SELECT remains',
    !rrSrc.includes('WHERE guild_id = ? AND channel_id = ? AND message_id = ? AND emoji = ?'));
  check('helper: duplicate rejections name the matched mapping',
    rrSrc.includes('(mapping #${dup.id}, role ${dup.role_id})'));
  check('helper: insert verifies affectedRows === 1', rrSrc.includes('affectedRows === 1'));
  check('helper: cross-check re-reads stored emojis after refresh',
    rrSrc.includes('SELECT emoji FROM reaction_roles WHERE guild_id = ? AND message_id = ?'));
  check('helper: wrong-channel rows are re-keyed, not rejected',
    rrSrc.includes('UPDATE reaction_roles SET channel_id = ?'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });

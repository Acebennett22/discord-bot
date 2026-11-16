// Verify 1.15.34: undefined bind params (bulk-delete shape mismatch +
// logCommand / query() hardening).
//
// The fake pool below mimics mysql2's own check (verified in
// node_modules/mysql2/lib/base/connection.js ~line 859): pool.execute
// throws TypeError('Bind parameters must not contain undefined...') when
// any bind param is undefined. It also keeps a real in-memory
// reaction_roles table, so the tests prove rows are actually deleted —
// not just that nothing throws.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.34.js
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const mysql = require('mysql2/promise');

const GUILD = '123';
const BOT_ID = '999';
const MYSQL2_UNDEFINED_MSG = 'Bind parameters must not contain undefined. To pass SQL NULL specify JS null';

// --- Fake pool ---------------------------------------------------------------
const table = []; // reaction_roles rows, snake_case exactly as mysql2 returns them
let nextId = 100;
const executed = []; // { sql, params } for every pool.execute call
const patches = []; // discord patchMessage calls
const goneMessages = new Set();

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
  // mysql2's own check (see node_modules source): undefined bind = throw.
  for (const v of p) {
    if (v === undefined) throw new TypeError(MYSQL2_UNDEFINED_MSG);
  }
  if (/FROM INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }], undefined];
  if (/^CREATE TABLE/i.test(sql)) return [[], undefined];
  if (/SELECT \* FROM reaction_roles WHERE message_id/.test(sql)) {
    return [table.filter((r) => r.message_id === p[0]), undefined];
  }
  if (/SELECT emoji FROM reaction_roles WHERE guild_id/.test(sql)) {
    return [table.filter((r) => r.guild_id === p[0] && r.message_id === p[1]).map((r) => ({ emoji: r.emoji })), undefined];
  }
  if (/SELECT id FROM reaction_roles WHERE guild_id/.test(sql)) {
    // 1.15.37: the duplicate check is scoped by channel too — params are
    // [guild, channel, message, emoji].
    return [table.filter((r) => r.guild_id === p[0] && r.channel_id === p[1] && r.message_id === p[2] && r.emoji === p[3]).map((r) => ({ id: r.id })), undefined];
  }
  if (/SELECT channel_id, role_id FROM reaction_roles WHERE guild_id/.test(sql)) {
    // 1.15.37: insertMappingRow's lookup — deliberately NOT channel-scoped.
    return [table.filter((r) => r.guild_id === p[0] && r.message_id === p[1] && r.emoji === p[2]).map((r) => ({ channel_id: r.channel_id, role_id: r.role_id })), undefined];
  }
  if (/UPDATE reaction_roles SET channel_id/.test(sql)) {
    // 1.15.37: channel re-key repair.
    let changed = 0;
    for (const r of table) {
      if (r.guild_id === p[1] && r.message_id === p[2] && r.emoji === p[3] && r.channel_id !== p[0]) { r.channel_id = p[0]; changed++; }
    }
    return [{ affectedRows: changed }, undefined];
  }
  if (/INSERT INTO reaction_roles/.test(sql)) {
    const row = { id: nextId++, guild_id: p[0], channel_id: p[1], message_id: p[2], emoji: p[3], role_id: p[4], enabled: 1 };
    table.push(row);
    // 1.15.37: insertMappingRow() verifies affectedRows === 1 — real mysql2
    // returns the OkPacket as a plain object (not an array) for INSERTs.
    return [{ insertId: row.id, affectedRows: 1 }, undefined];
  }
  if (/DELETE FROM reaction_roles/.test(sql)) {
    const before = table.length;
    for (let i = table.length - 1; i >= 0; i--) {
      if (table[i].guild_id === p[0] && table[i].message_id === p[1] && table[i].emoji === p[2]) table.splice(i, 1);
    }
    return [[{ affectedRows: before - table.length }], undefined];
  }
  if (/INSERT INTO command_logs/.test(sql)) return [[{ insertId: 1 }], undefined];
  if (/INSERT INTO (guild_stats|user_stats)/.test(sql)) return [[{}], undefined];
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
  for (const r of rows) table.push({ enabled: 1, ...r });
}

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

(async () => {
  const ok = await db.initDatabase();
  check('initDatabase enables the DB against the fake pool', ok === true && db.isEnabled());

  // 1. Mock fidelity: raw pool.execute throws mysql2's exact error on undefined.
  let threw = null;
  try { await fakePool.execute('SELECT 1', [undefined]); } catch (e) { threw = e; }
  check('mock pool throws mysql2 exact message on undefined param',
    threw instanceof TypeError && threw.message === MYSQL2_UNDEFINED_MSG);

  // 2. Old failure mode: the DELETE the old bulk-delete path ran — raw
  // snake_case row read as camelCase gives message_id = undefined.
  threw = null;
  try { await fakePool.execute('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?', [GUILD, undefined, '🔥']); } catch (e) { threw = e; }
  check('old bulk-delete DELETE (message_id undefined) throws the mysql2 error',
    threw instanceof TypeError && threw.message === MYSQL2_UNDEFINED_MSG);

  // 3. db.query() sanitizes: undefined param becomes NULL, no throw.
  const before3 = executed.length;
  const rows3 = await db.query('SELECT * FROM reaction_roles WHERE message_id = ?', [undefined]);
  check('query() with an undefined param executes instead of throwing',
    Array.isArray(rows3) && executed[before3].params[0] === null);

  // 4. Bulk delete with REALISTIC snake_case rows exactly as mysql2
  // returns them — the shape the old route passed in (the reported bug).
  seed([
    { id: 1, guild_id: GUILD, channel_id: '111', message_id: 'AAA', emoji: '🔥', role_id: '555' },
    { id: 2, guild_id: GUILD, channel_id: '111', message_id: 'AAA', emoji: '❄️', role_id: '556' },
    { id: 3, guild_id: GUILD, channel_id: '222', message_id: 'BBB', emoji: '🎵', role_id: '557' },
  ]);
  const snakeRows = table.map((r) => ({ ...r })); // raw DB rows, snake_case
  const res4 = await rr.removeMappingsBatch({ guildId: GUILD, rows: snakeRows }, discord);
  check('bulk delete with snake_case rows actually deletes all 3 rows', table.length === 0, `table has ${table.length} rows left`);
  check('bulk delete with snake_case rows returns ok:true for every row',
    res4.length === 3 && res4.every((r) => r.ok === true && r.messageGone === false), JSON.stringify(res4));
  check('bulk delete refreshes each affected message exactly once (2 messages → 2 patches)',
    patches.length === 2 && patches.some((p) => p.messageId === 'AAA') && patches.some((p) => p.messageId === 'BBB'),
    JSON.stringify(patches.map((p) => p.messageId)));
  check('bulk delete patches target the right channels',
    patches.some((p) => p.channelId === '111' && p.messageId === 'AAA') && patches.some((p) => p.channelId === '222' && p.messageId === 'BBB'));

  // 5. Message already gone from Discord: row still deleted, messageGone true.
  seed([{ id: 4, guild_id: GUILD, channel_id: '333', message_id: 'GONE', emoji: '🐺', role_id: '558' }]);
  goneMessages.add('GONE');
  const res5 = await rr.removeMappingsBatch({ guildId: GUILD, rows: table.map((r) => ({ ...r })) }, discord);
  check('bulk delete of a message-gone mapping still deletes the row', table.length === 0);
  check('bulk delete of a message-gone mapping reports ok:true + messageGone:true',
    res5.length === 1 && res5[0].ok === true && res5[0].messageGone === true, JSON.stringify(res5));

  // 6. Mixed shapes: one snake_case row + one camelCase row both delete.
  seed([
    { id: 5, guild_id: GUILD, channel_id: '111', message_id: 'CCC', emoji: '🔥', role_id: '555' },
    { id: 6, guild_id: GUILD, channel_id: '111', message_id: 'CCC', emoji: '❄️', role_id: '556' },
  ]);
  const mixed = [
    { ...table[0] }, // snake_case
    { id: 6, channelId: '111', messageId: 'CCC', emoji: '❄️' }, // camelCase
  ];
  const res6 = await rr.removeMappingsBatch({ guildId: GUILD, rows: mixed }, discord);
  check('bulk delete accepts mixed snake_case + camelCase rows', table.length === 0 && res6.every((r) => r.ok), JSON.stringify(res6));

  // 7. Single remove unchanged (camelCase, as the single-delete route passes).
  seed([{ id: 7, guild_id: GUILD, channel_id: '111', message_id: 'DDD', emoji: '🔥', role_id: '555' }]);
  const res7 = await rr.removeMapping({ guildId: GUILD, channelId: '111', messageId: 'DDD', emoji: '🔥' }, discord);
  check('single remove still deletes the row', table.length === 0);
  check('single remove still reports ok + refreshes once',
    res7.ok === true && res7.messageGone === false && patches.length === 1 && patches[0].messageId === 'DDD');

  // 8. Bulk add unchanged (camelCase rows): inserts + one refresh per message.
  seed([]);
  const res8 = await rr.addMappingsBatch({
    guildId: GUILD,
    botUserId: BOT_ID,
    rows: [
      { channelId: '111', messageId: 'ADD1', emoji: '🔥', roleId: '555' },
      { channelId: '111', messageId: 'ADD1', emoji: '❄️', roleId: '556' },
      { channelId: '111', messageId: 'ADD1', emoji: '🔥', roleId: '557' }, // intra-batch duplicate
    ],
  }, discord);
  check('bulk add still inserts the valid rows', table.length === 2, `table has ${table.length}`);
  check('bulk add still rejects the intra-batch duplicate with a reason',
    res8[2].ok === false && /twice/.test(res8[2].error || ''), JSON.stringify(res8[2]));
  check('bulk add still refreshes the message exactly once',
    patches.length === 1 && patches[0].messageId === 'ADD1', `patches: ${patches.length}`);

  // 9. logCommand with undefined userId + commandName writes the row with
  // sentinels (columns are NOT NULL, so NULL is not an option) and both
  // counter upserts still run.
  const mark9 = executed.length;
  await db.logCommand({ guildId: GUILD, userId: undefined, username: undefined, commandName: undefined, channelId: '111', success: true, errorMessage: undefined });
  const new9 = executed.slice(mark9);
  const insert9 = new9.find((e) => /INSERT INTO command_logs/.test(e.sql));
  check('logCommand with undefined userId/commandName still writes the row (sentinel, not NULL)',
    insert9 && insert9.params[1] === 'unknown' && insert9.params[3] === 'unknown', JSON.stringify(insert9?.params));
  check('logCommand with missing identity still runs the guild_stats upsert',
    new9.some((e) => /INSERT INTO guild_stats/.test(e.sql) && e.params[0] === GUILD));
  check('logCommand with missing identity still runs the user_stats upsert (sentinel user)',
    new9.some((e) => /INSERT INTO user_stats/.test(e.sql) && e.params[0] === 'unknown' && e.params[1] === GUILD));

  // 10. logCommand DM case: undefined guildId/channelId.
  const mark10 = executed.length;
  await db.logCommand({ guildId: undefined, userId: '777', username: 'ace', commandName: 'ping', channelId: undefined, success: true });
  const new10 = executed.slice(mark10);
  const insert10 = new10.find((e) => /INSERT INTO command_logs/.test(e.sql));
  check('logCommand DM case writes the row with NULL guild/channel',
    insert10 && insert10.params[0] === null && insert10.params[4] === null && insert10.params[1] === '777');
  check('logCommand DM case upserts user_stats under guild DM',
    new10.some((e) => /INSERT INTO user_stats/.test(e.sql) && e.params[0] === '777' && e.params[1] === 'DM'));

  // 11. logCommand happy path is byte-identical to before (regression).
  const mark11 = executed.length;
  await db.logCommand({ guildId: GUILD, userId: '777', username: 'ace#0', commandName: 'ping', channelId: '111', success: false, errorMessage: 'boom' });
  const new11 = executed.slice(mark11);
  const insert11 = new11.find((e) => /INSERT INTO command_logs/.test(e.sql));
  check('logCommand happy path params unchanged',
    insert11 && JSON.stringify(insert11.params) === JSON.stringify([GUILD, '777', 'ace#0', 'ping', '111', 0, 'boom']),
    JSON.stringify(insert11?.params));

  // 12. withTransaction's txQuery sanitizes too.
  const mark12 = executed.length;
  await db.withTransaction(async (tx) => {
    await tx('SELECT * FROM reaction_roles WHERE message_id = ?', [undefined]);
    return 'done';
  });
  check('withTransaction txQuery sanitizes undefined → null',
    executed.slice(mark12).some((e) => /SELECT \* FROM reaction_roles/.test(e.sql) && e.params[0] === null));

  // 13. The once-only warning still fires exactly once for a real failure.
  let warns = 0;
  const origWarn = console.warn;
  console.warn = (...a) => { if (String(a[0]).includes('[db] Query failed')) warns++; };
  await db.query('SELECT FORCE_FAIL');
  await db.query('SELECT FORCE_FAIL');
  console.warn = origWarn;
  check('a failing query still warns exactly once across two failures', warns === 1, `warns: ${warns}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });

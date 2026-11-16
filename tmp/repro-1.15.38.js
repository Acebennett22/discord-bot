// Reproduction mock for the 1.15.38 duplicate-check contradiction.
// Store holds EXACTLY the 2 live rows (per the bot's /reactionroles list):
//   (guild G, channel C, message M, 💻, PC Warrior)
//   (guild G, channel C, message M, ▶️, YouTube Creator)
// Then a single add of 🟢 (Xbox Warrior) to the same message is attempted
// through the REAL reactionRoles.js code paths (injected fake db).
// If the live bug is in reactionRoles.js, this must fail with
// "That emoji is already mapped on this message." If it succeeds, the bug
// is upstream (route / client / live env), not in this module.
'use strict';
const path = require('path');
const Module = require('module');

const GUILD = '1571439343976058970';
const CHANNEL = '1571556681320632520';
const MESSAGE = '1571727320597663745';
const PC = '111111111111111111';
const YT = '222222222222222222';
const XBOX = '333333333333333333';
const BOT_ID = '999999999999999999';

// --- Fake db: in-memory reaction_roles table with MySQL semantics --------
const table = [
  { id: 1, guild_id: GUILD, channel_id: CHANNEL, message_id: MESSAGE, emoji: '💻', role_id: PC, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
  { id: 2, guild_id: GUILD, channel_id: CHANNEL, message_id: MESSAGE, emoji: '▶️', role_id: YT, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 },
];
let nextId = 3;
const queriesSeen = [];

function eq(a, b) { return String(a) === String(b); }

const fakeDb = {
  isEnabled: () => true,
  query: async (sql, params = []) => {
    queriesSeen.push({ sql, params: [...params] });
    const p = params.map((v) => (v === undefined ? null : v));
    // Duplicate check (validateMappingForInsert)
    if (sql.startsWith('SELECT id FROM reaction_roles WHERE guild_id = ? AND channel_id = ? AND message_id = ? AND emoji = ?')) {
      const [g, c, m, e] = p;
      return table.filter((r) => eq(r.guild_id, g) && eq(r.channel_id, c) && eq(r.message_id, m) && eq(r.emoji, e)).map((r) => ({ id: r.id }));
    }
    // insertMappingRow lookup (no channel filter)
    if (sql.startsWith('SELECT channel_id, role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
      const [g, m, e] = p;
      return table.filter((r) => eq(r.guild_id, g) && eq(r.message_id, m) && eq(r.emoji, e)).map((r) => ({ channel_id: r.channel_id, role_id: r.role_id }));
    }
    // INSERT (unique key guild_id, message_id, emoji)
    if (sql.startsWith('INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id)')) {
      const [g, c, m, e, r] = p;
      if (table.some((row) => eq(row.guild_id, g) && eq(row.message_id, m) && eq(row.emoji, e))) {
        // mysql2 would throw ER_DUP_ENTRY; db.query() swallows it -> null.
        return null;
      }
      table.push({ id: nextId++, guild_id: g, channel_id: c, message_id: m, emoji: e, role_id: r, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
      return { affectedRows: 1, insertId: nextId - 1 };
    }
    // UPDATE repair
    if (sql.startsWith('UPDATE reaction_roles SET channel_id = ? WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
      const [c, g, m, e] = p;
      const row = table.find((r) => eq(r.guild_id, g) && eq(r.message_id, m) && eq(r.emoji, e));
      if (!row) return { affectedRows: 0 };
      row.channel_id = c;
      return { affectedRows: 1 };
    }
    // DELETE
    if (sql.startsWith('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
      const [g, m, e] = p;
      const before = table.length;
      for (let i = table.length - 1; i >= 0; i--) {
        if (eq(table[i].guild_id, g) && eq(table[i].message_id, m) && eq(table[i].emoji, e)) table.splice(i, 1);
      }
      return { affectedRows: before - table.length };
    }
    // getMappings
    if (sql.startsWith('SELECT * FROM reaction_roles WHERE message_id = ?')) {
      return table.filter((r) => eq(r.message_id, p[0])).map((r) => ({ ...r }));
    }
    // read-back in addMappingsBatch
    if (sql.startsWith('SELECT emoji FROM reaction_roles WHERE guild_id = ? AND message_id = ?')) {
      return table.filter((r) => eq(r.guild_id, p[0]) && eq(r.message_id, p[1])).map((r) => ({ emoji: r.emoji }));
    }
    // refresh count (dashboard)
    if (sql.startsWith('SELECT id FROM reaction_roles WHERE guild_id = ? AND channel_id = ? AND message_id = ?')) {
      return table.filter((r) => eq(r.guild_id, p[0]) && eq(r.channel_id, p[1]) && eq(r.message_id, p[2])).map((r) => ({ id: r.id }));
    }
    // list query (dashboard settings + /reactionroles-list)
    if (sql.includes('FROM reaction_roles WHERE guild_id = ? ORDER BY message_id')) {
      return table.filter((r) => eq(r.guild_id, p[0])).map((r) => ({ ...r }));
    }
    throw new Error('fakeDb: unhandled SQL: ' + sql);
  },
};

// Inject the fake db into the require cache BEFORE reactionRoles loads it.
const dbPath = require.resolve('../src/utils/database.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
const rr = require('../src/utils/reactionRoles.js');

// --- Fake discord adapter (same shape as reactionRolesDiscord()) ---------
const discord = {
  getMessage: async (chId, msgId) => {
    if (chId === CHANNEL && msgId === MESSAGE) return { id: MESSAGE, channel_id: CHANNEL, author: { id: BOT_ID } };
    return null;
  },
  listGuildEmojis: async () => [],
  listGuildRoles: async () => [
    { id: PC, name: 'PC Warrior' },
    { id: YT, name: 'YouTube Creator' },
    { id: XBOX, name: 'Xbox Warrior' },
  ],
  patchMessage: async () => {},
};

(async () => {
  console.log('store before:', table.map((r) => `${r.emoji}→${r.role_id}`).join(', '));
  // Simulate the ROUTE's normalization for the single-add client body:
  // { channelId, messageId, emojiCustom: '', emojiUnicode: '🟢', roleId }
  const clientBody = { channelId: CHANNEL, messageId: MESSAGE, emojiCustom: '', emojiUnicode: '🟢', roleId: XBOX };
  const emoji = rr.resolveEmojiInput(clientBody.emojiCustom, clientBody.emojiUnicode);
  console.log('resolved emoji:', JSON.stringify(emoji), 'code points:', [...emoji].map((c) => c.codePointAt(0).toString(16)));
  try {
    await rr.addMapping({ guildId: GUILD, channelId: clientBody.channelId, messageId: clientBody.messageId, emoji, roleId: clientBody.roleId, botUserId: BOT_ID }, discord);
    console.log('RESULT: addMapping SUCCEEDED (no false duplicate)');
  } catch (e) {
    console.log('RESULT: addMapping FAILED:', e.status, JSON.stringify(e.message));
  }
  console.log('store after:', table.map((r) => `${r.emoji}→${r.role_id}`).join(', '));
  console.log('queries seen:');
  for (const q of queriesSeen) console.log('  ', q.sql, '::', JSON.stringify(q.params));
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });

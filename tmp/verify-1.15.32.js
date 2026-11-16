// Verify 1.15.32: dashboard add-reaction-role form + route.
// The bot reads reaction_roles from MySQL per button click (no cache), so
// the mapping is exercised here against a fake in-memory table, with a
// fake Discord REST adapter standing in for the dashboard's discordApi.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
};
const throwsWith = async (fn, re) => {
  try { await fn(); return false; } catch (e) { return re.test(e.message); }
};

// --- Fake DB: in-memory reaction_roles table ------------------------------
const db = require('../src/utils/database');
const fakeRows = [];
const queries = [];
let nextId = 1;
db.isEnabled = () => true;
db.query = async (sql, params = []) => {
  queries.push({ sql, params: [...params] });
  const s = sql.replace(/\s+/g, ' ');
  if (s.startsWith('SELECT * FROM reaction_roles WHERE message_id = ?')) {
    return fakeRows.filter((r) => r.message_id === params[0]).map((r) => ({ ...r }));
  }
  if (s.startsWith('SELECT id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
    return fakeRows.filter((r) => r.guild_id === params[0] && r.message_id === params[1] && r.emoji === params[2]).map((r) => ({ id: r.id }));
  }
  if (s.startsWith('INSERT INTO reaction_roles')) {
    const [guild_id, channel_id, message_id, emoji, role_id] = params;
    if (fakeRows.some((r) => r.guild_id === guild_id && r.message_id === message_id && r.emoji === emoji)) {
      const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e;
    }
    fakeRows.push({ id: nextId++, guild_id, channel_id, message_id, emoji, role_id, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
    return { insertId: nextId - 1 };
  }
  if (s.startsWith('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?')) {
    const before = fakeRows.length;
    for (let i = fakeRows.length - 1; i >= 0; i--) {
      const r = fakeRows[i];
      if (r.guild_id === params[0] && r.message_id === params[1] && r.emoji === params[2]) fakeRows.splice(i, 1);
    }
    return { affectedRows: before - fakeRows.length };
  }
  throw new Error(`unexpected query in fake db: ${sql}`);
};

const rr = require('../src/utils/reactionRoles');

const G = '1571439343976058970';
const CH = '111111111111111111';
const MSG = '222222222222222222';
const BOT_ID = '333333333333333333';
const EMOJIS = [
  { id: '123456789012345678', name: 'viking', animated: false },
  { id: '123456789012345679', name: 'rave', animated: true },
];
function makeDiscord({ message = { id: MSG, channel_id: CH, author: { id: BOT_ID } }, emojis = EMOJIS, patchFails = false } = {}) {
  const calls = { patch: [] };
  return {
    calls,
    getMessage: async () => message,
    listGuildEmojis: async () => emojis,
    patchMessage: async (chId, msgId, body) => {
      calls.patch.push({ chId, msgId, body });
      if (patchFails) { const e = new Error('Unknown Message'); e.response = { data: { message: 'Unknown Message' } }; throw e; }
    },
  };
}
const reset = () => { fakeRows.length = 0; queries.length = 0; };

(async () => {
  console.log('resolveEmojiInput:');
  check('custom <:name:id> passes through', rr.resolveEmojiInput('<:viking:123456789012345678>', '') === '<:viking:123456789012345678>');
  check('animated <a:name:id> passes through', rr.resolveEmojiInput('<a:rave:123456789012345679>', '') === '<a:rave:123456789012345679>');
  check('unicode passes through', rr.resolveEmojiInput('', '🎮') === '🎮');
  check('custom wins when both filled', rr.resolveEmojiInput('<:viking:123456789012345678>', '🎮') === '<:viking:123456789012345678>');
  check('both empty rejected', await throwsWith(() => rr.resolveEmojiInput('', ''), /Pick a custom emoji/));
  check('malformed custom rejected', await throwsWith(() => rr.resolveEmojiInput('<:bad>', ''), /looks invalid/));
  check('plain text rejected as unicode', await throwsWith(() => rr.resolveEmojiInput('', 'hello'), /single Unicode emoji/));
  check('spaced unicode rejected', await throwsWith(() => rr.resolveEmojiInput('', '🎮 🎮'), /no spaces/));
  check('flag emoji accepted', rr.resolveEmojiInput('', '🇺🇸') === '🇺🇸');

  console.log('validateEmojiAgainstGuild:');
  check('custom emoji in guild ok', (() => { rr.validateEmojiAgainstGuild('<:viking:123456789012345678>', EMOJIS); return true; })());
  check('custom emoji not in guild rejected', await throwsWith(() => rr.validateEmojiAgainstGuild('<:nope:123456789012345699>', EMOJIS), /not in this server/));
  check('unicode passes through', (() => { rr.validateEmojiAgainstGuild('🎮', EMOJIS); return true; })());

  console.log('addMapping happy path (custom emoji):');
  reset();
  const d1 = makeDiscord();
  await rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '<:viking:123456789012345678>', roleId: '444444444444444444', botUserId: BOT_ID }, d1);
  const insert = queries.find((q) => q.sql.includes('INSERT INTO reaction_roles'));
  check('insert uses the command column list', insert && insert.sql.includes('(guild_id, channel_id, message_id, emoji, role_id)'));
  check('insert params are the exact mapping', !!insert && JSON.stringify(insert.params) === JSON.stringify([G, CH, MSG, '<:viking:123456789012345678>', '444444444444444444']));
  check('row stored', fakeRows.length === 1 && fakeRows[0].emoji === '<:viking:123456789012345678>');
  check('message PATCHed once', d1.calls.patch.length === 1 && d1.calls.patch[0].chId === CH && d1.calls.patch[0].msgId === MSG);
  const btn = d1.calls.patch[0].body.components[0].components[0];
  check('button custom_id is rr:<roleId>', btn.custom_id === 'rr:444444444444444444');
  check('button label is the emoji name', btn.label === 'viking');
  check('button emoji carries the custom id', btn.emoji && String(btn.emoji.id) === '123456789012345678');
  check('button is secondary + enabled', btn.style === 2 && btn.disabled !== true);
  check('bot lookup finds the dashboard-added mapping', (await rr.getMappings(MSG)).length === 1 && (await rr.getMappings(MSG))[0].role_id === '444444444444444444');
  check('message counts as enabled', await rr.isMessageEnabled(MSG) === true);

  console.log('addMapping happy path (unicode emoji):');
  reset();
  const d2 = makeDiscord();
  await rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮', roleId: '555555555555555555', botUserId: BOT_ID }, d2);
  const btn2 = d2.calls.patch[0].body.components[0].components[0];
  check('unicode button label is the emoji', btn2.label === '🎮');
  check('unicode button emoji has the name, no id', btn2.emoji && btn2.emoji.name === '🎮' && !btn2.emoji.id);

  console.log('addMapping rejections:');
  reset();
  fakeRows.push({ id: 9, guild_id: G, channel_id: CH, message_id: MSG, emoji: '<:viking:123456789012345678>', role_id: '444444444444444444', required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 });
  const d3 = makeDiscord();
  check('duplicate emoji on same message rejected', await throwsWith(() => rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '<:viking:123456789012345678>', roleId: '555555555555555555', botUserId: BOT_ID }, d3), /already mapped/));
  check('duplicate made no insert and no patch', !queries.some((q) => q.sql.includes('INSERT INTO reaction_roles')) && d3.calls.patch.length === 0);
  reset();
  const d4 = makeDiscord({ message: null });
  check('missing message rejected', await throwsWith(() => rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮', roleId: '555555555555555555', botUserId: BOT_ID }, d4), /does not exist/));
  check('missing message made no insert', fakeRows.length === 0);
  reset();
  const d5 = makeDiscord({ message: { id: MSG, channel_id: CH, author: { id: '999999999999999999' } } });
  check("someone else's message rejected", await throwsWith(() => rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮', roleId: '555555555555555555', botUserId: BOT_ID }, d5), /wasn't posted by the bot/));
  check('foreign message made no insert', fakeRows.length === 0);
  reset();
  const d6 = makeDiscord();
  check('custom emoji outside the guild rejected', await throwsWith(() => rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '<:nope:123456789012345699>', roleId: '555555555555555555', botUserId: BOT_ID }, d6), /not in this server/));
  check('foreign emoji made no insert', fakeRows.length === 0);

  console.log('addMapping PATCH failure rolls back:');
  reset();
  const d7 = makeDiscord({ patchFails: true });
  check('patch failure throws a clear error', await throwsWith(() => rr.addMapping({ guildId: G, channelId: CH, messageId: MSG, emoji: '🎮', roleId: '555555555555555555', botUserId: BOT_ID }, d7), /button update/));
  check('rolled-back row is gone', fakeRows.length === 0);
  check('rollback issued a DELETE', queries.some((q) => q.sql.startsWith('DELETE FROM reaction_roles')));

  console.log('buildRows (same builder the bot command uses):');
  reset();
  ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'].forEach((e, i) => fakeRows.push({ id: i + 1, guild_id: G, channel_id: CH, message_id: MSG, emoji: e, role_id: `60000000000000000${i}`, required_role_id: null, min_days_in_server: null, min_level: null, enabled: 1 }));
  const rows = (await rr.buildRows(MSG)).map((r) => r.toJSON());
  check('6 mappings chunk into 2 rows of 5 + 1', rows.length === 2 && rows[0].components.length === 5 && rows[1].components.length === 1);
  fakeRows[0].enabled = 0;
  const rowsOff = (await rr.buildRows(MSG)).map((r) => r.toJSON());
  check('a disabled mapping disables every button', rowsOff.every((r) => r.components.every((b) => b.disabled === true)));

  console.log('wiring:');
  const dash = read('src/dashboard.js');
  check('route exists with requireAuth + requireGuildAccess', dash.includes("app.post('/api/guilds/:id/reaction-roles', requireAuth, requireGuildAccess,"));
  check('settings GET fetches guild emojis for the reactionroles tab', dash.includes("if (module === 'emojis' || module === 'reactionroles')"));
  check('route audits the add', dash.includes("staffUtils.audit(req.session.user.id, 'reaction-role.add'"));
  const ejs = read('dashboard/views/settings.ejs');
  check('EJS template parses', (() => { require('ejs').compile(ejs); return true; })());
  check('form present', ejs.includes('id="add-reaction-role-form"'));
  check('channel picker is text channels only', ejs.includes('name="channelId"') && /channels\.filter\(c => c\.type === 0\)/.test(ejs));
  check('message ID input present', ejs.includes('name="messageId"'));
  check('custom emoji select built from the guild emoji list', ejs.includes('name="emojiCustom"') && ejs.includes('emojis.forEach'));
  check('unicode emoji input present', ejs.includes('name="emojiUnicode"'));
  check('role picker excludes @everyone', ejs.includes('name="roleId"') && ejs.includes('roles.filter(r => r.id !== guild.id)'));
  check('mappings list has a refreshable wrapper', ejs.includes('id="reaction-roles-list"'));
  check('result element present', ejs.includes('id="reaction-role-result"'));
  const js = read('dashboard/public/js/settings.js');
  check('client handler posts to /reaction-roles', js.includes("'add-reaction-role-form'") && js.includes("api('/reaction-roles')"));
  check('client handler refreshes the list', js.includes("refreshSection('#reaction-roles-list')"));
  check('client error target registered', js.includes("'add-reaction-role-form': 'reaction-role-result'"));
  const changed = execSync('git status --short', { cwd: ROOT, encoding: 'utf8' });
  check('no bot event/command files touched', !/(^|\n) M src\/(events|commands)\//.test(changed));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

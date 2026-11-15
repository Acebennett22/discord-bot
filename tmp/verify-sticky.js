// Verify sticky messages (1.15.15) — run with:
// ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-sticky.js
// Uses a fake in-memory sticky_messages table (no MySQL needed) plus mock
// Discord objects for the commands and the messageCreate re-stick path.
const fs = require('fs');
const path = require('path');
const { ChannelType, Collection, PermissionFlagsBits } = require('discord.js');

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// --- Fake DB -----------------------------------------------------------------
const db = require('../src/utils/database');
let rows = [];
let nextId = 1;
db.isEnabled = () => true;
db.query = async (sql, params = []) => {
  const s = sql.replace(/\s+/g, ' ');
  if (s.startsWith('SELECT * FROM sticky_messages WHERE guild_id = ? AND channel_id = ?')) {
    return rows.filter((r) => r.guild_id === params[0] && r.channel_id === params[1]);
  }
  if (s.startsWith('INSERT INTO sticky_messages')) {
    const [guild_id, channel_id, message_id, content, created_by] = params;
    const ex = rows.find((r) => r.guild_id === guild_id && r.channel_id === channel_id);
    if (ex) { Object.assign(ex, { message_id, content, created_by }); return { affectedRows: 2 }; }
    rows.push({ id: nextId++, guild_id, channel_id, message_id, content, created_by, created_at: new Date() });
    return { insertId: nextId - 1 };
  }
  if (s.startsWith('DELETE FROM sticky_messages')) {
    const before = rows.length;
    rows = rows.filter((r) => !(r.guild_id === params[0] && r.channel_id === params[1]));
    return { affectedRows: before - rows.length };
  }
  if (s.startsWith('UPDATE sticky_messages SET message_id = ?')) {
    const r = rows.find((x) => x.guild_id === params[1] && x.channel_id === params[2]);
    if (r) r.message_id = params[0];
    return { affectedRows: r ? 1 : 0 };
  }
  throw new Error(`unexpected SQL in fake: ${sql}`);
};

const sticky = require('../src/utils/sticky');
const { buildConsolidated } = require('../src/handlers/consolidate');
const help = require('../src/commands/utility/help');
const setCmd = require('../src/commands/sticky/sticky-set');
const removeCmd = require('../src/commands/sticky/sticky-remove');

// --- Fake Discord objects ----------------------------------------------------
let msgSeq = 1000;
let deletedIds = [];
let callOrder = []; // records defer vs send ordering for the set tests
function makeChannel(id, name, permsOk = true) {
  const channelMessages = [];
  const channel = {
    id, name, type: ChannelType.GuildText,
    guild: { id: 'G1', members: { me: {} } },
    messages: {
      fetch: async (arg) => {
        if (typeof arg === 'string') {
          const m = channelMessages.find((x) => x.id === arg);
          if (!m) { const e = new Error('Unknown Message'); e.code = 10008; throw e; }
          return m;
        }
        const last = channelMessages[channelMessages.length - 1];
        return new Collection(last ? [[last.id, last]] : []);
      },
    },
    send: async ({ content }) => {
      callOrder.push('send');
      const m = {
        id: `M${++msgSeq}`, content, author: { id: 'BOT', bot: true },
        delete: async () => { deletedIds.push(m.id); const i = channelMessages.indexOf(m); if (i >= 0) channelMessages.splice(i, 1); },
      };
      channelMessages.push(m);
      return m;
    },
    permissionsFor: () => ({ has: () => permsOk }),
    _messages: channelMessages,
  };
  return channel;
}
function userMessage(channel, content, authorId = 'U9') {
  const m = {
    id: `M${++msgSeq}`, content, author: { id: authorId, bot: false },
    guild: channel.guild, guildId: 'G1', channelId: channel.id, channel,
    client: { user: { id: 'BOT' } },
  };
  channel._messages.push(m);
  return m;
}
function mockInteraction({ channel, channelOpt = null, text = null, canManage = true, userId = 'U1' }) {
  const cap = {};
  return {
    cap,
    guild: { id: 'G1' }, guildId: 'G1', channel, user: { id: userId },
    memberPermissions: { has: () => canManage },
    options: {
      getString: (n) => (n === 'text' ? text : null),
      getChannel: (n) => (n === 'channel' ? channelOpt : null),
      getSubcommandGroup: () => null,
      getSubcommand: () => null,
    },
    reply: async (opts) => { cap.reply = opts; return {}; },
    deferReply: async (...args) => { callOrder.push('defer'); cap.deferred = args; },
    editReply: async (opts) => { cap.editReply = opts; return {}; },
  };
}

(async () => {
  // --- 1. Load: counts + parent structure -----------------------------------
  const { topLevel, flatCount, childCount, parentCount } = buildConsolidated();
  check('flat count is 268', flatCount === 268, `got ${flatCount}`);
  check('top-level count is 38', topLevel.length === 38, `got ${topLevel.length}`);
  check('parent count is 33', parentCount === 33, `got ${parentCount}`);
  const stickyParent = topLevel.find((c) => c.data.name === 'sticky');
  check('/sticky parent exists', !!stickyParent);
  check('/sticky has children set + remove', stickyParent && stickyParent.children.has('set') && stickyParent.children.has('remove'));
  check('/sticky parent permission is Manage Messages', stickyParent && stickyParent.data.toJSON().default_member_permissions === String(PermissionFlagsBits.ManageMessages), `got ${stickyParent?.data.toJSON().default_member_permissions}`);
  const setJson = setCmd.data.toJSON();
  check('set text option maxLength is 2000', setJson.options.find((o) => o.name === 'text')?.max_length === 2000);
  check('set channel option allows text + announcement', JSON.stringify(setJson.options.find((o) => o.name === 'channel')?.channel_types) === JSON.stringify([ChannelType.GuildText, ChannelType.GuildAnnouncement]));
  check('set/remove both declare Manage Messages', setCmd.data.toJSON().default_member_permissions === String(PermissionFlagsBits.ManageMessages)
    && removeCmd.data.toJSON().default_member_permissions === String(PermissionFlagsBits.ManageMessages));

  // --- 2. Parent router denies without Manage Messages ----------------------
  {
    const cap = {};
    const routerIx = {
      memberPermissions: { has: () => false },
      options: { getSubcommandGroup: () => null, getSubcommand: () => 'set' },
      reply: async (opts) => { cap.reply = opts; },
    };
    await stickyParent.execute(routerIx);
    check('router denies set without Manage Messages', cap.reply?.embeds?.[0]?.data?.description?.includes('Manage Messages') === true);
  }

  // --- 3. /sticky set happy path --------------------------------------------
  const channel = makeChannel('C1', 'general');
  let firstStickyId;
  {
    callOrder = [];
    const ix = mockInteraction({ channel, text: 'Hello, I am sticky' });
    await setCmd.execute(ix);
    check('set defers the reply (no ephemeral)', ix.cap.deferred !== undefined && ix.cap.deferred.length === 0);
    check('set defers BEFORE posting, so the confirmation sits above the sticky', callOrder.join(',') === 'defer,send', `got ${callOrder.join(',')}`);
    check('set posts the sticky text', channel._messages.length === 1 && channel._messages[0].content === 'Hello, I am sticky');
    firstStickyId = channel._messages[0].id;
    check('set stores the row with the message id', rows.length === 1 && rows[0].channel_id === 'C1' && rows[0].message_id === firstStickyId && rows[0].content === 'Hello, I am sticky');
    check('set confirms with a success embed', ix.cap.editReply?.embeds?.[0]?.data?.title?.includes('Sticky set') === true);
  }

  // --- 4. /sticky set again replaces the old one ----------------------------
  {
    deletedIds = [];
    const ix = mockInteraction({ channel, text: 'New sticky text' });
    await setCmd.execute(ix);
    check('set again deletes the old sticky message', deletedIds.includes(firstStickyId));
    check('set again updates the row (one row, new content + id)', rows.length === 1 && rows[0].content === 'New sticky text' && rows[0].message_id !== firstStickyId);
    check('set again mentions the previous sticky was removed', ix.cap.editReply?.embeds?.[0]?.data?.description?.includes('previous sticky was removed') === true);
  }
  const currentStickyId = rows[0].message_id;

  // --- 5. handleMessage: sticky not last -> delete + repost ------------------
  {
    deletedIds = [];
    const msg = userMessage(channel, 'a user message'); // now last; sticky is not
    const reposted = await sticky.handleMessage(msg);
    check('re-stick fires when sticky is not last', reposted === true);
    check('re-stick deletes the old sticky', deletedIds.includes(currentStickyId));
    const last = channel._messages[channel._messages.length - 1];
    check('re-stick re-posts the same text last', last.content === 'New sticky text' && last.author.id === 'BOT');
    check('re-stick updates the row message id', rows[0].message_id === last.id);
  }

  // --- 6. handleMessage: sticky already last -> no-op ------------------------
  {
    const sentBefore = channel._messages.length;
    const beforeId = rows[0].message_id;
    // The sticky is last now; a new user message arrives and... wait, the
    // new message itself becomes last, so re-stick SHOULD fire. To test the
    // already-last path, call handleMessage with a message when the sticky
    // is last — i.e. no new message after it. Simulate by removing the
    // just-added user message from the tail: use a synthetic message object
    // that is NOT appended to the channel.
    const ghost = {
      id: 'M-ghost', content: 'ghost', author: { id: 'U9', bot: false },
      guild: channel.guild, guildId: 'G1', channelId: 'C1', channel,
      client: { user: { id: 'BOT' } },
    };
    const result = await sticky.handleMessage(ghost);
    check('no-op when sticky is already last', result === false && channel._messages.length === sentBefore && rows[0].message_id === beforeId);
  }

  // --- 7. handleMessage: manually deleted sticky -> re-posted -----------------
  {
    // Delete the sticky message directly (as a user would) without touching the row.
    const stickyMsg = channel._messages.find((m) => m.id === rows[0].message_id);
    await stickyMsg.delete();
    const msg = userMessage(channel, 'another message');
    const reposted = await sticky.handleMessage(msg);
    check('manually deleted sticky is re-posted on next message', reposted === true);
    check('re-posted sticky is last with the same text', channel._messages[channel._messages.length - 1].content === 'New sticky text');
    check('row points at the new message', rows[0].message_id === channel._messages[channel._messages.length - 1].id);
  }

  // --- 8. handleMessage: no permission -> silent fail ------------------------
  {
    const noperm = makeChannel('C2', 'locked', false);
    rows.push({ id: nextId++, guild_id: 'G1', channel_id: 'C2', message_id: 'M-gone', content: 'locked sticky', created_by: 'U1', created_at: new Date() });
    const msg = userMessage(noperm, 'hello');
    const result = await sticky.handleMessage(msg);
    check('missing permissions fails silently (no repost, no throw)', result === false && noperm._messages.length === 1);
    rows = rows.filter((r) => r.channel_id !== 'C2');
  }

  // --- 9. /sticky remove happy path ------------------------------------------
  {
    deletedIds = [];
    const stickyId = rows[0].message_id;
    const ix = mockInteraction({ channel });
    await removeCmd.execute(ix);
    check('remove deletes the sticky message', deletedIds.includes(stickyId));
    check('remove deletes the row', rows.length === 0);
    check('remove confirms with a success embed', ix.cap.reply?.embeds?.[0]?.data?.title?.includes('Sticky removed') === true);
  }

  // --- 10. /sticky remove with no sticky --------------------------------------
  {
    const ix = mockInteraction({ channel });
    await removeCmd.execute(ix);
    check('remove with no sticky reports so (info, not error)', ix.cap.reply?.embeds?.[0]?.data?.title?.includes('No sticky here') === true);
  }

  // --- 11. Permission + channel-type guards -----------------------------------
  {
    const ix = mockInteraction({ channel, text: 'x', canManage: false });
    await setCmd.execute(ix);
    check('set without Manage Messages is denied', ix.cap.reply?.embeds?.[0]?.data?.description?.includes('Manage Messages') === true);
    const ix2 = mockInteraction({ channel, canManage: false });
    await removeCmd.execute(ix2);
    check('remove without Manage Messages is denied', ix2.cap.reply?.embeds?.[0]?.data?.description?.includes('Manage Messages') === true);
    const thread = makeChannel('C3', 'a-thread');
    thread.type = ChannelType.PublicThread;
    const ix3 = mockInteraction({ channel: thread, text: 'x' });
    await setCmd.execute(ix3);
    check('set in a thread is rejected with guidance', ix3.cap.reply?.embeds?.[0]?.data?.description?.includes('text or announcement channel') === true);
  }

  // --- 12. /sticky set into a different channel via option --------------------
  {
    const cmdChannel = makeChannel('C4', 'commands');
    const target = makeChannel('C5', 'announcements');
    const ix = mockInteraction({ channel: cmdChannel, channelOpt: target, text: 'Posted over there' });
    await setCmd.execute(ix);
    check('set with channel option posts in the target channel', target._messages.length === 1 && target._messages[0].content === 'Posted over there');
    check('set with channel option stores the target channel id', rows.some((r) => r.channel_id === 'C5' && r.content === 'Posted over there'));
    check('set with channel option posts nothing in the command channel', cmdChannel._messages.length === 0);
  }

  // --- 13. Schema + self-heal --------------------------------------------------
  {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    check('schema.sql has sticky_messages CREATE TABLE', schema.includes('CREATE TABLE IF NOT EXISTS sticky_messages'));
    for (const col of ['guild_id', 'channel_id', 'message_id', 'content', 'created_by', 'created_at']) {
      check(`schema.sql sticky_messages has column ${col}`, schema.includes(col));
    }
    check('schema.sql enforces one sticky per channel', schema.includes('UNIQUE KEY uq_sticky_channel (guild_id, channel_id)'));
    const dbSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'database.js'), 'utf8');
    check('database.js has STICKY_MESSAGES_CREATE self-heal', dbSrc.includes('STICKY_MESSAGES_CREATE') && dbSrc.includes('CREATE TABLE IF NOT EXISTS sticky_messages'));
    check('runMigrations executes the sticky CREATE', dbSrc.includes('pool.execute(STICKY_MESSAGES_CREATE)'));
    const stickySrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'sticky.js'), 'utf8');
    check('sticky util has no ephemeral flag', !stickySrc.includes('ephemeral:'));
    const setSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'sticky', 'sticky-set.js'), 'utf8');
    check('set command has no ephemeral flag', !setSrc.includes('ephemeral:'));
  }

  // --- 14. /help lists /sticky set + /sticky remove -----------------------------
  {
    const { topLevel: tl } = buildConsolidated();
    const client = { commands: new Collection() };
    for (const cmd of tl) client.commands.set(cmd.data.name, cmd);
    check('help count is 268', help.countCommands(client) === 268, `got ${help.countCommands(client)}`);
    const modLines = help.linesForGroup(client, 'moderation').join('\n');
    check('help moderation group lists /sticky set', modLines.includes('**/sticky set**'));
    check('help moderation group lists /sticky remove', modLines.includes('**/sticky remove**'));
    check('help still has exactly 25 groups', Object.keys(help.GROUPS).length === 25);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((err) => { console.error('VERIFY CRASH:', err); process.exit(1); });

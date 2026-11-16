// Reaction roles — button-based (preferred). Classic reactions are NOT used:
// buttons are reliable, don't need the GuildMessageReactions intent, and
// can't be spoofed by reacting to the wrong message.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');

function emojiLabel(emoji) {
  // Custom emoji <:name:id> -> show name; unicode -> itself.
  const m = /^<a?:(\w+):\d+>$/.exec(emoji);
  return m ? m[1] : emoji;
}

function emojiButton(emoji, roleId) {
  const btn = new ButtonBuilder().setCustomId(`rr:${roleId}`).setLabel(emojiLabel(emoji)).setStyle(ButtonStyle.Secondary);
  // Custom emoji need the raw <...:...> form; unicode emoji go in directly.
  if (/^<a?:\w+:\d+>$/.test(emoji)) {
    const [,, id] = emoji.replace(/[<>]/g, '').split(':');
    btn.setEmoji(id);
  } else {
    btn.setEmoji(emoji);
  }
  return btn;
}

async function getMappings(messageId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM reaction_roles WHERE message_id = ?', [messageId])) || [];
}

// True when the reaction-role message is enabled (1.14.1). A message with
// no mappings at all counts as disabled — there is nothing to grant.
async function isMessageEnabled(messageId) {
  const mappings = await getMappings(messageId);
  if (!mappings.length) return false;
  return mappings.every((m) => m.enabled !== 0);
}

async function buildRows(messageId) {
  const mappings = await getMappings(messageId);
  const enabled = mappings.length > 0 && mappings.every((m) => m.enabled !== 0);
  const rows = [];
  for (let i = 0; i < mappings.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      ...mappings.slice(i, i + 5).map((m) => {
        const btn = emojiButton(m.emoji, m.role_id);
        if (!enabled) btn.setDisabled(true);
        return btn;
      }),
    ));
  }
  return rows;
}

// Dashboard add-mapping (1.15.32) — the dashboard has no bot client, so the
// route passes in a small `discord` adapter around its REST client.
// `botUserId` is the bot's own user id (config.clientId): reaction-role
// buttons can only be added to the bot's own messages, so a mapping on
// anyone else's message would be dead on arrival.
// Resolve the form's two emoji inputs into the one stored value. Custom
// wins when both are filled. Throws a user-facing Error when neither is
// usable.
function resolveEmojiInput(emojiCustom, emojiUnicode) {
  const custom = String(emojiCustom || '').trim();
  if (custom) {
    if (!/^<a?:\w+:\d+>$/.test(custom)) throw new Error('That custom emoji value looks invalid — pick one from the list.');
    return custom;
  }
  const unicode = String(emojiUnicode || '').trim();
  if (!unicode) throw new Error('Pick a custom emoji from the list or type a Unicode emoji.');
  if (/\s/.test(unicode)) throw new Error('Type a single Unicode emoji (no spaces).');
  const points = [...unicode];
  if (points.length > 4 || !points.some((ch) => ch.codePointAt(0) > 127)) {
    throw new Error('Type a single Unicode emoji.');
  }
  return unicode;
}

// A custom emoji must belong to this guild — the form only offers the
// guild's own, but the value comes from the client, so verify. Unicode
// passes through (Discord itself is the backstop at PATCH time).
function validateEmojiAgainstGuild(emoji, guildEmojis) {
  const m = /^<a?:\w+:(\d+)>$/.exec(emoji);
  if (!m) return;
  if (!(guildEmojis || []).some((e) => String(e.id) === m[1])) {
    throw new Error('That custom emoji is not in this server.');
  }
}

// Insert one mapping in the exact shape /reactionroles-add writes, then
// refresh the message's buttons through the same buildRows() the bot uses
// — so a dashboard-added mapping works and looks identical to a
// command-added one, with no bot restart (handlers read the DB per event).
// Throws a user-facing Error (with .status: 400 validation, 502 Discord).
async function addMapping({ guildId, channelId, messageId, emoji, roleId, botUserId }, discord) {
  const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
  const guildEmojis = await discord.listGuildEmojis(guildId).catch(() => []);
  validateEmojiAgainstGuild(emoji, guildEmojis);
  const message = await discord.getMessage(channelId, messageId).catch(() => null);
  if (!message) fail(400, 'That message does not exist in this channel.');
  if (message.author?.id !== botUserId) fail(400, "That message wasn't posted by the bot — reaction roles can only be added to the bot's own messages.");
  const existing = await db.query('SELECT id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?', [guildId, messageId, emoji]);
  if (existing?.length) fail(400, 'That emoji is already mapped on this message.');
  try {
    await db.query(
      'INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?, ?)',
      [guildId, channelId, messageId, emoji, roleId],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') fail(400, 'That emoji is already mapped on this message.');
    throw err;
  }
  try {
    const components = (await buildRows(messageId)).map((row) => row.toJSON());
    await discord.patchMessage(channelId, messageId, { components });
  } catch (err) {
    // The buttons are the whole interface — a mapping without them is
    // useless, so roll the row back instead of leaving an orphan.
    await db.query('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?', [guildId, messageId, emoji]).catch(() => {});
    const detail = err.response?.data?.message || err.message || 'unknown error';
    fail(502, `Discord refused the button update (${detail}) — the mapping was not kept.`);
  }
  return { messageId, channelId };
}

module.exports = { emojiLabel, emojiButton, getMappings, isMessageEnabled, buildRows, resolveEmojiInput, validateEmojiAgainstGuild, addMapping };

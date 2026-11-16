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

function fail(status, message) { const e = new Error(message); e.status = status; throw e; }

// Shared per-batch context (1.15.33): caches the guild emoji list and the
// message fetches, so a batch touching one message N times hits Discord
// once per message instead of once per row.
function batchContext(discord, guildId) {
  let emojisPromise = null;
  const messages = new Map();
  return {
    listGuildEmojis: () => (emojisPromise ||= discord.listGuildEmojis(guildId).catch(() => [])),
    getMessage: (channelId, messageId) => {
      const key = `${channelId}:${messageId}`;
      if (!messages.has(key)) messages.set(key, discord.getMessage(channelId, messageId).catch(() => null));
      return messages.get(key);
    },
  };
}

// Read-only checks shared by the single add and the bulk add. Throws a
// user-facing Error (with .status: 400 validation) when anything is wrong.
async function validateMappingForInsert({ guildId, channelId, messageId, emoji, botUserId }, ctx) {
  const guildEmojis = await ctx.listGuildEmojis();
  validateEmojiAgainstGuild(emoji, guildEmojis);
  const message = await ctx.getMessage(channelId, messageId);
  if (!message) fail(400, 'That message does not exist in this channel.');
  if (message.author?.id !== botUserId) fail(400, "That message wasn't posted by the bot — reaction roles can only be added to the bot's own messages.");
  const existing = await db.query('SELECT id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?', [guildId, messageId, emoji]);
  if (existing?.length) fail(400, 'That emoji is already mapped on this message.');
}

async function insertMappingRow({ guildId, channelId, messageId, emoji, roleId }) {
  try {
    await db.query(
      'INSERT INTO reaction_roles (guild_id, channel_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?, ?)',
      [guildId, channelId, messageId, emoji, roleId],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') fail(400, 'That emoji is already mapped on this message.');
    throw err;
  }
}

async function deleteMappingRow({ guildId, messageId, emoji }) {
  await db.query('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?', [guildId, messageId, emoji]).catch(() => {});
}

// Refresh one message's buttons through the same buildRows() the bot uses.
async function refreshMessageButtons(channelId, messageId, discord) {
  const components = (await buildRows(messageId)).map((row) => row.toJSON());
  await discord.patchMessage(channelId, messageId, { components });
}

// Insert one mapping in the exact shape /reactionroles-add writes, then
// refresh the message's buttons through the same buildRows() the bot uses
// — so a dashboard-added mapping works and looks identical to a
// command-added one, with no bot restart (handlers read the DB per event).
// Throws a user-facing Error (with .status: 400 validation, 502 Discord).
async function addMapping({ guildId, channelId, messageId, emoji, roleId, botUserId }, discord) {
  const ctx = batchContext(discord, guildId);
  await validateMappingForInsert({ guildId, channelId, messageId, emoji, botUserId }, ctx);
  await insertMappingRow({ guildId, channelId, messageId, emoji, roleId });
  try {
    await refreshMessageButtons(channelId, messageId, discord);
  } catch (err) {
    // The buttons are the whole interface — a mapping without them is
    // useless, so roll the row back instead of leaving an orphan.
    await deleteMappingRow({ guildId, messageId, emoji });
    const detail = err.response?.data?.message || err.message || 'unknown error';
    fail(502, `Discord refused the button update (${detail}) — the mapping was not kept.`);
  }
  return { messageId, channelId };
}

// Bulk add (1.15.33). `rows` are already normalized ({channelId, messageId,
// emoji, roleId}) with the route-level checks (channel/role exist, emoji
// resolved) done. Every row is validated first, then the valid ones are
// inserted; each affected message's buttons are refreshed exactly once.
// Returns per-row results aligned with `rows`: { ok: true } or
// { ok: false, error }. A bad row never blocks the others, and a refused
// button refresh rolls back only this batch's rows on that message.
async function addMappingsBatch({ guildId, botUserId, rows }, discord) {
  const ctx = batchContext(discord, guildId);
  const results = rows.map(() => null);
  const seen = new Set();
  const valid = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = `${row.messageId}:${row.emoji}`;
    if (seen.has(key)) {
      results[i] = { ok: false, error: 'The same emoji is used twice for this message in this batch.' };
      continue;
    }
    seen.add(key);
    try {
      await validateMappingForInsert({ guildId, ...row, botUserId }, ctx);
      valid.push({ ...row, index: i });
    } catch (e) {
      results[i] = { ok: false, error: e.message };
    }
  }
  // Insert the valid rows. A race duplicate surfaces as ER_DUP_ENTRY here.
  const inserted = [];
  for (const row of valid) {
    try {
      await insertMappingRow({ guildId, ...row });
      inserted.push(row);
    } catch (e) {
      results[row.index] = { ok: false, error: e.message };
    }
  }
  // Refresh each affected message once, grouped by channel + message.
  const byMessage = new Map();
  for (const row of inserted) {
    const key = `${row.channelId}:${row.messageId}`;
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(row);
  }
  for (const group of byMessage.values()) {
    const { channelId, messageId } = group[0];
    try {
      await refreshMessageButtons(channelId, messageId, discord);
      for (const row of group) results[row.index] = { ok: true };
    } catch (err) {
      for (const row of group) await deleteMappingRow({ guildId, messageId, emoji: row.emoji });
      const detail = err.response?.data?.message || err.message || 'unknown error';
      for (const row of group) results[row.index] = { ok: false, error: `Discord refused the button update (${detail}) — the mapping was not kept.` };
    }
  }
  return results;
}

// Bulk remove (1.15.33). `rows` are mapping rows already fetched by the
// route ({channelId, messageId, emoji}). Deletes every row, then refreshes
// each affected message's buttons exactly once (grouped by message, same
// buildRows() path). Returns per-row results aligned with `rows`:
// { ok: true, messageGone } or { ok: false, error }. A message already gone
// from Discord (404 / Unknown Message) still counts as removed — the mapping
// is gone either way. Any other button-update failure leaves the row deleted
// but reports a warning (the stale button clears on the message's next
// refresh) instead of pretending the removal failed.
async function removeMappingsBatch({ guildId, rows }, discord) {
  // Rows arrive in either shape: the bulk-delete route passes raw mysql2
  // rows (snake_case: message_id, channel_id), while the single remove
  // normalizes to camelCase first. The helper used to read only camelCase,
  // so a raw row made the DELETE run with message_id = undefined — mysql2
  // threw, db.query() swallowed it, and the route reported success while
  // nothing was deleted (1.15.34). Normalize here, at the choke point, so
  // no caller can hit that mismatch again.
  const normalized = (rows || []).map((row) => ({
    id: row.id,
    channelId: row.channelId ?? row.channel_id,
    messageId: row.messageId ?? row.message_id,
    emoji: row.emoji,
  }));
  const results = normalized.map(() => null);
  const deleted = [];
  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    await db.query('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?', [guildId, row.messageId, row.emoji]);
    deleted.push({ ...row, index: i });
  }
  const byMessage = new Map();
  for (const row of deleted) {
    const key = `${row.channelId}:${row.messageId}`;
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(row);
  }
  for (const group of byMessage.values()) {
    const { channelId, messageId } = group[0];
    try {
      await refreshMessageButtons(channelId, messageId, discord);
      for (const row of group) results[row.index] = { ok: true, messageGone: false };
    } catch (err) {
      const status = err.response?.status;
      const code = err.response?.data?.code;
      if (status === 404 || code === 10008) {
        for (const row of group) results[row.index] = { ok: true, messageGone: true };
      } else {
        const detail = err.response?.data?.message || err.message || 'unknown error';
        for (const row of group) results[row.index] = { ok: true, messageGone: false, warning: `Button update failed (${detail}) — the button may linger until the message's buttons are next refreshed.` };
      }
    }
  }
  return results;
}

// Remove one mapping (1.15.33): delete the row, then refresh the message's
// buttons through the same buildRows() the bot uses, so the removed button
// disappears from the message. If the message itself is already gone from
// Discord (404 / Unknown Message), the delete still succeeds — the mapping
// is gone either way.
async function removeMapping({ guildId, channelId, messageId, emoji }, discord) {
  const [result] = await removeMappingsBatch({ guildId, rows: [{ channelId, messageId, emoji }] }, discord);
  return result;
}

module.exports = { emojiLabel, emojiButton, getMappings, isMessageEnabled, buildRows, resolveEmojiInput, validateEmojiAgainstGuild, addMapping, addMappingsBatch, removeMapping, removeMappingsBatch };

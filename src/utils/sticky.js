// Sticky messages (1.15.15): one pinned text per channel that always sits
// at the bottom. /sticky set posts it, /sticky remove clears it, and
// handleMessage (called from messageCreate) re-posts it whenever a new
// message pushes it up. Storage is the MySQL sticky_messages table, one row
// per (guild, channel) — see sql/schema.sql and the self-heal CREATE in
// src/utils/database.js. The sticky itself is plain message content, exactly
// what the user typed (max 2000 chars, enforced by the command option).
const { PermissionFlagsBits } = require('discord.js');
const db = require('./database');
const { logWarn } = require('./errorLogger');

async function getSticky(guildId, channelId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM sticky_messages WHERE guild_id = ? AND channel_id = ?', [guildId, channelId]);
  return rows?.[0] || null;
}

// Upsert the row for a channel. Returns true on success, false when the DB
// is down or the write failed (db.query returns null on error).
async function setStickyRow({ guildId, channelId, messageId, content, userId }) {
  if (!db.isEnabled()) return false;
  const res = await db.query(
    'INSERT INTO sticky_messages (guild_id, channel_id, message_id, content, created_by) VALUES (?, ?, ?, ?, ?) '
    + 'ON DUPLICATE KEY UPDATE message_id = VALUES(message_id), content = VALUES(content), created_by = VALUES(created_by), created_at = CURRENT_TIMESTAMP',
    [guildId, channelId, messageId || null, content, userId || null],
  );
  return res !== null;
}

async function removeStickyRow(guildId, channelId) {
  if (!db.isEnabled()) return false;
  const res = await db.query('DELETE FROM sticky_messages WHERE guild_id = ? AND channel_id = ?', [guildId, channelId]);
  return res !== null;
}

// Best-effort delete of a sticky message: false when it is already gone,
// the bot cannot see it, or deletion is not permitted. Never throws.
async function deleteStickyMessage(channel, messageId) {
  if (!messageId) return false;
  try {
    const msg = await channel.messages.fetch(messageId);
    await msg.delete();
    return true;
  } catch {
    return false;
  }
}

// Re-stick after a message lands in a channel with a sticky. Returns true
// when the sticky was re-posted, false otherwise (including "already last").
// Guards: bot/DM messages never reach here (messageCreate filters them);
// the sticky's own repost is a bot message, so it cannot loop on itself;
// the sticky is only deleted + re-posted when the channel's last message is
// NOT the sticky (one fetch per message, only in channels that have one);
// a manually deleted sticky is re-posted on the next message (stale id is
// just a failed delete); missing Send/Manage Messages permission fails
// silently with a warn log, never a channel message.
async function handleMessage(message) {
  if (!db.isEnabled() || message.author.bot || !message.guild) return false;
  const row = await getSticky(message.guildId, message.channelId).catch(() => null);
  if (!row || !row.content) return false;
  const channel = message.channel;

  // Definitive last-message check (one API call, only in sticky channels).
  let last;
  try {
    const fetched = await channel.messages.fetch({ limit: 1 });
    last = fetched.first() || undefined;
  } catch (err) {
    logWarn(`Sticky: could not fetch last message in #${channel.name || channel.id} — skipping re-stick.`, { guildId: message.guildId, channelId: message.channelId });
    return false;
  }
  // Already last (by id), or our own repost that raced a second message
  // (same content from the bot) — nothing to do.
  const botId = message.client?.user?.id;
  if (last && (last.id === row.message_id || (botId && last.author?.id === botId && last.content === row.content))) return false;

  const perms = channel.permissionsFor?.(message.guild.members.me);
  if (!perms?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages])) {
    logWarn(`Sticky: missing Send Messages / Manage Messages in #${channel.name || channel.id} — cannot re-stick.`, { guildId: message.guildId, channelId: message.channelId });
    return false;
  }

  await deleteStickyMessage(channel, row.message_id);
  let sent = null;
  try {
    sent = await channel.send({ content: row.content });
  } catch (err) {
    logWarn(`Sticky: could not re-post in #${channel.name || channel.id}: ${err.message}`, { guildId: message.guildId, channelId: message.channelId });
    return false;
  }
  if (sent) {
    await db.query('UPDATE sticky_messages SET message_id = ? WHERE guild_id = ? AND channel_id = ?', [sent.id, message.guildId, message.channelId]).catch(() => {});
  }
  return true;
}

module.exports = { getSticky, setStickyRow, removeStickyRow, deleteStickyMessage, handleMessage };

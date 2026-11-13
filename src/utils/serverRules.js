// Server rules (1.9.5): one rules message per guild, stored in the
// server_rules table (guild_id PRIMARY KEY). postRules posts a fresh embed
// or edits the stored message in place; re-running /rules-setup never
// duplicates the message. All DB helpers degrade gracefully (return null /
// false) when MySQL is down — query() returns null then, never throws.
const { infoEmbed } = require('./embeds');
const db = require('./database');

const MAX_TITLE_LENGTH = 256;
const MAX_CONTENT_LENGTH = 4000;

function formatRulesEmbed(title, content) {
  return infoEmbed(`📜 ${title}`, content);
}

async function getRules(guildId) {
  const rows = await db.query(
    'SELECT guild_id, title, content, channel_id, message_id, updated_at FROM server_rules WHERE guild_id = ?',
    [guildId],
  );
  if (!rows?.length) return null;
  const r = rows[0];
  return {
    guildId: r.guild_id,
    title: r.title,
    content: r.content,
    channelId: r.channel_id,
    messageId: r.message_id,
    updatedAt: r.updated_at,
  };
}

async function saveRules(guildId, { title, content, channelId, messageId }) {
  const result = await db.query(
    `INSERT INTO server_rules (guild_id, title, content, channel_id, message_id, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content),
       channel_id = VALUES(channel_id), message_id = VALUES(message_id),
       updated_at = CURRENT_TIMESTAMP`,
    [guildId, title, content, channelId || null, messageId || null],
  );
  return result !== null;
}

// Post the rules embed to a channel, or edit the existing rules message
// (when messageId is stored) instead of posting a duplicate. Returns
// { ok, messageId, channelId } — ok:false with an error string when the
// channel/message can't be reached.
async function postRules(guild, channelId, title, content) {
  const embed = formatRulesEmbed(title, content);
  const existing = await getRules(guild.id);
  if (existing?.messageId && existing.channelId === channelId) {
    const channel = guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) {
      try {
        const message = await channel.messages.fetch(existing.messageId);
        await message.edit({ embeds: [embed] });
        return { ok: true, messageId: existing.messageId, channelId, edited: true };
      } catch (err) {
        // Stored message is gone/uneditable — fall through and post fresh.
      }
    }
  }
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, error: 'channel not found or not text-based' };
  try {
    const message = await channel.send({ embeds: [embed] });
    return { ok: true, messageId: message.id, channelId, edited: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Edit the already-posted rules message in place after a /rules-edit.
// Returns { ok, error? }.
async function editPostedRules(guild, { title, content }) {
  const existing = await getRules(guild.id);
  if (!existing?.messageId || !existing.channelId) return { ok: false, error: 'no posted rules message' };
  const channel = guild.channels.cache.get(existing.channelId)
    || await guild.channels.fetch(existing.channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, error: 'rules channel not found or not text-based' };
  try {
    const message = await channel.messages.fetch(existing.messageId);
    await message.edit({ embeds: [formatRulesEmbed(title, content)] });
    return { ok: true, messageId: existing.messageId, channelId: existing.channelId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  formatRulesEmbed, getRules, saveRules, postRules, editPostedRules,
  MAX_TITLE_LENGTH, MAX_CONTENT_LENGTH,
};

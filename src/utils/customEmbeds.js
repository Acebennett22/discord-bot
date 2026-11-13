// Embed builder (1.7.8): build embeds via modal, post them, and re-edit
// them later. Stored in the embeds table so the dashboard can list/edit
// them too. Only embeds the bot itself posted can be edited.
const { EmbedBuilder } = require('discord.js');
const db = require('./database');

function buildEmbedFromData(data) {
  const embed = new EmbedBuilder();
  if (data.title) embed.setTitle(data.title.slice(0, 256));
  if (data.description) embed.setDescription(data.description.slice(0, 4096));
  if (data.color) {
    const color = data.color.startsWith('#') ? data.color : `#${data.color}`;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) embed.setColor(color);
  }
  if (data.image && /^https?:\/\//.test(data.image)) embed.setImage(data.image);
  if (data.footer) embed.setFooter({ text: data.footer.slice(0, 2048) });
  embed.setTimestamp();
  return embed;
}

async function saveEmbed(guildId, channelId, messageId, data, createdBy) {
  const res = await db.query(
    'INSERT INTO embeds (guild_id, message_id, channel_id, embed_json, created_by) VALUES (?, ?, ?, ?, ?)',
    [guildId, messageId, channelId, JSON.stringify(data), createdBy],
  );
  return res.insertId;
}

async function getEmbed(id, guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM embeds WHERE id = ? AND guild_id = ?', [id, guildId]);
  if (!rows?.length) return null;
  const row = rows[0];
  try { row.data = JSON.parse(row.embed_json); } catch { row.data = {}; }
  return row;
}

async function getEmbedByMessage(guildId, messageId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM embeds WHERE guild_id = ? AND message_id = ?', [guildId, messageId]);
  if (!rows?.length) return null;
  const row = rows[0];
  try { row.data = JSON.parse(row.embed_json); } catch { row.data = {}; }
  return row;
}

async function listEmbeds(guildId, limit = 25) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM embeds WHERE guild_id = ? ORDER BY updated_at DESC LIMIT ?', [guildId, limit])) || [];
}

async function updateEmbed(id, guildId, data) {
  await db.query('UPDATE embeds SET embed_json = ? WHERE id = ? AND guild_id = ?', [JSON.stringify(data), id, guildId]);
}

async function deleteEmbed(id, guildId) {
  const res = await db.query('DELETE FROM embeds WHERE id = ? AND guild_id = ?', [id, guildId]);
  return (res?.affectedRows || 0) > 0;
}

module.exports = { buildEmbedFromData, saveEmbed, getEmbed, getEmbedByMessage, listEmbeds, updateEmbed, deleteEmbed };

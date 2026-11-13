// Message bookmarks (1.8.6): save any message you can read to your own
// list, with a jump link. Content is stored as an excerpt only (first 500
// chars) — never the full message body.
const db = require('./database');

const MAX_EXCERPT = 500;

async function addBookmark(guildId, userId, message, note) {
  const res = await db.query(
    'INSERT INTO bookmarks (guild_id, user_id, message_id, channel_id, author_id, content_excerpt, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [guildId, userId, message.id, message.channelId, message.author?.id || null, (message.content || '').slice(0, MAX_EXCERPT) || null, note || null],
  );
  return res.insertId;
}

async function listBookmarks(guildId, userId, limit = 25) {
  if (!db.isEnabled()) return [];
  return (await db.query(
    'SELECT * FROM bookmarks WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?',
    [guildId, userId, limit],
  )) || [];
}

async function removeBookmark(guildId, userId, id) {
  const res = await db.query('DELETE FROM bookmarks WHERE id = ? AND guild_id = ? AND user_id = ?', [id, guildId, userId]);
  return (res?.affectedRows || 0) > 0;
}

function jumpLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

module.exports = { addBookmark, listBookmarks, removeBookmark, jumpLink, MAX_EXCERPT };

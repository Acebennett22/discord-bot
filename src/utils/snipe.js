// Snipe (1.7.7): the last deleted / edited message per channel, kept in
// MEMORY ONLY with a 10-minute TTL. Deleted-message content is sensitive,
// so it is never written to the DB or the error logger.
const TTL_MS = 10 * 60_000;

// channelId -> { content, authorId, authorTag, avatarUrl, attachments, deletedAt }
const deleted = new Map();
// channelId -> { before, after, authorId, authorTag, avatarUrl, editedAt }
const edited = new Map();

function prune(map) {
  const now = Date.now();
  for (const [k, v] of map) {
    const at = v.deletedAt || v.editedAt || 0;
    if (now - at > TTL_MS) map.delete(k);
  }
}

function recordDelete(message) {
  if (!message?.guild || !message.author || message.author.bot) return;
  prune(deleted);
  deleted.set(message.channelId, {
    content: message.content || '',
    authorId: message.author.id,
    authorTag: message.author.tag,
    avatarUrl: message.author.displayAvatarURL(),
    attachments: (message.attachments || []).map((a) => a.url).slice(0, 5),
    deletedAt: Date.now(),
  });
}

function recordEdit(oldMessage, newMessage) {
  if (!oldMessage?.guild || !oldMessage.author || oldMessage.author.bot) return;
  if (oldMessage.content === newMessage.content) return;
  prune(edited);
  edited.set(oldMessage.channelId, {
    before: oldMessage.content || '',
    after: newMessage.content || '',
    authorId: oldMessage.author.id,
    authorTag: oldMessage.author.tag,
    avatarUrl: oldMessage.author.displayAvatarURL(),
    editedAt: Date.now(),
  });
}

function getDeleted(channelId) {
  prune(deleted);
  return deleted.get(channelId) || null;
}

function getEdited(channelId) {
  prune(edited);
  return edited.get(channelId) || null;
}

module.exports = { recordDelete, recordEdit, getDeleted, getEdited, TTL_MS };

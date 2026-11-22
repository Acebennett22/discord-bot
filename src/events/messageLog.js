// Message logging (modlog): deleted + edited messages are stored in MySQL
// and posted to the configured modlog channel. Content that looks like a
// token/password is redacted before it is stored or posted. Only logs when
// a modlog channel is set for the guild.
const { Events, AuditLogEvent } = require('discord.js');
const db = require('../utils/database');
const { fetchLogChannel } = require('../utils/logChannels');
const { infoEmbed } = require('../utils/embeds');
const { resolveActor } = require('../utils/resolveActor');

const SECRET_PATTERN = /(token|password|passwd|secret|api[-_]?key|apikey|auth)[\s=:]+[^\s]{4,}/gi;
const DISCORD_TOKEN = /[MN][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;

function redact(text) {
  if (!text) return text;
  return text.replace(SECRET_PATTERN, '$1: [REDACTED]').replace(DISCORD_TOKEN, '[REDACTED TOKEN]');
}

function excerpt(text, max = 1000) {
  if (!text) return '*[no text / embed only]*';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

async function modlogChannel(guild) {
  // 1.16.20: the message log channel — per-type channel if set, else the
  // master log channel, else nowhere.
  return fetchLogChannel(guild, 'message');
}

// Who deleted a message (1.16.4). A mod (or the bot itself, e.g. a purge
// or automod) deleting someone else's message writes a MESSAGE_DELETE
// audit entry: executor = the deleter, target = the author, and the entry
// carries the channel — so the lookup matches both the author and the
// channel. A bulk delete writes one MESSAGE_BULK_DELETE entry instead,
// whose target is the channel, so that is the fallback. When the author
// deletes their own message Discord writes NO audit entry at all, so
// "no entry after the retry" honestly means self-deleted — the log says
// so instead of a bare 'unknown'.
async function resolveDeletedBy(message) {
  const byMod = await resolveActor(message.guild, AuditLogEvent.MessageDelete, message.author.id, {
    extraMatch: (e) => e.extra?.channel?.id === message.channelId,
  });
  if (byMod !== 'unknown') return byMod;
  const byBulk = await resolveActor(message.guild, AuditLogEvent.MessageBulkDelete, message.channelId);
  if (byBulk !== 'unknown') return byBulk;
  return 'the author (deleted their own message)';
}

module.exports = [
  {
    name: Events.MessageDelete,
    async execute(message) {
      if (!message.guild || message.author?.bot || !db.isEnabled()) return;
      try {
        const content = redact(message.content || '');
        await db.query(
          "INSERT INTO message_logs (guild_id, message_id, channel_id, user_id, content, action) VALUES (?, ?, ?, ?, ?, 'deleted')",
          [message.guild.id, message.id, message.channelId, message.author.id, content || null],
        );
        const channel = await modlogChannel(message.guild);
        if (!channel) return;
        const deletedBy = await resolveDeletedBy(message);
        await channel.send({
          embeds: [infoEmbed('🗑️ Message deleted',
            `**Author:** ${message.author.tag} (<@${message.author.id}>)\n**Deleted by:** ${deletedBy}\n**Channel:** <#${message.channelId}>\n**Content:**\n${excerpt(content)}`)],
        }).catch(() => {});
      } catch {}
    },
  },
  {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
      if (!newMessage.guild || newMessage.author?.bot || !db.isEnabled()) return;
      if (!oldMessage.content || oldMessage.content === newMessage.content) return;
      try {
        const oldContent = redact(oldMessage.content);
        const newContent = redact(newMessage.content || '');
        await db.query(
          "INSERT INTO message_logs (guild_id, message_id, channel_id, user_id, content, action, old_content, new_content) VALUES (?, ?, ?, ?, ?, 'edited', ?, ?)",
          [newMessage.guild.id, newMessage.id, newMessage.channelId, newMessage.author.id, newContent || null, oldContent, newContent],
        );
        const channel = await modlogChannel(newMessage.guild);
        if (!channel) return;
        const jump = `https://discord.com/channels/${newMessage.guild.id}/${newMessage.channelId}/${newMessage.id}`;
        await channel.send({
          embeds: [infoEmbed('✏️ Message edited',
            `**Author:** ${newMessage.author.tag} (<@${newMessage.author.id}>)\n**Channel:** <#${newMessage.channelId}> — [jump to message](${jump})\n**Before:**\n${excerpt(oldContent)}\n**After:**\n${excerpt(newContent)}`)],
        }).catch(() => {});
      } catch {}
    },
  },
];

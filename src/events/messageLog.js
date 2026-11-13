// Message logging (modlog): deleted + edited messages are stored in MySQL
// and posted to the configured modlog channel. Content that looks like a
// token/password is redacted before it is stored or posted. Only logs when
// a modlog channel is set for the guild.
const { Events } = require('discord.js');
const db = require('../utils/database');
const { getPremiumSettings } = require('../utils/premiumSettings');
const { infoEmbed } = require('../utils/embeds');

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
  const settings = await getPremiumSettings(guild.id);
  if (!settings.modlogChannelId) return null;
  const channel = guild.channels.cache.get(settings.modlogChannelId)
    || await guild.channels.fetch(settings.modlogChannelId).catch(() => null);
  return channel?.isTextBased() ? channel : null;
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
        await channel.send({
          embeds: [infoEmbed('🗑️ Message deleted',
            `**Author:** ${message.author.tag} (<@${message.author.id}>)\n**Channel:** <#${message.channelId}>\n**Content:**\n${excerpt(content)}`)],
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

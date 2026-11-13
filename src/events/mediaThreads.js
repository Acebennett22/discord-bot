// Media auto-threads (1.5.1): messages with image/video attachments in a
// configured media channel get a discussion thread, so the channel stays
// clean. Bot messages are skipped; failures are logged, never fatal, and
// the original message is never deleted.
const { Events } = require('discord.js');
const { getGuildSettings } = require('../utils/guildSettings');
const { logWarn } = require('../utils/errorLogger');

const MEDIA_TYPES = ['image/', 'video/'];

function hasMedia(message) {
  return [...message.attachments.values()].some((a) => {
    const type = a.contentType || '';
    return MEDIA_TYPES.some((prefix) => type.startsWith(prefix))
      || /\.(png|jpe?g|gif|webp|mp4|mov|webm)$/i.test(a.name || '');
  });
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild || !hasMedia(message)) return;
    const settings = await getGuildSettings(message.guildId).catch(() => null);
    if (!settings?.mediaChannels?.includes(message.channelId)) return;
    const title = message.content.trim()
      ? message.content.trim().slice(0, 50)
      : `Discussion — ${message.author.username}`;
    try {
      await message.startThread({ name: title.slice(0, 100), autoArchiveDuration: 1440 });
    } catch (err) {
      await logWarn('media thread failed', { guildId: message.guildId, channelId: message.channelId, messageId: message.id, error: err.message });
    }
  },
};

// Auto-publish announcements (1.8.7): messages posted in configured
// announcement channels (GUILD_ANNOUNCEMENT) are automatically
// crossposted/published. Bot messages and already-published messages are
// skipped; failures go to the error logger.
const { getGuildSettings, setGuildSettings } = require('./guildSettings');
const errorLogger = require('./errorLogger');

async function getAutopublishChannels(guildId) {
  const settings = await getGuildSettings(guildId);
  return settings.autopublishChannels || [];
}

async function addChannel(guildId, channelId) {
  const settings = await getGuildSettings(guildId);
  const list = new Set(settings.autopublishChannels || []);
  list.add(channelId);
  await setGuildSettings(guildId, { autopublishChannels: [...list] });
  return [...list];
}

async function removeChannel(guildId, channelId) {
  const settings = await getGuildSettings(guildId);
  const list = (settings.autopublishChannels || []).filter((id) => id !== channelId);
  await setGuildSettings(guildId, { autopublishChannels: list });
  return list;
}

async function handleMessage(message) {
  if (!message.guild || message.author?.bot) return;
  if (message.channel.type !== 5) return; // GUILD_ANNOUNCEMENT only
  if (message.flags?.has('Crossposted') || message.flags?.has('IsCrosspost')) return;
  const channels = await getAutopublishChannels(message.guild.id).catch(() => []);
  if (!channels.includes(message.channel.id)) return;
  await message.crosspost().catch((err) => {
    errorLogger.log({ level: 'error', guildId: message.guild.id, commandName: 'autopublish', message: `Failed to publish message ${message.id} in #${message.channel.id}: ${err.message}` });
  });
}

module.exports = { getAutopublishChannels, addChannel, removeChannel, handleMessage };

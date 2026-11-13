// ServerStats-style live stat channels: display-only voice channels whose
// names show live counts, e.g. "👥 Members: 1,234".
// Only the shard that owns the guild updates it. Renames only happen when the
// value actually changed (rate-limit safe), and updates are debounced.
const { ChannelType, PermissionsBitField } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('./guildSettings');

const STATS = {
  members: { label: 'Members', emoji: '👥', compute: (g) => g.memberCount },
  online: { label: 'Online', emoji: '🟢', compute: (g) => g.members.cache.filter((m) => m.presence?.status && m.presence.status !== 'offline').size },
  bots: { label: 'Bots', emoji: '🤖', compute: (g) => g.members.cache.filter((m) => m.user.bot).size },
  boosts: { label: 'Boosts', emoji: '🏆', compute: (g) => g.premiumSubscriptionCount || 0 },
  channels: { label: 'Channels', emoji: '💬', compute: (g) => g.channels.cache.size },
  roles: { label: 'Roles', emoji: '🎭', compute: (g) => g.roles.cache.size },
};

const debounceTimers = new Map();

function statChannelName(key, value) {
  const s = STATS[key];
  return `${s.emoji} ${s.label}: ${Number(value).toLocaleString()}`;
}

async function updateServerStats(guild) {
  const settings = await getGuildSettings(guild.id);
  if (!settings.serverStatsEnabled) return;
  const channels = settings.serverStatsChannels || {};
  for (const [key, channelId] of Object.entries(channels)) {
    if (!STATS[key]) continue;
    const value = STATS[key].compute(guild);
    const name = statChannelName(key, value);
    const channel = guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;
    if (channel.name !== name) {
      await channel.setName(name).catch(() => {});
    }
  }
}

function scheduleUpdate(guild, delayMs = 5000) {
  if (debounceTimers.has(guild.id)) clearTimeout(debounceTimers.get(guild.id));
  debounceTimers.set(guild.id, setTimeout(() => {
    debounceTimers.delete(guild.id);
    updateServerStats(guild).catch(() => {});
  }, delayMs));
}

async function createStatChannels(guild, enabledKeys) {
  const settings = await getGuildSettings(guild.id);
  const category = await guild.channels.create({
    name: '📊 Server Stats',
    type: ChannelType.GuildCategory,
  });
  const channels = { ...(settings.serverStatsChannels || {}) };
  for (const key of enabledKeys) {
    if (!STATS[key]) continue;
    const value = STATS[key].compute(guild);
    const channel = await guild.channels.create({
      name: statChannelName(key, value),
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.Connect] },
      ],
    });
    channels[key] = channel.id;
  }
  await setGuildSettings(guild.id, { serverStatsEnabled: true, serverStatsChannels: channels });
  return channels;
}

module.exports = { STATS, updateServerStats, scheduleUpdate, createStatChannels, statChannelName };

// 24/7 music mode (1.12.1): keep the bot connected to a configured voice
// channel around the clock. Rejoins on disconnect/kick unless an admin
// disabled it. When the queue empties the bot stays connected and idle —
// musicQueue checks guildSettings.music247Enabled before its 60s idle
// destroy. Pure state lives here; the periodic checker is started from
// premiumReady.
const { getVoiceConnection } = require('@discordjs/voice');
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { infoEmbed } = require('./embeds');
const errorLogger = require('./errorLogger');

const rejoining = new Set(); // guildIds with a rejoin already scheduled

async function ensure247(client, guildId) {
  if (!db.isEnabled()) return false;
  const settings = await getGuildSettings(guildId).catch(() => null);
  if (!settings?.music247Enabled || !settings.music247ChannelId) return false;
  if (getVoiceConnection(guildId)) return true;
  const channel = await client.channels.fetch(settings.music247ChannelId).catch(() => null);
  if (!channel?.isVoiceBased?.()) return false;
  try {
    const { createQueue } = require('./musicQueue');
    createQueue(guildId, channel, null);
    errorLogger.log({ level: 'info', guildId, commandName: '247', message: `24/7: (re)joined voice channel ${channel.id}.` });
    return true;
  } catch (err) {
    errorLogger.log({ level: 'error', guildId, commandName: '247', message: `24/7 rejoin failed: ${err.message}`, stack: err.stack });
    return false;
  }
}

// Called on VoiceStateUpdate when the bot itself leaves a voice channel.
// If 24/7 is on for that guild, rejoin after a short delay (covers kicks
// and disconnects; a manual /stop still destroys the queue and the
// checker only rejoins while 24/7 is enabled).
async function handleBotVoiceLeave(client, oldState) {
  const guildId = oldState.guild.id;
  if (rejoining.has(guildId)) return;
  const settings = await getGuildSettings(guildId).catch(() => null);
  if (!settings?.music247Enabled || !settings.music247ChannelId) return;
  if (oldState.channelId !== settings.music247ChannelId) return;
  rejoining.add(guildId);
  setTimeout(async () => {
    rejoining.delete(guildId);
    await ensure247(client, guildId).catch(() => {});
  }, 3000);
}

function start247Checker(client) {
  setInterval(async () => {
    if (!db.isEnabled()) return;
    let rows = [];
    try {
      rows = await db.query('SELECT guild_id FROM guild_settings WHERE music247_enabled = 1 AND music247_channel_id IS NOT NULL') || [];
    } catch { return; }
    for (const r of rows) {
      await ensure247(client, r.guild_id).catch(() => {});
    }
  }, 60_000);
}

module.exports = { ensure247, handleBotVoiceLeave, start247Checker };

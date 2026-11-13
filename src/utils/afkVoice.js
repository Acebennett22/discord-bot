// AFK voice kick (1.7.4) + AFK channel auto-create (1.8.5).
// Tracks when a member goes muted/deafened in voice; a 5-minute timer
// moves anyone idle past the threshold to the AFK channel (or disconnects
// them if no AFK channel is set). Bots, members already in the AFK channel,
// and the configured exempt staff role are never moved.
// Auto-create: when the primary AFK channel hits afk_max_users, a second
// AFK channel ("AFK 2") is created in the same category; it is deleted when
// it empties, and also when the primary has been empty for 10 minutes.
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const errorLogger = require('./errorLogger');

// guildId -> Map(userId -> { channelId, since })
const idleSince = new Map();
// guildId -> { channelId, createdAt }
const extraAfkChannels = new Map();
// guildId -> timestamp the primary AFK channel was last seen non-empty
const primaryEmptySince = new Map();

function isIdle(state) {
  return state.selfMute || state.selfDeaf || state.serverMute || state.serverDeaf;
}

async function handleVoiceState(oldState, newState) {
  const guildId = newState.guild?.id || oldState.guild?.id;
  if (!guildId) return;
  const userId = newState.member?.id || oldState.member?.id;
  if (!userId) return;
  if (!idleSince.has(guildId)) idleSince.set(guildId, new Map());
  const map = idleSince.get(guildId);
  const channelId = newState.channelId;
  if (!channelId || !isIdle(newState)) { map.delete(userId); return; }
  if (!map.has(userId) || map.get(userId).channelId !== channelId) {
    map.set(userId, { channelId, since: Date.now() });
  }
}

async function checkAfkVoice(client) {
  if (!db.isEnabled()) return;
  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) {
    try {
      const settings = await getGuildSettings(guild.id);
      // --- Auto-create (1.8.5) ---
      if (settings.afkAutocreateEnabled && settings.afkChannelId) {
        const primary = guild.channels.cache.get(settings.afkChannelId)
          || await guild.channels.fetch(settings.afkChannelId).catch(() => null);
        if (primary?.isVoiceBased()) {
          const count = primary.members.size;
          const extra = extraAfkChannels.get(guild.id);
          if (count >= (settings.afkMaxUsers ?? 10) && !extra) {
            const created = await guild.channels.create({
              name: 'AFK 2', type: 2, parent: primary.parentId || null,
              reason: 'AFK channel auto-create: primary AFK channel is full',
            }).catch(() => null);
            if (created) extraAfkChannels.set(guild.id, { channelId: created.id, createdAt: Date.now() });
          }
          if (extra) {
            const extraChannel = guild.channels.cache.get(extra.channelId)
              || await guild.channels.fetch(extra.channelId).catch(() => null);
            if (!extraChannel) { extraAfkChannels.delete(guild.id); }
            else if (extraChannel.members.size === 0) {
              if (count === 0) {
                const emptySince = primaryEmptySince.get(guild.id);
                if (!emptySince) primaryEmptySince.set(guild.id, Date.now());
                else if (Date.now() - emptySince > 10 * 60_000) {
                  await extraChannel.delete('AFK auto-create: both AFK channels empty').catch(() => {});
                  extraAfkChannels.delete(guild.id);
                  primaryEmptySince.delete(guild.id);
                }
              } else {
                primaryEmptySince.delete(guild.id);
                await extraChannel.delete('AFK auto-create: secondary AFK channel empty').catch(() => {});
                extraAfkChannels.delete(guild.id);
              }
            } else {
              primaryEmptySince.delete(guild.id);
            }
          }
          if (count > 0) primaryEmptySince.delete(guild.id);
        }
      }
      // --- AFK kick (1.7.4) ---
      if (!settings.afkVoiceEnabled) continue;
      const thresholdMs = (settings.afkVoiceMinutes ?? 30) * 60_000;
      const map = idleSince.get(guild.id);
      if (!map?.size) continue;
      for (const [userId, rec] of [...map.entries()]) {
        if (Date.now() - rec.since < thresholdMs) continue;
        map.delete(userId);
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (!member || member.user.bot) continue;
        const voice = member.voice;
        if (!voice.channelId || voice.channelId !== rec.channelId) continue;
        if (settings.afkVoiceChannelId && voice.channelId === settings.afkVoiceChannelId) continue;
        if (settings.afkVoiceExemptRoleId && member.roles.cache.has(settings.afkVoiceExemptRoleId)) continue;
        if (settings.afkVoiceChannelId) {
          const target = guild.channels.cache.get(settings.afkVoiceChannelId)
            || await guild.channels.fetch(settings.afkVoiceChannelId).catch(() => null);
          if (!target?.isVoiceBased()) continue;
          await member.voice.setChannel(target, 'AFK voice kick: idle too long').catch(() => {});
          await db.query(
            'INSERT INTO afk_voice_moves (guild_id, user_id, from_channel_id, to_channel_id, disconnected) VALUES (?, ?, ?, ?, 0)',
            [guild.id, userId, voice.channelId, target.id],
          ).catch(() => {});
        } else {
          await member.voice.disconnect('AFK voice kick: idle too long').catch(() => {});
          await db.query(
            'INSERT INTO afk_voice_moves (guild_id, user_id, from_channel_id, to_channel_id, disconnected) VALUES (?, ?, ?, NULL, 1)',
            [guild.id, userId, voice.channelId],
          ).catch(() => {});
        }
        // Modlog, if configured.
        if (settings.logChannelId) {
          const log = guild.channels.cache.get(settings.logChannelId)
            || await guild.channels.fetch(settings.logChannelId).catch(() => null);
          if (log?.isTextBased()) {
            const { infoEmbed } = require('./embeds');
            await log.send({ embeds: [infoEmbed('😴 AFK voice kick', `<@${userId}> was idle in voice for ${settings.afkVoiceMinutes ?? 30}+ minutes and was moved to the AFK channel.`, [])] }).catch(() => {});
          }
        }
      }
    } catch (e) {
      errorLogger.log({ level: 'error', guildId: guild.id, commandName: 'afkvoice', message: `AFK voice tick failed: ${e.message}`, stack: e.stack });
    }
  }
}

function startAfkVoiceChecker(client) {
  const tick = () => checkAfkVoice(client);
  tick();
  setInterval(tick, 5 * 60_000);
}

module.exports = { handleVoiceState, checkAfkVoice, startAfkVoiceChecker, idleSince, extraAfkChannels };

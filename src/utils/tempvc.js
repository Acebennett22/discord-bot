// Temporary voice channels: joining the designated "create" channel spins
// up a personal voice channel for that member; it is deleted when empty.
const { ChannelType, PermissionsBitField } = require('discord.js');
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');

function tempChannelName(member) {
  const name = member.displayName || member.user.username;
  return `${name}'s Channel`;
}

async function isTempChannel(guildId, channelId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM temp_channels WHERE guild_id = ? AND channel_id = ?', [guildId, channelId]);
  return rows?.[0] || null;
}

async function handleVoiceState(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;
  const settings = await getGuildSettings(guild.id).catch(() => null);
  if (!settings) return;

  // --- Left a channel: delete empty temp channels. ---
  const leftId = oldState.channelId;
  if (leftId && leftId !== newState.channelId) {
    const temp = await isTempChannel(guild.id, leftId);
    if (temp) {
      const channel = guild.channels.cache.get(leftId);
      if (channel && channel.members.size === 0) {
        await channel.delete('Temp VC empty').catch(() => {});
        await db.query('DELETE FROM temp_channels WHERE guild_id = ? AND channel_id = ?', [guild.id, leftId]);
      }
    }
  }

  // --- Joined the create channel: make a personal channel. ---
  const joinedId = newState.channelId;
  if (!joinedId || !settings.tempvcCreateChannelId || joinedId !== settings.tempvcCreateChannelId) return;
  const member = newState.member;
  if (!member) return;
  const parentId = settings.tempvcCategoryId || newState.channel.parentId || null;
  try {
    const channel = await guild.channels.create({
      name: tempChannelName(member),
      type: ChannelType.GuildVoice,
      parent: parentId,
      permissionOverwrites: [
        { id: member.id, allow: [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.MoveMembers] },
      ],
    });
    if (db.isEnabled()) {
      await db.query(
        'INSERT INTO temp_channels (guild_id, channel_id, owner_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE owner_id = VALUES(owner_id)',
        [guild.id, channel.id, member.id],
      );
    }
    await member.voice.setChannel(channel).catch(() => {});
  } catch {
    // Creation failed (missing perms/category) — leave the member in place.
  }
}

// Owner-only management helpers used by /tempvc.
async function requireTempOwner(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) return { ok: false, reason: 'Join your temp voice channel first.' };
  const temp = await isTempChannel(interaction.guildId, voiceChannel.id);
  if (!temp) return { ok: false, reason: 'That is not a temp voice channel.' };
  if (temp.owner_id !== interaction.user.id) return { ok: false, reason: 'Only the channel owner can manage it. Use /tempvc claim if the owner left.' };
  return { ok: true, channel: voiceChannel, temp };
}

module.exports = { tempChannelName, isTempChannel, handleVoiceState, requireTempOwner };

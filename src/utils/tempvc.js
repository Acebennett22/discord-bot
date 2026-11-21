// Temporary voice channels: joining a hub ("create") channel spins up a
// personal voice channel for that member; it is deleted when empty.
// (1.16.17) A server can have several hubs — one row per hub in
// tempvc_hubs, each with its own category. The old single-hub guild
// settings (tempvcCreateChannelId / tempvcCategoryId) are a legacy
// fallback: a server with no hub rows keeps working exactly as before.
const { ChannelType, PermissionsBitField } = require('discord.js');
const db = require('./database');
const { getGuildSettings, setGuildSettings } = require('./guildSettings');

// At most 10 hubs per server — Discord caps a server at 500 channels, and
// 10 hubs is far more than any server needs.
const MAX_HUBS = 10;

function tempChannelName(member) {
  const name = member.displayName || member.user.username;
  return `${name}'s Channel`;
}

async function isTempChannel(guildId, channelId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM temp_channels WHERE guild_id = ? AND channel_id = ?', [guildId, channelId]);
  return rows?.[0] || null;
}

// --- Hubs (1.16.17) ---------------------------------------------------------

async function listHubs(guildId) {
  if (!db.isEnabled()) return [];
  const rows = await db.query('SELECT guild_id, create_channel_id, category_id, created_by_bot, created_at FROM tempvc_hubs WHERE guild_id = ? ORDER BY created_at', [guildId]);
  return rows || [];
}

async function getHub(guildId, createChannelId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM tempvc_hubs WHERE guild_id = ? AND create_channel_id = ?', [guildId, createChannelId]);
  return rows?.[0] || null;
}

// Migrate the legacy single hub (guild settings) into the hubs table the
// first time a guild's hubs are managed, so an existing server loses
// nothing. The legacy settings are NOT cleared — they stay as the fallback
// for a guild with no hub rows at all (see handleVoiceState).
async function migrateLegacyHub(guildId, settings) {
  if (!db.isEnabled() || !settings?.tempvcCreateChannelId) return null;
  const existing = await listHubs(guildId);
  if (existing.length) return null;
  await db.query(
    'INSERT IGNORE INTO tempvc_hubs (guild_id, create_channel_id, category_id, created_by_bot) VALUES (?, ?, ?, 0)',
    [guildId, settings.tempvcCreateChannelId, settings.tempvcCategoryId || null],
  );
  return getHub(guildId, settings.tempvcCreateChannelId);
}

// Register a hub. Returns the queryDetailed result ({ rows, error }) so a
// failed save is visible to the caller — the caller just created (or is
// about to keep) a Discord channel for this hub, so a silent failure
// would leave an orphan channel that spawns nothing.
async function registerHub(guildId, createChannelId, categoryId, createdByBot = 1) {
  return db.queryDetailed(
    'INSERT INTO tempvc_hubs (guild_id, create_channel_id, category_id, created_by_bot) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), created_by_bot = VALUES(created_by_bot)',
    [guildId, createChannelId, categoryId || null, createdByBot ? 1 : 0],
  );
}

async function unregisterHub(guildId, createChannelId) {
  await db.query('DELETE FROM tempvc_hubs WHERE guild_id = ? AND create_channel_id = ?', [guildId, createChannelId]);
}

// Removing the migrated legacy hub must also clear the legacy guild
// settings — otherwise the next hub management action would migrate it
// straight back (no hub rows + legacy settings still set) and the removal
// would not stick. Migration itself never clears them; only an explicit
// removal of that hub does. Bot-created hubs never match the legacy
// settings, so they are unaffected.
async function clearLegacySettingsIfMatches(guildId, hub, settings) {
  if (!hub || hub.created_by_bot) return;
  if (!settings?.tempvcCreateChannelId || hub.create_channel_id !== settings.tempvcCreateChannelId) return;
  await setGuildSettings(guildId, { tempvcCreateChannelId: '', tempvcCategoryId: '' }).catch(() => {});
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

  // --- Joined a hub channel: make a personal channel in that hub's category. ---
  const joinedId = newState.channelId;
  if (!joinedId) return;
  let parentId = null;
  if (db.isEnabled()) {
    const hubs = await listHubs(guild.id);
    const hub = hubs.find((h) => h.create_channel_id === joinedId);
    if (hub) {
      parentId = hub.category_id || newState.channel.parentId || null;
    } else if (hubs.length === 0) {
      // Legacy fallback: no hub rows — the old single create channel.
      if (!settings.tempvcCreateChannelId || joinedId !== settings.tempvcCreateChannelId) return;
      parentId = settings.tempvcCategoryId || newState.channel.parentId || null;
    } else {
      return; // Hubs exist and this channel is not one of them.
    }
  } else {
    // Database down: hubs cannot be read, so only the legacy settings can match.
    if (!settings.tempvcCreateChannelId || joinedId !== settings.tempvcCreateChannelId) return;
    parentId = settings.tempvcCategoryId || newState.channel.parentId || null;
  }
  const member = newState.member;
  if (!member) return;
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

module.exports = { tempChannelName, isTempChannel, handleVoiceState, requireTempOwner, MAX_HUBS, listHubs, getHub, migrateLegacyHub, registerHub, unregisterHub, clearLegacySettingsIfMatches };

// Thread auto-archive control (1.6.1): every 15 minutes, archive threads
// inactive longer than their configured duration (per-channel override
// wins, else the guild default, default 1440 min = 24h). Only threads the
// bot can manage; pinned threads are never archived, and a thread whose
// last message is from a staff member within the window is skipped.
const { ChannelType, PermissionsBitField } = require('discord.js');
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { logWarn } = require('./errorLogger');

async function getOverride(guildId, channelId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT archive_minutes FROM thread_archive_settings WHERE guild_id = ? AND channel_id = ?', [guildId, channelId]);
  return rows?.[0]?.archive_minutes ?? null;
}

async function checkThreads(client) {
  if (!db.isEnabled()) return 0;
  let archived = 0;
  for (const guild of client.guilds.cache.values()) {
    const settings = await getGuildSettings(guild.id).catch(() => null);
    const defaultMinutes = settings?.threadArchiveMinutes ?? 1440;
    const overrides = await db.query('SELECT channel_id, archive_minutes FROM thread_archive_settings WHERE guild_id = ?', [guild.id]) || [];
    const overrideMap = new Map(overrides.map((o) => [o.channel_id, o.archive_minutes]));
    // Active threads + archived-but-listable threads.
    const active = await guild.channels.fetchActiveThreads().catch(() => null);
    const threads = [...(active?.threads?.values() || [])];
    for (const thread of threads) {
      if (thread.archived) continue;
      if (thread.parent?.type === ChannelType.GuildForum) continue; // forum posts manage themselves
      const minutes = overrideMap.get(thread.parentId) ?? overrideMap.get(thread.id) ?? defaultMinutes;
      const lastMessage = await thread.messages.fetch({ limit: 1 }).catch(() => null);
      const lastAt = lastMessage?.first()?.createdTimestamp || thread.createdTimestamp;
      if (Date.now() - lastAt < minutes * 60_000) continue;
      // Skip pinned threads.
      const pinned = await thread.messages.fetchPinned().catch(() => null);
      if (pinned?.size) continue;
      // Skip threads with recent staff activity (last message from staff
      // within the window = someone is still working it).
      const lastMsg = lastMessage?.first();
      if (lastMsg?.member && (lastMsg.member.permissions.has(PermissionsBitField.Flags.ManageMessages) || lastMsg.member.permissions.has(PermissionsBitField.Flags.Administrator))) continue;
      await thread.setArchived(true, 'Auto-archive: inactive').catch((e) => logWarn('thread auto-archive failed', { guildId: guild.id, threadId: thread.id, error: e.message }));
      archived += 1;
    }
  }
  return archived;
}

let started = false;
function startThreadArchiveChecker(client) {
  if (started) return;
  started = true;
  setInterval(() => checkThreads(client).catch(() => {}), 15 * 60 * 1000);
  setTimeout(() => checkThreads(client).catch(() => {}), 60_000);
}

module.exports = { getOverride, checkThreads, startThreadArchiveChecker };

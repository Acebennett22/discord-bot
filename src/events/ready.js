const { Events, ActivityType } = require('discord.js');
const config = require('../utils/config');
const { updateServerStats } = require('../utils/serverStats');
const { startStreamChecker } = require('../utils/streamNotifier');
const { startGiveawayChecker } = require('../utils/giveaways');
const { startGameServerChecker } = require('../utils/gameServers');
const { initInviteTracker } = require('../utils/inviteTracker');
const { startBackupSchedule } = require('../../scripts/backup-db');
const { reapplyAllIdentities } = require('../utils/botIdentity');
const { loadGuildPrefixes } = require('../utils/guildPrefixes');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    const shardInfo = client.shard ? ` (shard ${client.shard.ids.join(',')} of ${client.shard.count})` : ' (unsharded)';
    console.log(`✅ Logged in as ${client.user.tag} — in ${client.guilds.cache.size} server(s)${shardInfo}.`);
    client.user.setActivity('/ping • /play • /help', { type: ActivityType.Listening });
    // Live server-stats refresh (per-guild, only on the shard owning the guild).
    const intervalMs = (config.serverStats?.updateIntervalMinutes || 10) * 60_000;
    setInterval(() => {
      for (const guild of client.guilds.cache.values()) {
        updateServerStats(guild).catch(() => {});
      }
    }, intervalMs);
    // Live stream notifications (5-min polling; missing platform creds = skipped).
    startStreamChecker(client);
    // Giveaway end checker (every 30s).
    startGiveawayChecker(client);
    // Game server status checker (every gameServers.checkIntervalMinutes).
    startGameServerChecker(client);
    // Invite tracker: prime the per-guild invite caches.
    initInviteTracker(client).catch(() => {});
    // Per-server bot identity (1.16.8): reapply each guild's stored
    // nickname/avatar. Per-shard: a shard only sees its own guilds.
    // Failures are logged per guild inside the util, never thrown.
    reapplyAllIdentities(client).catch(() => {});
    // Per-guild command prefix (1.16.8): load every guild's prefix into
    // memory at startup. Config only for now — slash commands are
    // unchanged and the bot does not respond to prefix commands yet.
    loadGuildPrefixes().catch(() => {});
    // Daily DB backup (node-cron, default 03:00, 30-day retention).
    startBackupSchedule();
  },
};

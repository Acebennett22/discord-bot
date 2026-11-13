// Server analytics: daily snapshots per guild (member count, joins,
// leaves, messages) plus on-demand aggregates. Message counting is
// in-memory and flushed to MySQL every 10 minutes — no DB write per
// message. Joins come from bot_join_stats, leaves from invite_uses
// (left_at), so the 30-day history is only as complete as those tables;
// days before this feature existed show 0 joins/leaves, honestly.
const db = require('./database');

const messageCounts = new Map(); // guildId -> count since last flush
let started = false;

function recordMessage(guildId) {
  if (!guildId) return;
  messageCounts.set(guildId, (messageCounts.get(guildId) || 0) + 1);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function flushMessageCounts() {
  if (!db.isEnabled() || !messageCounts.size) return;
  const entries = [...messageCounts.entries()];
  messageCounts.clear();
  for (const [guildId, count] of entries) {
    await db.query(
      'INSERT INTO guild_daily_stats (guild_id, date, messages_count) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE messages_count = messages_count + VALUES(messages_count)',
      [guildId, todayStr(), count],
    ).catch(() => {});
  }
}

async function snapshotDailyStats(client) {
  if (!db.isEnabled()) return;
  await flushMessageCounts();
  const today = todayStr();
  for (const guild of client.guilds.cache.values()) {
    const joinsRows = await db.query('SELECT total_joins FROM bot_join_stats WHERE guild_id = ? AND date = ?', [guild.id, today]).catch(() => []) || [];
    const leavesRows = await db.query('SELECT COUNT(*) AS c FROM invite_uses WHERE guild_id = ? AND left_at IS NOT NULL AND DATE(left_at) = ?', [guild.id, today]).catch(() => []) || [];
    await db.query(
      'INSERT INTO guild_daily_stats (guild_id, date, member_count, joins, leaves) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE member_count = VALUES(member_count), joins = VALUES(joins), leaves = VALUES(leaves)',
      [guild.id, today, guild.memberCount || 0, joinsRows[0]?.total_joins || 0, leavesRows[0]?.c || 0],
    ).catch(() => {});
  }
}

async function getDailyStats(guildId, days = 30) {
  if (!db.isEnabled()) return [];
  return await db.query(
    'SELECT date, member_count, messages_count, joins, leaves FROM guild_daily_stats WHERE guild_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY date',
    [guildId, days],
  ) || [];
}

async function getTopUsersByXp(guildId, limit = 10) {
  if (!db.isEnabled()) return [];
  return await db.query(
    'SELECT user_id, xp, level FROM user_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?',
    [guildId, limit],
  ) || [];
}

async function getTopChannelsByCommands(guildId, limit = 10) {
  // command_logs is the only per-channel activity the bot records for every
  // command — this is commands used per channel, not all messages.
  if (!db.isEnabled()) return [];
  return await db.query(
    "SELECT channel_id, COUNT(*) AS uses FROM command_logs WHERE guild_id = ? AND channel_id IS NOT NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY channel_id ORDER BY uses DESC LIMIT ?",
    [guildId, limit],
  ) || [];
}

async function getTopUsersByCommands(guildId, limit = 10) {
  if (!db.isEnabled()) return [];
  return await db.query(
    'SELECT user_id, commands_used FROM user_stats WHERE guild_id = ? ORDER BY commands_used DESC LIMIT ?',
    [guildId, limit],
  ) || [];
}

function startAnalytics(client) {
  if (started) return;
  started = true;
  setInterval(() => flushMessageCounts().catch(() => {}), 10 * 60 * 1000);
  setInterval(() => snapshotDailyStats(client).catch(() => {}), 60 * 60 * 1000);
  // Snapshot once shortly after startup so today's row exists.
  setTimeout(() => snapshotDailyStats(client).catch(() => {}), 30_000);
}

module.exports = {
  recordMessage, flushMessageCounts, snapshotDailyStats,
  getDailyStats, getTopUsersByXp, getTopChannelsByCommands, getTopUsersByCommands,
  startAnalytics,
};

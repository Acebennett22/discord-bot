// Inactive-member re-engagement (1.8.8): daily job finds members with no
// activity in the last N days (default 30) and sends a friendly "we miss
// you" DM — at most once per member per 30 days, never to bots, never to
// members who opted out (/reengage-optout).
//
// Activity sources (the bot records these — see README): user_levels.last_xp_at
// (last message that earned XP), voice_sessions (last voice session),
// user_stats.last_seen (last slash-command use). Members who joined less
// than N days ago are excluded. No message content is used — only
// timestamps, so this does not need message-log data.
const db = require('./database');
const { getGuildSettings, setGuildSettings } = require('./guildSettings');
const { infoEmbed } = require('./embeds');
const errorLogger = require('./errorLogger');

async function findInactiveMembers(guild, days) {
  if (!db.isEnabled()) return [];
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const joinedCutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Last activity per user from the three timestamp sources, plus the
  // 30-day message log and opt-outs. The bot has no full member roster
  // table, so we iterate the guild's member list (fetched once a day)
  // and filter in JS.
  const activityRows = await db.query(
    `SELECT u.user_id,
            GREATEST(COALESCE(l.last_xp_at, '1970-01-01'), COALESCE(v.last_voice, '1970-01-01'), COALESCE(s.last_seen, '1970-01-01')) AS last_activity
     FROM (SELECT DISTINCT user_id FROM user_levels WHERE guild_id = ?
           UNION SELECT DISTINCT user_id FROM user_stats WHERE guild_id = ?
           UNION SELECT DISTINCT user_id FROM voice_sessions WHERE guild_id = ?) u
     LEFT JOIN user_levels l ON l.user_id = u.user_id AND l.guild_id = ?
     LEFT JOIN (
       SELECT user_id, MAX(COALESCE(left_at, joined_at)) AS last_voice
       FROM voice_sessions WHERE guild_id = ? GROUP BY user_id
     ) v ON v.user_id = u.user_id
     LEFT JOIN user_stats s ON s.user_id = u.user_id AND s.guild_id = ?`,
    [guild.id, guild.id, guild.id, guild.id, guild.id, guild.id],
  );
  const lastActivity = new Map((activityRows || []).map((r) => [r.user_id, new Date(r.last_activity)]));
  const messagedRows = await db.query(
    'SELECT user_id FROM reengage_logs WHERE guild_id = ? AND messaged_at > DATE_SUB(NOW(), INTERVAL 30 DAY)',
    [guild.id],
  );
  const messaged = new Set((messagedRows || []).map((r) => r.user_id));
  const optoutRows = await db.query('SELECT user_id FROM reengage_optouts WHERE guild_id = ?', [guild.id]);
  const optedOut = new Set((optoutRows || []).map((r) => r.user_id));
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const inactive = [];
  for (const member of members.values()) {
    if (member.user.bot) continue;
    if (member.joinedAt && member.joinedAt > joinedCutoff) continue; // joined < N days ago
    if (messaged.has(member.id) || optedOut.has(member.id)) continue;
    const last = lastActivity.get(member.id);
    // No activity timestamps at all = inactive (they never earned XP,
    // used a slash command, or joined voice).
    if (!last || last < cutoff) inactive.push({ member, lastActivity: last || null });
  }
  return inactive;
}

async function runReengageJob(client, guildId) {
  const settings = await getGuildSettings(guildId);
  if (!settings.reengageEnabled) return { sent: 0, skipped: 0, reason: 'disabled' };
  const days = settings.reengageDays || 30;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { sent: 0, skipped: 0, reason: 'guild not found' };
  const inactive = await findInactiveMembers(guild, days);
  let sent = 0;
  let skipped = 0;
  for (const { member } of inactive) {
    const sentAt = new Date();
    if (settings.reengageChannelId) {
      const channel = guild.channels.cache.get(settings.reengageChannelId)
        || await guild.channels.fetch(settings.reengageChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [infoEmbed(`We miss you, ${member.displayName}!`, `Hey <@${member.id}> — it's been a while since we've seen you in **${guild.name}**! Here's what's new… hop back in and say hi. 👋`)] }).catch(() => {});
        sent += 1;
      } else { skipped += 1; }
    } else {
      const ok = await member.send({ embeds: [infoEmbed(`We miss you in ${guild.name}!`, `Hey ${member.displayName} — it's been a while since we've seen you around! Here's what's new in **${guild.name}**… come say hi when you get a chance. 👋`)] }).then(() => true).catch(() => false);
      if (ok) sent += 1; else skipped += 1;
    }
    await db.query(
      'INSERT INTO reengage_logs (guild_id, user_id, messaged_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE messaged_at = VALUES(messaged_at)',
      [guildId, member.id, sentAt],
    ).catch(() => {});
  }
  return { sent, skipped, total: inactive.length };
}

async function isOptedOut(guildId, userId) {
  const rows = await db.query('SELECT 1 FROM reengage_optouts WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  return (rows?.length || 0) > 0;
}

let reengageStarted = false;
// Daily job: check every hour; run once per guild per day (at 10:00
// server-local time, first run shortly after startup if the hour matches
// — otherwise the next day's 10:00 run). Per-guild last-run is tracked in
// memory; a restart re-runs at most one extra day's job.
const reengageLastRun = new Map();
async function checkReengage(client) {
  const now = new Date();
  if (now.getHours() !== 10) return;
  const today = now.toDateString();
  for (const guild of client.guilds.cache.values()) {
    if (reengageLastRun.get(guild.id) === today) continue;
    reengageLastRun.set(guild.id, today);
    try {
      const result = await runReengageJob(client, guild.id);
      if (result.sent || result.skipped) {
        errorLogger.log({ level: 'info', guildId: guild.id, commandName: 'reengage', message: `Re-engagement job: ${result.sent} sent, ${result.skipped} skipped (DMs closed) of ${result.total || 0} inactive members.` });
      }
    } catch (err) {
      errorLogger.log({ level: 'error', guildId: guild.id, commandName: 'reengage', message: `Re-engagement job failed: ${err.message}` });
    }
  }
}

function startReengageChecker(client) {
  if (reengageStarted) return;
  reengageStarted = true;
  // Check once an hour; the hour gate in checkReengage picks 10:00.
  setInterval(() => checkReengage(client).catch(() => {}), 60 * 60 * 1000);
}

async function setOptOut(guildId, userId, optOut) {
  if (optOut) {
    await db.query('INSERT INTO reengage_optouts (guild_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE opted_out_at = CURRENT_TIMESTAMP', [guildId, userId]);
  } else {
    await db.query('DELETE FROM reengage_optouts WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  }
}

module.exports = { findInactiveMembers, runReengageJob, isOptedOut, setOptOut, startReengageChecker };

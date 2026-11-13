// Bot detection / tracking. Scores every new member on join and logs
// suspicious ones to MySQL (bot_flags) + daily join stats (bot_join_stats).
//
// HONEST LIMITS — what the bot can and cannot see:
//   * Discord does NOT expose whether an account's email/phone is verified,
//     so verification status is never checked directly. Account age, avatar
//     and join bursts are used as proxies, and the README says so.
//   * Scores are heuristics, not proof: a real new user can trip signals
//     (fresh account + default avatar), which is why the default auto-action
//     is flag-only, never ban, and every flag is reviewable.
//   * Join-burst / clustering signals are in-memory (per process, last 10
//     minutes) — a restart clears the window, and sharded bots only see
//     joins on their own shards.
//
// Signals (points add up, capped at 100):
//   account age < 24h ............ +40        | < 7 days ........... +30
//   default avatar (no custom avatar) ....... +15
//   username matches bot patterns ........... +25
//   raid window (5+ joins in 60s) ........... +25
//   mass-join clustering (3+ accounts created within 10 min of each other
//   among recent joins) ...................... +20
// Thresholds: score >= threshold (config botTracking.threshold, default
// 70, per-guild override in guild_settings.bot_threshold) = auto-action;
// 40-69 = watchlist (logged, no action); < 40 = clean, no log.
const db = require('./database');
const config = require('./config');
const { getGuildSettings } = require('./guildSettings');
const { getPremiumSettings } = require('./premiumSettings');
const { warnEmbed } = require('./embeds');

const SPAM_WORDS = ['nitro', 'steam', 'free', 'gift', 'crypto', 'bitcoin', 'discord.gg', 'nitro'];
const RANDOM_NAME = /^[a-z]{2,}[0-9]{4,}$/i; // e.g. xkjfd83920, ab123456
const RANDOM_NAME2 = /^[a-z0-9]{10,}$/i; // long random-looking lowercase+digits

// In-memory join history per guild (last 10 min): { userId, createdAt, joinedAt }.
const recentJoins = new Map(); // guildId -> array
const JOIN_HISTORY_MS = 10 * 60_000;

function trackJoinMemory(guildId, userId, createdAt) {
  const now = Date.now();
  const list = (recentJoins.get(guildId) || []).filter((j) => now - j.joinedAt < JOIN_HISTORY_MS);
  list.push({ userId, createdAt: createdAt.getTime(), joinedAt: now });
  recentJoins.set(guildId, list);
  return list;
}

function botTrackingConfig() {
  const bt = config.botTracking || {};
  return {
    threshold: bt.threshold ?? 70,
    raidWindowSeconds: bt.raidWindowSeconds ?? 60,
    raidJoinCount: bt.raidJoinCount ?? 5,
  };
}

function scoreMember(member, joins) {
  const signals = [];
  const user = member.user;
  const ageMs = Date.now() - user.createdTimestamp;
  const ageDays = ageMs / 86_400_000;

  if (ageMs < 24 * 3_600_000) signals.push({ name: 'Account age under 24 hours', points: 40, detail: `created ${Math.max(0, Math.floor(ageMs / 3_600_000))}h ago` });
  else if (ageDays < 7) signals.push({ name: 'Account age under 7 days', points: 30, detail: `created ${ageDays.toFixed(1)} days ago` });

  if (!user.avatar) signals.push({ name: 'Default avatar', points: 15, detail: 'no custom avatar set' });

  const name = user.username.toLowerCase();
  if (SPAM_WORDS.some((w) => name.includes(w))) {
    signals.push({ name: 'Username contains spam words', points: 25, detail: `"${user.username}" matches a known spam pattern (nitro/steam/free/gift/crypto)` });
  } else if (RANDOM_NAME.test(user.username) || RANDOM_NAME2.test(user.username)) {
    signals.push({ name: 'Username looks randomly generated', points: 25, detail: `"${user.username}" looks like random letters/numbers` });
  }

  // Raid window: many joins in a short time.
  const bt = botTrackingConfig();
  const windowStart = Date.now() - bt.raidWindowSeconds * 1000;
  const joinsInWindow = joins.filter((j) => j.joinedAt >= windowStart).length;
  if (joinsInWindow >= bt.raidJoinCount) {
    signals.push({ name: 'Join burst (raid window)', points: 25, detail: `${joinsInWindow} joins in the last ${bt.raidWindowSeconds}s` });
  }

  // Mass-join clustering: several recent joins with accounts created
  // within 10 minutes of each other.
  const cluster = joins.filter((j) => Math.abs(j.createdAt - user.createdTimestamp) <= 10 * 60_000).length;
  if (cluster >= 3) {
    signals.push({ name: 'Mass-join clustering', points: 20, detail: `${cluster} recent joins have accounts created within 10 minutes of each other` });
  }

  const score = Math.min(100, signals.reduce((s, x) => s + x.points, 0));
  return { score, signals };
}

async function postToModlog(guild, text) {
  try {
    const premium = await getPremiumSettings(guild.id);
    if (!premium.modlogChannelId) return;
    const channel = await guild.channels.fetch(premium.modlogChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await channel.send({ embeds: [warnEmbed('🤖 Bot tracking', text)] });
  } catch {}
}

async function handleJoin(member) {
  if (!member?.guild || member.user.bot) return null;
  const guild = member.guild;
  const joins = trackJoinMemory(guild.id, member.user.id, new Date(member.user.createdTimestamp));
  const { score, signals } = scoreMember(member, joins);
  const settings = await getGuildSettings(guild.id);
  const bt = botTrackingConfig();
  const threshold = settings.botThreshold ?? bt.threshold;

  // Daily join stats (always recorded).
  if (db.isEnabled()) {
    const today = new Date().toISOString().slice(0, 10);
    const isBot = score >= threshold ? 1 : 0;
    const isFlagged = score >= 40 ? 1 : 0;
    await db.query(
      `INSERT INTO bot_join_stats (guild_id, date, total_joins, bot_joins, flagged_joins) VALUES (?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE total_joins = total_joins + 1, bot_joins = bot_joins + VALUES(bot_joins), flagged_joins = flagged_joins + VALUES(flagged_joins)`,
      [guild.id, today, isBot, isFlagged],
    );
  }

  if (score < 40) return { score, signals, level: 'clean' };

  const level = score >= threshold ? 'bot' : 'watchlist';
  const action = level === 'bot' ? (settings.botAutoAction || 'flag') : 'watchlist';
  let actionTaken = action;
  let actionNote = '';

  if (level === 'bot' && db.isEnabled()) {
    if (action === 'kick') {
      try { await member.kick('Bot tracking: suspicion score ' + score); actionNote = 'Kicked.'; }
      catch { actionTaken = 'flag'; actionNote = 'Kick failed (permissions?) — flagged instead.'; }
    } else if (action === 'ban') {
      try { await member.ban({ reason: 'Bot tracking: suspicion score ' + score }); actionNote = 'Banned.'; }
      catch { actionTaken = 'flag'; actionNote = 'Ban failed (permissions?) — flagged instead.'; }
    }
    if (actionTaken === 'flag' && settings.botSuspectRoleId) {
      try {
        await member.roles.add(settings.botSuspectRoleId, 'Bot tracking: suspected bot');
        actionNote += (actionNote ? ' ' : '') + 'Given the Suspected Bot role.';
      } catch { actionNote += (actionNote ? ' ' : '') + 'Could not assign the suspect role (permissions?).'; }
    }
  }

  if (db.isEnabled()) {
    const reason = signals.map((s) => `${s.name} (+${s.points})`).join('; ');
    await db.query(
      'INSERT INTO bot_flags (guild_id, user_id, reason, score, details, action_taken, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [guild.id, member.user.id, reason.slice(0, 512), score, JSON.stringify(signals), actionTaken, 'open'],
    );
  }

  const signalLines = signals.map((s) => `• ${s.name} (+${s.points}) — ${s.detail}`).join('\n');
  await postToModlog(guild,
    `<@${member.user.id}> (${member.user.tag}) joined with suspicion score **${score}/100** (${level === 'bot' ? 'at/above' : 'below'} threshold ${threshold}).\n${signalLines}\nAction: **${actionTaken}**.${actionNote ? ` ${actionNote}` : ''}\nReview with \`/botflag ${member.user.id}\`.`);

  return { score, signals, level, actionTaken };
}

async function getRecentFlags(guildId, limit = 20, status = null) {
  if (!db.isEnabled()) return [];
  const where = status ? 'AND status = ?' : '';
  const params = status ? [guildId, status, limit] : [guildId, limit];
  return (await db.query(
    `SELECT * FROM bot_flags WHERE guild_id = ? ${where} ORDER BY flagged_at DESC LIMIT ?`, params,
  )) || [];
}

async function getFlag(guildId, userId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query(
    'SELECT * FROM bot_flags WHERE guild_id = ? AND user_id = ? ORDER BY flagged_at DESC LIMIT 1',
    [guildId, userId],
  );
  return rows?.[0] || null;
}

async function clearFlag(guildId, userId, reviewerId) {
  if (!db.isEnabled()) return false;
  const res = await db.query(
    "UPDATE bot_flags SET status = 'cleared', reviewed_by = ? WHERE guild_id = ? AND user_id = ? AND status = 'open'",
    [reviewerId, guildId, userId],
  );
  return (res?.affectedRows || 0) > 0;
}

async function getJoinStats(guildId, days = 7) {
  if (!db.isEnabled()) return [];
  return (await db.query(
    'SELECT date, total_joins, bot_joins, flagged_joins FROM bot_join_stats WHERE guild_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY date DESC',
    [guildId, days],
  )) || [];
}

function raidWatchStatus(guildId) {
  const bt = botTrackingConfig();
  const now = Date.now();
  const list = (recentJoins.get(guildId) || []).filter((j) => now - j.joinedAt < bt.raidWindowSeconds * 1000);
  return { joinsLastWindow: list.length, windowSeconds: bt.raidWindowSeconds, raidThreshold: bt.raidJoinCount, inRaidWindow: list.length >= bt.raidJoinCount };
}

module.exports = {
  scoreMember, handleJoin, getRecentFlags, getFlag, clearFlag,
  getJoinStats, raidWatchStatus, botTrackingConfig,
};

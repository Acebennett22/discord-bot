// Leveling / XP: 15-25 XP per message (configurable), 60s cooldown per user.
// Level curve: XP needed for level N = 100 * N^1.5 (cumulative thresholds).
//   level 1 needs 100 XP, level 2 needs ~283 total, level 5 needs ~1,118, etc.
const db = require('./database');
const config = require('./config');
const { getGuildSettings } = require('./guildSettings');
const { successEmbed } = require('./embeds');

function xpForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}

function levelForXp(xp) {
  let level = 0;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

function xpIntoLevel(xp) {
  const level = levelForXp(xp);
  const base = level === 0 ? 0 : xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, base, next, into: xp - base, needed: next - base };
}

function progressBar(into, needed, length = 10) {
  const filled = Math.min(length, Math.round((into / Math.max(1, needed)) * length));
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

async function awardXp(message) {
  if (!db.isEnabled() || !message.guild || message.author.bot) return null;
  const cfg = config.leveling || {};
  const cooldown = (cfg.cooldownSeconds || 60) * 1000;
  const now = Date.now();
  const rows = await db.query('SELECT xp, level, last_xp_at FROM user_levels WHERE user_id = ? AND guild_id = ?', [message.author.id, message.guildId]);
  const prev = rows?.[0];
  if (prev?.last_xp_at && now - new Date(prev.last_xp_at).getTime() < cooldown) return null;
  const min = cfg.xpPerMessageMin ?? 15;
  const max = cfg.xpPerMessageMax ?? 25;
  const gained = min + Math.floor(Math.random() * (max - min + 1));
  const oldXp = prev?.xp || 0;
  const newXp = oldXp + gained;
  const oldLevel = levelForXp(oldXp);
  const newLevel = levelForXp(newXp);
  await db.query(
    'INSERT INTO user_levels (user_id, guild_id, xp, level, last_xp_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE xp = VALUES(xp), level = VALUES(level), last_xp_at = CURRENT_TIMESTAMP',
    [message.author.id, message.guildId, newXp, newLevel],
  );
  if (newLevel <= oldLevel) return null;
  // Level-up: announce + grant role rewards.
  const settings = await getGuildSettings(message.guildId);
  const rewards = settings.levelRoles || {};
  const granted = [];
  for (const [lvl, roleId] of Object.entries(rewards)) {
    if (newLevel >= parseInt(lvl, 10)) {
      const role = message.guild.roles.cache.get(roleId);
      if (role && !message.member.roles.cache.has(roleId)) {
        await message.member.roles.add(role).catch(() => {});
        granted.push(role.name);
      }
    }
  }
  if (settings.levelUpMessages !== false && (config.leveling?.levelUpMessages !== false)) {
    await message.channel.send({ embeds: [successEmbed('Level up!', `🎉 ${message.author} leveled up to **level ${newLevel}**!${granted.length ? ` Unlocked role(s): ${granted.join(', ')}` : ''}`)] }).catch(() => {});
  }
  return { oldLevel, newLevel, gained, granted };
}

async function getRank(userId, guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT xp, level FROM user_levels WHERE user_id = ? AND guild_id = ?', [userId, guildId]);
  const xp = rows?.[0]?.xp || 0;
  const rankRows = await db.query('SELECT COUNT(*) AS better FROM user_levels WHERE guild_id = ? AND xp > ?', [guildId, xp]);
  return { xp, level: levelForXp(xp), rank: (rankRows?.[0]?.better || 0) + 1 };
}

async function getLeaderboard(guildId, limit = 10) {
  if (!db.isEnabled()) return null;
  return db.query('SELECT user_id, xp, level FROM user_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?', [guildId, limit]);
}

module.exports = { xpForLevel, levelForXp, xpIntoLevel, progressBar, awardXp, getRank, getLeaderboard };

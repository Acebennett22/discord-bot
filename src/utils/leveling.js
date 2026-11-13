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

// Prestige (1.11.4): at the max level (config leveling.maxLevel, default
// 100) a member can reset to level 1 and gain +1 prestige. Each prestige
// grants a permanent +10% XP multiplier, capped at +100% (prestige 10).
function getMaxLevel() {
  return config.leveling?.maxLevel ?? 100;
}

function prestigeMultiplier(prestige) {
  return 1 + Math.min(prestige || 0, 10) * 0.1;
}

async function getUserPrestige(userId, guildId) {
  if (!db.isEnabled()) return 0;
  try {
    const rows = await db.query('SELECT prestige FROM user_levels WHERE user_id = ? AND guild_id = ?', [userId, guildId]);
    return rows?.[0]?.prestige || 0;
  } catch { return 0; } // Column not yet migrated — treat as no prestige.
}

async function doPrestige(userId, guildId) {
  if (!db.isEnabled()) return { ok: false, reason: 'db' };
  const maxLevel = getMaxLevel();
  let row = null;
  try {
    const rows = await db.query('SELECT xp, level, prestige FROM user_levels WHERE user_id = ? AND guild_id = ?', [userId, guildId]);
    row = rows?.[0] || null;
  } catch { return { ok: false, reason: 'db' }; }
  const level = row ? levelForXp(row.xp) : 0;
  if (level < maxLevel) return { ok: false, reason: 'level', level, maxLevel };
  const prestige = (row?.prestige || 0) + 1;
  await db.query(
    'INSERT INTO user_levels (user_id, guild_id, xp, level, prestige) VALUES (?, ?, 0, 0, ?) ON DUPLICATE KEY UPDATE xp = 0, level = 0, prestige = VALUES(prestige)',
    [userId, guildId, prestige],
  );
  return { ok: true, prestige };
}

async function getPrestigeLeaderboard(guildId, limit = 10) {
  if (!db.isEnabled()) return [];
  try {
    return (await db.query('SELECT user_id, prestige, xp, level FROM user_levels WHERE guild_id = ? AND prestige > 0 ORDER BY prestige DESC, xp DESC LIMIT ?', [guildId, limit])) || [];
  } catch { return []; }
}

async function getActiveBoost(guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query(
    "SELECT * FROM xp_boosts WHERE guild_id = ? AND active = 1 AND starts_at <= NOW() AND ends_at > NOW() ORDER BY multiplier DESC LIMIT 1",
    [guildId],
  );
  return rows?.[0] || null;
}

async function startBoost(guildId, multiplier, durationMs, createdBy) {
  if (!db.isEnabled()) return null;
  await db.query('UPDATE xp_boosts SET active = 0 WHERE guild_id = ? AND active = 1', [guildId]);
  const endsAt = new Date(Date.now() + durationMs);
  const res = await db.query(
    'INSERT INTO xp_boosts (guild_id, multiplier, ends_at, created_by, active) VALUES (?, ?, ?, ?, 1)',
    [guildId, multiplier, endsAt, createdBy || null],
  );
  return { id: res.insertId, multiplier, endsAt };
}

async function stopBoost(guildId) {
  if (!db.isEnabled()) return false;
  const res = await db.query('UPDATE xp_boosts SET active = 0 WHERE guild_id = ? AND active = 1', [guildId]);
  return (res?.affectedRows || 0) > 0;
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
  let gained = min + Math.floor(Math.random() * (max - min + 1));
  // Prestige (1.11.4): permanent +10% XP per prestige, capped at +100%.
  gained = Math.round(gained * prestigeMultiplier(await getUserPrestige(message.author.id, message.guildId)));
  // XP boost (1.3.3): an active boost multiplies the XP gained.
  const boost = await getActiveBoost(message.guildId).catch(() => null);
  if (boost) gained = Math.round(gained * parseFloat(boost.multiplier));
  const oldXp = prev?.xp || 0;
  const newXpRaw = oldXp + gained;
  // Cap at the max level — XP past it is held until the member prestiges.
  const maxLevel = getMaxLevel();
  const newXp = Math.min(newXpRaw, xpForLevel(maxLevel));
  const oldLevel = levelForXp(oldXp);
  const newLevel = levelForXp(newXp);
  await db.query(
    'INSERT INTO user_levels (user_id, guild_id, xp, level, last_xp_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE xp = VALUES(xp), level = VALUES(level), last_xp_at = CURRENT_TIMESTAMP',
    [message.author.id, message.guildId, newXp, newLevel],
  );
  if (newLevel <= oldLevel) return null;
  const granted = await handleLevelUp(message.guild, message.member, oldLevel, newLevel, message.channel);
  return { oldLevel, newLevel, gained, granted };
}

// Shared level-up flow (text XP + voice XP): grant role rewards, send due
// "Remind me" DMs, and announce. With no announce channel (voice XP) the
// announcement goes to the member's DMs instead.
async function handleLevelUp(guild, member, oldLevel, newLevel, announceChannel) {
  const settings = await getGuildSettings(guild.id);
  const rewards = settings.levelRoles || {};
  const granted = [];
  for (const [lvl, roleId] of Object.entries(rewards)) {
    if (newLevel >= parseInt(lvl, 10)) {
      const role = guild.roles.cache.get(roleId);
      if (role && !member.roles.cache.has(roleId)) {
        await member.roles.add(role).catch(() => {});
        granted.push(role.name);
      }
    }
  }
  const dueReminders = await db.query(
    'SELECT id, target_level, role_id FROM level_reminders WHERE guild_id = ? AND user_id = ? AND reminded_at IS NULL AND target_level <= ?',
    [guild.id, member.id, newLevel],
  ).catch(() => []) || [];
  for (const rem of dueReminders) {
    const role = guild.roles.cache.get(rem.role_id);
    await member.send({
      embeds: [successEmbed('Level reward unlocked!', `🎉 You hit **level ${rem.target_level}** in **${guild.name}** — you earned the **${role ? role.name : 'reward'}** role!`)],
    }).catch(() => {});
    await db.query('UPDATE level_reminders SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?', [rem.id]).catch(() => {});
  }
  if (settings.levelUpMessages !== false && (config.leveling?.levelUpMessages !== false)) {
    const nextReward = Object.entries(rewards)
      .map(([lvl, roleId]) => ({ level: parseInt(lvl, 10), roleId }))
      .filter((r) => r.level > newLevel && r.level <= newLevel + 1 && !member.roles.cache.has(r.roleId))
      .sort((a, b) => a.level - b.level)[0];
    const components = [];
    if (nextReward) {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`levelremind:${nextReward.level}:${nextReward.roleId}`).setLabel(`🔔 Remind me at level ${nextReward.level}`).setStyle(ButtonStyle.Primary),
      ));
    }
    const embed = successEmbed('Level up!', `🎉 ${member} leveled up to **level ${newLevel}**!${granted.length ? ` Unlocked role(s): ${granted.join(', ')}` : ''}${nextReward ? `\nYour next reward is **1 level away** — hit Remind me and I'll DM you when you get there.` : ''}`);
    if (announceChannel) {
      await announceChannel.send({ embeds: [embed], components }).catch(() => {});
    } else {
      await member.send({ embeds: [embed], components }).catch(() => {});
    }
  }
  return granted;
}

// Voice XP (1.4.3): award XP for minutes spent in voice. Same user_levels
// table and level-up flow as text XP.
async function awardVoiceXp(guild, member, minutes) {
  if (!db.isEnabled() || !guild || !member || member.user.bot || minutes <= 0) return null;
  const settings = await getGuildSettings(guild.id).catch(() => null);
  const perMinute = settings?.voiceXpPerMinute ?? config.leveling?.voiceXpPerMinute ?? 2;
  const gained = Math.round(minutes * perMinute * prestigeMultiplier(await getUserPrestige(member.id, guild.id)));
  if (gained <= 0) return null;
  const boost = await getActiveBoost(guild.id).catch(() => null);
  const finalGained = boost ? Math.round(gained * parseFloat(boost.multiplier)) : gained;
  const rows = await db.query('SELECT xp, level FROM user_levels WHERE user_id = ? AND guild_id = ?', [member.id, guild.id]);
  const oldXp = rows?.[0]?.xp || 0;
  const newXp = Math.min(oldXp + finalGained, xpForLevel(getMaxLevel()));
  const oldLevel = levelForXp(oldXp);
  const newLevel = levelForXp(newXp);
  await db.query(
    'INSERT INTO user_levels (user_id, guild_id, xp, level) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE xp = VALUES(xp), level = VALUES(level)',
    [member.id, guild.id, newXp, newLevel],
  );
  if (newLevel <= oldLevel) return { gained: finalGained, leveledUp: false };
  const granted = await handleLevelUp(guild, member, oldLevel, newLevel, null);
  return { gained: finalGained, leveledUp: true, newLevel, granted };
}

async function getRank(userId, guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT xp, level FROM user_levels WHERE user_id = ? AND guild_id = ?', [userId, guildId]);
  const xp = rows?.[0]?.xp || 0;
  const prestige = await getUserPrestige(userId, guildId);
  const rankRows = await db.query('SELECT COUNT(*) AS better FROM user_levels WHERE guild_id = ? AND xp > ?', [guildId, xp]);
  return { xp, level: levelForXp(xp), rank: (rankRows?.[0]?.better || 0) + 1, prestige };
}

async function getLeaderboard(guildId, limit = 10) {
  if (!db.isEnabled()) return null;
  return db.query('SELECT user_id, xp, level FROM user_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?', [guildId, limit]);
}

module.exports = { xpForLevel, levelForXp, xpIntoLevel, progressBar, awardXp, awardVoiceXp, handleLevelUp, getRank, getLeaderboard, getActiveBoost, startBoost, stopBoost, getMaxLevel, prestigeMultiplier, getUserPrestige, doPrestige, getPrestigeLeaderboard };

// Daily streaks (1.6.3): /daily on consecutive days increments the streak;
// missing a day resets it to 1. Reward = base coins + 25 per streak day
// (bonus capped at +500), and milestone crates at streaks 7/30/100
// (configurable per server via guild_settings streak_bonus_per_day and
// streak_milestone_bonuses). Pure math is exported for stub tests.
const db = require('./database');

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

// Streak after claiming today, given the last claim date (or null).
function nextStreak(lastDailyDate, today = new Date()) {
  if (!lastDailyDate) return 1;
  const last = new Date(lastDailyDate);
  const todayStr = dateStr(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr(last) === todayStr) return null; // already claimed today
  if (dateStr(last) === dateStr(yesterday)) return 'continue';
  return 1; // missed a day — reset
}

function streakBonus(streak, perDay = 25, cap = 500) {
  return Math.min(streak * perDay, cap);
}

function milestoneFor(streak, milestones) {
  return milestones?.[String(streak)] || null;
}

async function getStreak(guildId, userId) {
  if (!db.isEnabled()) return { daily_streak: 0, best_streak: 0, last_daily_date: null };
  const rows = await db.query('SELECT daily_streak, best_streak, last_daily_date FROM economy_users WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  return rows?.[0] || { daily_streak: 0, best_streak: 0, last_daily_date: null };
}

async function recordDailyClaim(guildId, userId, today = new Date()) {
  const prev = await getStreak(guildId, userId);
  const decision = nextStreak(prev.last_daily_date, today);
  const streak = decision === 'continue' ? (prev.daily_streak || 0) + 1 : 1;
  const best = Math.max(prev.best_streak || 0, streak);
  await db.query(
    'UPDATE economy_users SET daily_streak = ?, best_streak = ?, last_daily_date = ? WHERE guild_id = ? AND user_id = ?',
    [streak, best, dateStr(today), guildId, userId],
  );
  return { streak, best, continued: decision === 'continue' };
}

async function getStreakLeaderboard(guildId, limit = 10) {
  if (!db.isEnabled()) return [];
  return await db.query('SELECT user_id, daily_streak, best_streak FROM economy_users WHERE guild_id = ? AND daily_streak > 0 ORDER BY daily_streak DESC LIMIT ?', [guildId, limit]) || [];
}

module.exports = { nextStreak, streakBonus, milestoneFor, getStreak, recordDailyClaim, getStreakLeaderboard, dateStr };

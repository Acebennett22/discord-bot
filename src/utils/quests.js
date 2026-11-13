// Daily quests (1.13.9): hardcoded quest definitions + completion checks.
// Every quest type here is genuinely checkable at claim time from tables
// the bot already writes — no quest relies on data the bot never records.
// Dropped types: "send N messages today" (user_levels.messages is a
// lifetime counter, no per-day message table exists) and "earn N XP today"
// (no per-day XP log exists).
const db = require('./database');
const { addCoins } = require('./economy');
const { xpForLevel, levelForXp, getMaxLevel, prestigeMultiplier, getUserPrestige, getActiveBoost, handleLevelUp } = require('./leveling');

// Quest date = the MySQL server's calendar date (CURDATE()), so the
// claimed-date and the completion checks (which also use CURDATE()) can
// never disagree across a midnight boundary / timezone.
async function todayDate() {
  if (!db.isEnabled()) return new Date().toISOString().slice(0, 10);
  const rows = await db.query('SELECT CURDATE() AS d').catch(() => null);
  const d = rows?.[0]?.d;
  if (!d) return new Date().toISOString().slice(0, 10);
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

const QUESTS = [
  {
    id: 'daily-claim',
    name: 'Daily Grind',
    description: 'Claim your /daily reward today.',
    coins: 100,
    xp: 25,
    check: async (guildId, userId) => {
      const rows = await db.query('SELECT 1 AS done FROM economy_users WHERE guild_id = ? AND user_id = ? AND DATE(last_daily) = CURDATE()', [guildId, userId]);
      return !!rows?.length;
    },
  },
  {
    id: 'work-shift',
    name: 'Clock In',
    description: 'Work a shift with /work today.',
    coins: 80,
    xp: 25,
    check: async (guildId, userId) => {
      const rows = await db.query('SELECT 1 AS done FROM economy_users WHERE guild_id = ? AND user_id = ? AND DATE(last_work) = CURDATE()', [guildId, userId]);
      return !!rows?.length;
    },
  },
  {
    id: 'chatter',
    name: 'Chatty',
    description: 'Use 5 slash commands in this server today.',
    coins: 50,
    xp: 20,
    check: async (guildId, userId) => {
      // command_logs is written AFTER each command executes (see
      // interactionCreate.js), so the /quest claim itself is never counted.
      const rows = await db.query('SELECT COUNT(*) AS n FROM command_logs WHERE guild_id = ? AND user_id = ? AND DATE(created_at) = CURDATE()', [guildId, userId]);
      return (rows?.[0]?.n || 0) >= 5;
    },
  },
  {
    id: 'voice-time',
    name: 'Voice Regular',
    description: 'Spend 10 minutes in a voice channel today.',
    coins: 60,
    xp: 30,
    check: async (guildId, userId) => {
      // voice_sessions.minutes is filled in when the session ends; an
      // in-progress session only counts once the member leaves voice.
      const rows = await db.query('SELECT COALESCE(SUM(minutes), 0) AS mins FROM voice_sessions WHERE guild_id = ? AND user_id = ? AND DATE(joined_at) = CURDATE()', [guildId, userId]);
      return (rows?.[0]?.mins || 0) >= 10;
    },
  },
  {
    id: 'gambler',
    name: 'High Roller',
    description: 'Play a casino game (/slots, /blackjack, /roulette, /gamble-coinflip, /gamble-dice) today.',
    coins: 50,
    xp: 20,
    check: async (guildId, userId) => {
      // Every casino play deducts its stake up front as a casino_loss leg
      // (see utils/casino.js), so one such transaction today = played today.
      const rows = await db.query("SELECT 1 AS done FROM economy_transactions WHERE guild_id = ? AND user_id = ? AND type = 'casino_loss' AND DATE(created_at) = CURDATE() LIMIT 1", [guildId, userId]);
      return !!rows?.length;
    },
  },
];

async function getClaimedIds(guildId, userId, date) {
  if (!db.isEnabled()) return [];
  const rows = await db.query('SELECT quest_id FROM user_quests WHERE guild_id = ? AND user_id = ? AND quest_date = ?', [guildId, userId, date]) || [];
  return rows.map((r) => r.quest_id);
}

async function getQuestStates(guildId, userId) {
  const date = await todayDate();
  const claimed = await getClaimedIds(guildId, userId, date);
  const states = [];
  for (const quest of QUESTS) {
    const done = await quest.check(guildId, userId).catch(() => false);
    states.push({ ...quest, done, claimed: claimed.includes(quest.id) });
  }
  return { date, states };
}

// Award XP directly (leveling.js has no generic add-XP helper — awardXp
// only works from a message, awardVoiceXp only from voice minutes). Mirrors
// awardVoiceXp: prestige multiplier + active boost, capped at the max
// level, same level-up flow (announcement goes to DMs, no channel here).
async function awardQuestXp(guild, member, amount) {
  if (!db.isEnabled() || !guild || !member || member.user.bot || amount <= 0) return null;
  let gained = Math.round(amount * prestigeMultiplier(await getUserPrestige(member.id, guild.id)));
  const boost = await getActiveBoost(guild.id).catch(() => null);
  if (boost) gained = Math.round(gained * parseFloat(boost.multiplier));
  if (gained <= 0) return null;
  const rows = await db.query('SELECT xp, level FROM user_levels WHERE user_id = ? AND guild_id = ?', [member.id, guild.id]);
  const oldXp = rows?.[0]?.xp || 0;
  const newXp = Math.min(oldXp + gained, xpForLevel(getMaxLevel()));
  const oldLevel = levelForXp(oldXp);
  const newLevel = levelForXp(newXp);
  await db.query(
    'INSERT INTO user_levels (user_id, guild_id, xp, level) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE xp = VALUES(xp), level = VALUES(level)',
    [member.id, guild.id, newXp, newLevel],
  );
  if (newLevel <= oldLevel) return { gained, leveledUp: false };
  const granted = await handleLevelUp(guild, member, oldLevel, newLevel, null);
  return { gained, leveledUp: true, newLevel, granted };
}

// Claim one quest. Returns { ok, error?, quest?, coins?, xp?, leveledUp? }.
async function claimQuest(guild, member, questId) {
  const quest = QUESTS.find((q) => q.id === questId);
  if (!quest) return { ok: false, error: `No quest with ID \`${questId}\`. Use /quest list to see today's quests.` };
  const date = await todayDate();
  const claimed = await getClaimedIds(guild.id, member.id, date);
  if (claimed.includes(questId)) return { ok: false, error: `You already claimed **${quest.name}** today.` };
  const done = await quest.check(guild.id, member.id).catch(() => false);
  if (!done) return { ok: false, error: `**${quest.name}** isn't complete yet — ${quest.description}` };
  await db.query(
    'INSERT INTO user_quests (guild_id, user_id, quest_id, quest_date) VALUES (?, ?, ?, ?)',
    [guild.id, member.id, quest.id, date],
  );
  await addCoins(guild.id, member.id, quest.coins, 'quest', `Quest complete: ${quest.name}`);
  const xpRes = await awardQuestXp(guild, member, quest.xp);
  return { ok: true, quest, coins: quest.coins, xp: xpRes?.gained ?? quest.xp, leveledUp: !!xpRes?.leveledUp, newLevel: xpRes?.newLevel };
}

module.exports = { QUESTS, todayDate, getClaimedIds, getQuestStates, awardQuestXp, claimQuest };

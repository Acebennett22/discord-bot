// Member milestones — celebrate round member counts. Each milestone fires
// once per guild (milestones_hit table). The member who triggers it gets a
// 100-coin bonus in their economy wallet.
const db = require('./database');
const config = require('./config');
const { infoEmbed } = require('./embeds');
const { addCoins } = require('./economy');
const errorLogger = require('./errorLogger');

const MILESTONE_BONUS_COINS = 100;

function milestoneList() {
  const list = config.milestones || [100, 250, 500, 1000, 2000, 5000, 10000];
  return [...list].sort((a, b) => a - b);
}

async function getMilestoneSettings(guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM milestone_settings WHERE guild_id = ?', [guildId]);
  return rows?.[0] || null;
}

async function saveMilestoneSettings(guildId, patch) {
  if (!db.isEnabled()) return false;
  const cur = await getMilestoneSettings(guildId);
  const next = {
    channel_id: patch.channelId !== undefined ? (patch.channelId || null) : (cur?.channel_id || null),
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (cur?.enabled ?? 1),
  };
  await db.query(
    `INSERT INTO milestone_settings (guild_id, channel_id, enabled) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id), enabled = VALUES(enabled)`,
    [guildId, next.channel_id, next.enabled],
  );
  return true;
}

async function getHitMilestones(guildId) {
  if (!db.isEnabled()) return [];
  const rows = await db.query('SELECT milestone FROM milestones_hit WHERE guild_id = ?', [guildId]);
  return (rows || []).map((r) => r.milestone);
}

// Pure logic, stub-testable: which milestones (if any) were just crossed?
function crossedMilestones(previousCount, newCount, alreadyHit) {
  return milestoneList().filter((m) => previousCount < m && newCount >= m && !alreadyHit.includes(m));
}

async function nextMilestone(guildId, memberCount) {
  const hit = await getHitMilestones(guildId);
  const next = milestoneList().find((m) => m > memberCount && !hit.includes(m));
  return { next: next ?? null, hit };
}

// Called on member join (after the welcome message). previousCount is the
// count before this join; memberCount is the count after.
async function checkMilestones(member, previousCount, memberCount) {
  try {
    const settings = await getMilestoneSettings(member.guild.id);
    if (!settings?.channel_id || !settings.enabled) return;
    const hit = await getHitMilestones(member.guild.id);
    const crossed = crossedMilestones(previousCount, memberCount, hit);
    if (!crossed.length) return;
    const channel = member.guild.channels.cache.get(settings.channel_id)
      || await member.guild.channels.fetch(settings.channel_id).catch(() => null);
    for (const m of crossed) {
      await db.query('INSERT IGNORE INTO milestones_hit (guild_id, milestone, triggered_by) VALUES (?, ?, ?)',
        [member.guild.id, m, member.id]);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [infoEmbed('🎉 Member milestone!',
          `**${member.guild.name}** just hit **${m} members**!\n\n<@${member.id}> was member #${m} and earned a **${MILESTONE_BONUS_COINS} coin** bonus!`)] }).catch(() => {});
      }
      await addCoins(member.guild.id, member.id, MILESTONE_BONUS_COINS, 'milestone', `Triggered the ${m}-member milestone`).catch(() => {});
    }
  } catch (e) {
    errorLogger.log({ level: 'error', guildId: member.guild.id, commandName: 'milestones', message: `Milestone check failed: ${e.message}`, stack: e.stack });
  }
}

function progressBar(current, target, width = 10) {
  const filled = Math.min(width, Math.floor((current / target) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

module.exports = { MILESTONE_BONUS_COINS, milestoneList, getMilestoneSettings, saveMilestoneSettings, getHitMilestones, crossedMilestones, nextMilestone, checkMilestones, progressBar };

// Work job upgrades (1.12.3): per-server job catalog. Each server has its
// own jobs (name, payout range, unlock cost, level requirement, flavor
// text); /work pays from the member's chosen job, or the global
// economyWorkMin/Max range when they have no job. Defaults are seeded on
// first use per guild.
const db = require('./database');
const { getBalance, addCoins, randInt } = require('./economy');

const DEFAULT_JOBS = [
  { name: 'Dishwasher', minPayout: 30, maxPayout: 80, cost: 0, requiredLevel: 0, flavorText: 'washed a mountain of dishes' },
  { name: 'Barista', minPayout: 50, maxPayout: 120, cost: 200, requiredLevel: 2, flavorText: 'pulled the perfect espresso shot' },
  { name: 'Mechanic', minPayout: 80, maxPayout: 200, cost: 500, requiredLevel: 5, flavorText: 'rebuilt a transmission' },
  { name: 'Developer', minPayout: 150, maxPayout: 400, cost: 1500, requiredLevel: 10, flavorText: 'shipped a feature with zero bugs (somehow)' },
];

async function seedJobs(guildId) {
  if (!db.isEnabled()) return;
  const rows = await db.query('SELECT COUNT(*) AS n FROM work_jobs WHERE guild_id = ?', [guildId]);
  if (rows?.[0]?.n > 0) return;
  for (const j of DEFAULT_JOBS) {
    await db.query(
      'INSERT IGNORE INTO work_jobs (guild_id, name, min_payout, max_payout, cost, required_level, flavor_text) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [guildId, j.name, j.minPayout, j.maxPayout, j.cost, j.requiredLevel, j.flavorText],
    );
  }
}

async function listJobs(guildId) {
  if (!db.isEnabled()) return [];
  await seedJobs(guildId);
  return (await db.query('SELECT * FROM work_jobs WHERE guild_id = ? ORDER BY required_level ASC, cost ASC', [guildId])) || [];
}

async function getJob(guildId, jobId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM work_jobs WHERE guild_id = ? AND id = ?', [guildId, jobId]);
  return rows?.[0] || null;
}

async function getJobByName(guildId, name) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM work_jobs WHERE guild_id = ? AND LOWER(name) = LOWER(?)', [guildId, name]);
  return rows?.[0] || null;
}

async function getUserJob(guildId, userId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query(
    'SELECT j.* FROM user_jobs uj JOIN work_jobs j ON j.id = uj.job_id WHERE uj.guild_id = ? AND uj.user_id = ?',
    [guildId, userId],
  );
  return rows?.[0] || null;
}

async function setUserJob(guildId, userId, jobId) {
  await db.query(
    'INSERT INTO user_jobs (guild_id, user_id, job_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE job_id = VALUES(job_id)',
    [guildId, userId, jobId],
  );
}

// Unlock a job: checks coins + level, deducts the cost, sets it as the
// member's job. Returns { ok, error? }.
async function buyJob(guildId, userId, job, level) {
  if (level < (job.required_level || 0)) {
    return { ok: false, error: `**${job.name}** needs leveling level ${job.required_level} (you're level ${level}).` };
  }
  const bal = await getBalance(guildId, userId);
  if (!bal) return { ok: false, error: 'Database unavailable — economy is offline right now.' };
  if ((job.cost || 0) > 0 && bal.balance < job.cost) {
    return { ok: false, error: `**${job.name}** costs ${job.cost} coins to unlock — you have ${bal.balance} in your wallet.` };
  }
  if ((job.cost || 0) > 0) {
    await addCoins(guildId, userId, -job.cost, 'job_buy', `Unlocked job: ${job.name}`);
  }
  await setUserJob(guildId, userId, job.id);
  return { ok: true };
}

function jobPayout(job) {
  return randInt(job.min_payout, job.max_payout);
}

module.exports = { DEFAULT_JOBS, seedJobs, listJobs, getJob, getJobByName, getUserJob, setUserJob, buyJob, jobPayout };

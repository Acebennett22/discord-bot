// Economy robbery (1.12.6): steal coins from another member's WALLET
// (never the bank). Flat 35% success chance. Success steals 10–30% of the
// victim's wallet (min 10, max 1000 coins). Failure: the robber pays a fine
// of up to 100 coins to the victim — the fine is capped at whatever the
// robber can actually afford (never below 0, never a debt). Cooldowns:
// 30 min after a successful rob, 1 hour after a failed one (tracked in
// rob_attempts). The pure helpers (rollRobbery / stealAmount / cooldowns)
// are exported for stub-testing without a live login.
const db = require('./database');
const { getBalance, addCoins } = require('./economy');

const SUCCESS_CHANCE = 0.35;
const SUCCESS_COOLDOWN_MS = 30 * 60_000;
const FAIL_COOLDOWN_MS = 60 * 60_000;
const FINE_COINS = 100;

function rollRobbery(rand = Math.random) {
  return rand() < SUCCESS_CHANCE;
}

// Steal is 10–30% of the victim's wallet, clamped to [10, 1000].
function stealAmount(wallet, rand = Math.random) {
  const pct = 0.10 + rand() * 0.20;
  return Math.max(10, Math.min(1000, Math.floor(wallet * pct)));
}

async function lastRobAttempt(guildId, userId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query(
    'SELECT * FROM rob_attempts WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
    [guildId, userId],
  );
  return rows?.[0] || null;
}

function robCooldownRemaining(lastAttempt) {
  if (!lastAttempt) return 0;
  const cooldown = lastAttempt.result === 'success' ? SUCCESS_COOLDOWN_MS : FAIL_COOLDOWN_MS;
  return Math.max(0, cooldown - (Date.now() - new Date(lastAttempt.created_at).getTime()));
}

async function logRobAttempt(guildId, userId, targetId, result, amount) {
  if (!db.isEnabled()) return;
  await db.query(
    'INSERT INTO rob_attempts (guild_id, user_id, target_id, result, amount) VALUES (?, ?, ?, ?, ?)',
    [guildId, userId, targetId, result, amount],
  );
}

async function recentRobs(guildId, limit = 20) {
  if (!db.isEnabled()) return [];
  return (await db.query(
    'SELECT * FROM rob_attempts WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?',
    [guildId, limit],
  )) || [];
}

// Runs one robbery. Returns { ok, error? } on validation failure, or
// { ok: true, success, amount, fine } on resolution.
async function attemptRob(guildId, robberId, victimId, rand = Math.random) {
  const robber = await getBalance(guildId, robberId);
  const victim = await getBalance(guildId, victimId);
  if (!robber || !victim) return { ok: false, error: 'Database unavailable — economy is offline right now.' };
  if (victim.balance < 50) return { ok: false, error: "That user has less than 50 coins in their wallet — nothing worth stealing." };
  const success = rollRobbery(rand);
  if (success) {
    const amount = stealAmount(victim.balance, rand);
    await addCoins(guildId, victimId, -amount, 'rob_loss', `Robbed by <@${robberId}>`);
    await addCoins(guildId, robberId, amount, 'rob_win', `Robbed <@${victimId}>`);
    await logRobAttempt(guildId, robberId, victimId, 'success', amount);
    return { ok: true, success: true, amount, fine: 0 };
  }
  const fine = Math.min(FINE_COINS, Math.max(0, robber.balance));
  if (fine > 0) {
    await addCoins(guildId, robberId, -fine, 'rob_fine', `Failed robbery fine, paid to <@${victimId}>`);
    await addCoins(guildId, victimId, fine, 'rob_fine', `Robbery fine from <@${robberId}>`);
  }
  await logRobAttempt(guildId, robberId, victimId, 'fail', fine);
  return { ok: true, success: false, amount: 0, fine };
}

module.exports = {
  SUCCESS_CHANCE, SUCCESS_COOLDOWN_MS, FAIL_COOLDOWN_MS, FINE_COINS,
  rollRobbery, stealAmount, lastRobAttempt, robCooldownRemaining,
  logRobAttempt, recentRobs, attemptRob,
};

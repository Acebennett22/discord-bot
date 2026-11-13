// Economy helpers: wallet + bank balances, cooldowns, transactions.
// All amounts are integers (coins). No-ops when the DB is unavailable —
// callers check the return value and tell the user the DB is down.
const db = require('./database');
const { getPremiumSettings } = require('./premiumSettings');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getOrCreateUser(guildId, userId) {
  const settings = await getPremiumSettings(guildId);
  const starting = settings.economyStartingBalance ?? 100;
  await db.query(
    'INSERT INTO economy_users (guild_id, user_id, balance, bank) VALUES (?, ?, ?, 0) ON DUPLICATE KEY UPDATE user_id = user_id',
    [guildId, userId, starting],
  );
  const rows = await db.query('SELECT balance, bank, last_daily, last_work FROM economy_users WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  return rows?.[0] || { balance: starting, bank: 0, last_daily: null, last_work: null };
}

async function getBalance(guildId, userId) {
  if (!db.isEnabled()) return null;
  return getOrCreateUser(guildId, userId);
}

async function addCoins(guildId, userId, amount, type, reason) {
  if (!db.isEnabled()) return null;
  await getOrCreateUser(guildId, userId);
  await db.query('UPDATE economy_users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?', [amount, guildId, userId]);
  await db.query('INSERT INTO economy_transactions (guild_id, user_id, amount, type, reason) VALUES (?, ?, ?, ?, ?)',
    [guildId, userId, amount, type, reason || null]);
  return getBalance(guildId, userId);
}

// Transfer coins between two users atomically-ish (single UPDATE each,
// guarded by a balance check first). Returns { ok, error? }.
async function transfer(guildId, fromId, toId, amount) {
  if (!db.isEnabled()) return { ok: false, error: 'Database unavailable — economy is offline right now.' };
  if (amount <= 0) return { ok: false, error: 'Amount must be more than 0.' };
  const from = await getOrCreateUser(guildId, fromId);
  if (from.balance < amount) return { ok: false, error: `You only have ${from.balance} coins in your wallet.` };
  await getOrCreateUser(guildId, toId);
  await db.query('UPDATE economy_users SET balance = balance - ? WHERE guild_id = ? AND user_id = ?', [amount, guildId, fromId]);
  await db.query('UPDATE economy_users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?', [amount, guildId, toId]);
  await db.query('INSERT INTO economy_transactions (guild_id, user_id, amount, type, reason) VALUES (?, ?, ?, ?, ?)',
    [guildId, fromId, -amount, 'pay', `Paid <@${toId}>`]);
  await db.query('INSERT INTO economy_transactions (guild_id, user_id, amount, type, reason) VALUES (?, ?, ?, ?, ?)',
    [guildId, toId, amount, 'pay', `Received from <@${fromId}>`]);
  return { ok: true };
}

async function moveToBank(guildId, userId, amount) {
  if (!db.isEnabled()) return { ok: false, error: 'Database unavailable — economy is offline right now.' };
  if (amount <= 0) return { ok: false, error: 'Amount must be more than 0.' };
  const user = await getOrCreateUser(guildId, userId);
  if (user.balance < amount) return { ok: false, error: `You only have ${user.balance} coins in your wallet.` };
  await db.query('UPDATE economy_users SET balance = balance - ?, bank = bank + ? WHERE guild_id = ? AND user_id = ?', [amount, amount, guildId, userId]);
  await db.query('INSERT INTO economy_transactions (guild_id, user_id, amount, type, reason) VALUES (?, ?, ?, ?, ?)',
    [guildId, userId, amount, 'deposit', 'Wallet → bank']);
  return { ok: true };
}

async function moveFromBank(guildId, userId, amount) {
  if (!db.isEnabled()) return { ok: false, error: 'Database unavailable — economy is offline right now.' };
  if (amount <= 0) return { ok: false, error: 'Amount must be more than 0.' };
  const user = await getOrCreateUser(guildId, userId);
  if (user.bank < amount) return { ok: false, error: `You only have ${user.bank} coins in the bank.` };
  await db.query('UPDATE economy_users SET bank = bank - ?, balance = balance + ? WHERE guild_id = ? AND user_id = ?', [amount, amount, guildId, userId]);
  await db.query('INSERT INTO economy_transactions (guild_id, user_id, amount, type, reason) VALUES (?, ?, ?, ?, ?)',
    [guildId, userId, amount, 'withdraw', 'Bank → wallet']);
  return { ok: true };
}

// Cooldown check: last is a DATETIME (or null); returns ms remaining, or 0.
function cooldownRemaining(last, cooldownMs) {
  if (!last) return 0;
  const elapsed = Date.now() - new Date(last).getTime();
  return Math.max(0, cooldownMs - elapsed);
}

function formatRemaining(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const WORK_JOBS = [
  'flipped burgers at the space diner',
  'debugged a haunted printer',
  'delivered packages across the server',
  'mined diamonds in the deep caves',
  'streamed a 12-hour gaming marathon',
  'fixed the Wi-Fi for the whole guild',
  'sold lemonade at the virtual fair',
  'walked 14 dogs at once',
  'wrote a bestselling novel about a cat',
  'guarded the treasure vault all night',
];

module.exports = {
  randInt, getBalance, getOrCreateUser, addCoins, transfer,
  moveToBank, moveFromBank, cooldownRemaining, formatRemaining, WORK_JOBS,
};

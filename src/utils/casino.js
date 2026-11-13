// Casino helpers: shared by /slots, /blackjack, /roulette,
// /gamble-coinflip, /gamble-dice. All games use the SAME economy wallet
// as /work and /daily (economy_users.balance) — never a second currency,
// and the bank balance never counts toward a bet.
// Flow: validate bet -> deduct stake up front (logged as casino_loss) ->
// credit the return on a win (logged as casino_win) or refund the stake
// on a push (logged as casino_push). A 5s per-user cooldown (in-memory)
// stops game spam; it only delays, never bans.
const db = require('./database');
const { getBalance, addCoins } = require('./economy');
const config = require('./config');

const COOLDOWN_MS = 5000;
const cooldowns = new Map(); // userId -> timestamp of last game

function betLimits() {
  const eco = config.economy || {};
  return { min: eco.minBet ?? 10, max: eco.maxBet ?? 10000 };
}

function cooldownRemainingMs(userId) {
  const last = cooldowns.get(userId);
  if (!last) return 0;
  return Math.max(0, COOLDOWN_MS - (Date.now() - last));
}

function markPlayed(userId) {
  cooldowns.set(userId, Date.now());
  setTimeout(() => { if (cooldowns.get(userId) && Date.now() - cooldowns.get(userId) >= COOLDOWN_MS) cooldowns.delete(userId); }, COOLDOWN_MS + 1000).unref?.();
}

async function validateBet(guildId, userId, bet) {
  const { min, max } = betLimits();
  if (!Number.isInteger(bet) || bet < min) return { ok: false, error: `Minimum bet is ${min} coins.` };
  if (bet > max) return { ok: false, error: `Maximum bet is ${max} coins.` };
  const bal = await getBalance(guildId, userId);
  if (!bal) return { ok: false, error: 'Economy is offline right now (database unavailable).' };
  if (bal.balance < bet) {
    return { ok: false, error: `You only have ${bal.balance} coins in your wallet — the bank doesn't count. Use /withdraw first if you need more.` };
  }
  return { ok: true, balance: bal.balance };
}

// Deduct the stake up front (logged as a casino_loss leg).
async function placeBet(guildId, userId, bet) {
  await addCoins(guildId, userId, -bet, 'casino_loss', 'Casino stake');
}

// Credit a win: amount is the TOTAL return (stake + winnings).
// e.g. a x2 win on a 100 bet credits 200.
async function payout(guildId, userId, amount, reason) {
  if (amount > 0) await addCoins(guildId, userId, amount, 'casino_win', reason);
}

// Refund the stake on a push (no win, no loss).
async function refund(guildId, userId, bet) {
  await addCoins(guildId, userId, bet, 'casino_push', 'Push — stake returned');
}

// --- Blackjack deck ---
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardValue(card.rank);
    if (card.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

function formatHand(hand) {
  return hand.map(formatCard).join(' ');
}

module.exports = {
  betLimits, cooldownRemainingMs, markPlayed, validateBet,
  placeBet, payout, refund, createDeck, handValue, formatCard, formatHand,
};

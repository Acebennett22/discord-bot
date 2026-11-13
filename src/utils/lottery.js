// Economy lottery (1.9.4): weekly ticket draw.
//   - One ticket per user per week, 3 unique numbers 1-30 (picked or random).
//   - Ticket price comes from guild settings `lotteryTicketPrice` (default 100).
//   - Jackpot = 50% of that week's ticket sales (the other 50% stays with
//     the house). 3 matches split the jackpot equally; 2 matches = 100 coins
//     consolation each. An unclaimed jackpot does NOT roll over in 1.9.4.
//   - Draws run Sundays at 20:00 SERVER-LOCAL bot time (see startLotteryTimer).
//     Week boundaries are Monday 00:00 UTC (see weekStartOf).
//   - Results are posted to the guild's lottery channel
//     (`lotteryChannelId` setting) and winners are DM'd (DM failure = skip).
// INTEGRATION REQUIRED (not done here — this file only reads the settings):
//   guild_settings columns lottery_ticket_price INT DEFAULT 100 and
//   lottery_channel_id VARCHAR(32) DEFAULT '', plus matching DEFAULTS /
//   COLUMNS / mapping entries in src/utils/guildSettings.js, plus the
//   lottery_tickets / lottery_draws tables (see report). Until then the
//   settings read below fall back to the defaults via `??`.
const db = require('./database');
const { getBalance, addCoins } = require('./economy');
const { getGuildSettings } = require('./guildSettings');
const { getPremiumSettings } = require('./premiumSettings');
const { successEmbed, infoEmbed } = require('./embeds');

const CONSOLATION_PRIZE = 100;
const DRAW_WEEKDAY = 0; // Sunday (server-local getDay())
const DRAW_HOUR = 20; // 20:00 server-local bot time
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

let started = false;

// --- Pure helpers (stub-testable, no DB / Discord) ---------------------------

// Monday 00:00:00 UTC of the week containing `date`.
function weekStartOf(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const diffToMonday = (day + 6) % 7; // Mon -> 0, Tue -> 1, …, Sun -> 6
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// 'YYYY-MM-DD' (UTC) for a DATE column.
function formatWeekStart(date) {
  return weekStartOf(date).toISOString().slice(0, 10);
}

// 3 unique integers in 1..30, sorted ascending.
function drawWinningNumbers() {
  const picked = new Set();
  while (picked.size < 3) picked.add(Math.floor(Math.random() * 30) + 1);
  return [...picked].sort((a, b) => a - b);
}

// Validate a user-supplied triple. Returns { ok, error? }.
function validateNumbers(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 3) {
    return { ok: false, error: 'Pick exactly 3 numbers.' };
  }
  for (const n of numbers) {
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      return { ok: false, error: 'Each number must be a whole number from 1 to 30.' };
    }
  }
  if (new Set(numbers).size !== 3) {
    return { ok: false, error: 'Your 3 numbers must all be different.' };
  }
  return { ok: true };
}

function matchCount(ticketNumbers, winningNumbers) {
  const winning = new Set(winningNumbers);
  return ticketNumbers.filter((n) => winning.has(n)).length;
}

// Next Sunday 20:00 server-local time after `now` (the draw moment).
function nextDrawDate(now = new Date()) {
  const d = new Date(now);
  d.setHours(DRAW_HOUR, 0, 0, 0);
  let addDays = (DRAW_WEEKDAY - d.getDay() + 7) % 7;
  // Today is Sunday but 20:00 already passed (or exactly now) -> next week.
  if (addDays === 0 && d <= now) addDays = 7;
  d.setDate(d.getDate() + addDays);
  return d;
}

function formatDuration(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// --- Settings -----------------------------------------------------------------

async function getLotterySettings(guildId) {
  const settings = await getGuildSettings(guildId);
  return {
    ticketPrice: settings.lotteryTicketPrice ?? 100,
    channelId: settings.lotteryChannelId || '',
  };
}

// --- DB-backed logic ------------------------------------------------------------

// Jackpot for a week = 50% of that week's ticket sales (rounded down).
// weekStart may be a Date or a 'YYYY-MM-DD' string.
async function jackpotForWeek(guildId, weekStart) {
  if (!db.isEnabled()) return 0;
  const week = typeof weekStart === 'string' ? weekStart : formatWeekStart(weekStart);
  const { ticketPrice } = await getLotterySettings(guildId);
  const rows = await db.query(
    'SELECT COUNT(*) AS n FROM lottery_tickets WHERE guild_id = ? AND week_start = ?',
    [guildId, week],
  );
  const sold = rows?.[0]?.n || 0;
  return Math.floor((sold * ticketPrice) / 2);
}

async function getUserTicket(guildId, userId, weekStart) {
  if (!db.isEnabled()) return null;
  const week = typeof weekStart === 'string' ? weekStart : formatWeekStart(weekStart);
  const rows = await db.query(
    'SELECT numbers FROM lottery_tickets WHERE guild_id = ? AND user_id = ? AND week_start = ?',
    [guildId, userId, week],
  );
  if (!rows?.length) return null;
  try { return JSON.parse(rows[0].numbers); } catch { return null; }
}

// Buy one ticket for the current week. numbers = [n1, n2, n3] or null (random).
// Returns { ok, numbers?, price?, error? }.
async function buyTicket(guildId, userId, numbers = null) {
  if (!db.isEnabled()) {
    return { ok: false, error: 'Economy offline — the database is not connected, so lottery tickets are unavailable right now.' };
  }
  const { ticketPrice } = await getLotterySettings(guildId);
  const week = formatWeekStart(new Date());

  let picked = numbers;
  if (picked) {
    const check = validateNumbers(picked);
    if (!check.ok) return { ok: false, error: check.error };
    picked = [...picked].sort((a, b) => a - b);
  } else {
    picked = drawWinningNumbers();
  }

  const existing = await getUserTicket(guildId, userId, week);
  if (existing) {
    return { ok: false, error: `You already have a ticket this week (${existing.join(', ')}). One ticket per user per week — try again after Monday.` };
  }

  const bal = await getBalance(guildId, userId);
  if (!bal) return { ok: false, error: 'Could not read your wallet balance right now — try again in a moment.' };
  if (bal.balance < ticketPrice) {
    return { ok: false, error: `A ticket costs **${ticketPrice} coins** but you only have **${bal.balance}** in your wallet.` };
  }

  // Deduct atomically-ish: only succeeds if the balance still covers it.
  const result = await db.query(
    'UPDATE economy_users SET balance = balance - ? WHERE guild_id = ? AND user_id = ? AND balance >= ?',
    [ticketPrice, guildId, userId, ticketPrice],
  );
  if (!result || result.affectedRows === 0) {
    return { ok: false, error: 'Your balance changed before the purchase went through — try again.' };
  }
  await db.query(
    'INSERT INTO economy_transactions (guild_id, user_id, amount, type, reason) VALUES (?, ?, ?, ?, ?)',
    [guildId, userId, -ticketPrice, 'lottery_ticket', `Lottery ticket: ${picked.join(', ')}`],
  );
  await db.query(
    'INSERT INTO lottery_tickets (guild_id, user_id, week_start, numbers) VALUES (?, ?, ?, ?)',
    [guildId, userId, week, JSON.stringify(picked)],
  );
  return { ok: true, numbers: picked, price: ticketPrice, weekStart: week };
}

// --- Weekly draw ------------------------------------------------------------------

// Draw one guild's week. Idempotent: if a lottery_draws row already exists
// for this guild+week, the draw is skipped (the 15-min timer re-checks).
async function drawGuildWeek(client, guildId, week) {
  const { ticketPrice, channelId } = await getLotterySettings(guildId);
  const already = await db.query(
    'SELECT id FROM lottery_draws WHERE guild_id = ? AND week_start = ? LIMIT 1',
    [guildId, week],
  );
  if (already?.length) return { guildId, week, skipped: true };

  const tickets = (await db.query(
    'SELECT user_id, numbers FROM lottery_tickets WHERE guild_id = ? AND week_start = ?',
    [guildId, week],
  )) || [];
  const winning = drawWinningNumbers();
  const jackpot = Math.floor((tickets.length * ticketPrice) / 2);
  const premium = await getPremiumSettings(guildId).catch(() => null);
  const emoji = premium?.economyCurrencyEmoji || '🪙';
  const currency = premium?.economyCurrencyName || 'coins';

  const parsed = tickets.map((t) => {
    let nums = [];
    try { nums = JSON.parse(t.numbers); } catch {}
    return { userId: t.user_id, numbers: nums, matches: matchCount(nums, winning) };
  });
  const jackpotWinners = parsed.filter((t) => t.matches === 3);
  const consolationWinners = parsed.filter((t) => t.matches === 2);
  const share = jackpotWinners.length ? Math.floor(jackpot / jackpotWinners.length) : 0;

  const paid = []; // { userId, prize, matches }
  for (const w of jackpotWinners) {
    if (share > 0) await addCoins(guildId, w.userId, share, 'lottery_win', `Lottery jackpot win (week of ${week})`);
    await db.query(
      'INSERT INTO lottery_draws (guild_id, week_start, winning_numbers, winner_id, prize) VALUES (?, ?, ?, ?, ?)',
      [guildId, week, JSON.stringify(winning), w.userId, share],
    );
    paid.push({ userId: w.userId, prize: share, matches: 3 });
  }
  for (const w of consolationWinners) {
    await addCoins(guildId, w.userId, CONSOLATION_PRIZE, 'lottery_consolation', `Lottery consolation (2 matches, week of ${week})`);
    await db.query(
      'INSERT INTO lottery_draws (guild_id, week_start, winning_numbers, winner_id, prize) VALUES (?, ?, ?, ?, ?)',
      [guildId, week, JSON.stringify(winning), w.userId, CONSOLATION_PRIZE],
    );
    paid.push({ userId: w.userId, prize: CONSOLATION_PRIZE, matches: 2 });
  }
  if (!paid.length) {
    // No winners: one row records the draw (winner NULL, prize 0 = jackpot unclaimed).
    await db.query(
      'INSERT INTO lottery_draws (guild_id, week_start, winning_numbers, winner_id, prize) VALUES (?, ?, ?, NULL, 0)',
      [guildId, week, JSON.stringify(winning)],
    );
  }

  // DM winners (failure = skip silently — e.g. DMs closed).
  for (const p of paid) {
    const user = await client.users.fetch(p.userId).catch(() => null);
    if (!user) continue;
    const label = p.matches === 3 ? `the lottery jackpot — ${emoji} ${p.prize} ${currency}` : `a lottery consolation prize — ${emoji} ${p.prize} ${currency} for 2 matching numbers`;
    await user.send({
      embeds: [successEmbed('You won the lottery!', `🎉 Your numbers matched in the weekly draw (week of ${week}) and you won ${label}!\nWinning numbers: **${winning.join(', ')}**`)],
    }).catch(() => {});
  }

  // Post results to the configured lottery channel, if one is set.
  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) {
      const winnersText = jackpotWinners.length
        ? jackpotWinners.map((w) => `<@${w.userId}>`).join(', ')
        : 'No jackpot winner this week — the jackpot goes unclaimed.';
      const consolationText = consolationWinners.length
        ? consolationWinners.map((w) => `<@${w.userId}>`).join(', ')
        : 'None';
      await channel.send({
        embeds: [infoEmbed('🎰 Weekly lottery results', `**Winning numbers:** ${winning.join(', ')}\n**Tickets sold:** ${tickets.length} · **Jackpot:** ${emoji} ${jackpot} ${currency}\n\n**🏆 Jackpot winner(s):** ${winnersText}${share > 0 ? ` — ${emoji} ${share} ${currency} each` : ''}\n**🎖️ Consolation (2 matches, ${emoji} ${CONSOLATION_PRIZE} each):** ${consolationText}\n\nBuy next week's ticket with \`/lottery buy\`!`)],
      }).catch(() => {});
    }
  }

  return { guildId, week, skipped: false, winning, jackpot, ticketsSold: tickets.length, paid };
}

// Draw the current week for every guild with tickets. `now` is injectable
// for tests; defaults to the current time.
async function runWeeklyDraw(client, { now = new Date() } = {}) {
  if (!db.isEnabled()) return [];
  const week = formatWeekStart(now);
  const guilds = (await db.query(
    'SELECT DISTINCT guild_id FROM lottery_tickets WHERE week_start = ?',
    [week],
  )) || [];
  const results = [];
  for (const g of guilds) {
    try {
      results.push(await drawGuildWeek(client, g.guild_id, week));
    } catch (err) {
      console.warn(`[lottery] draw failed for guild ${g.guild_id}:`, err.message);
    }
  }
  return results;
}

function checkLotteryDraw(client) {
  const now = new Date();
  if (now.getDay() !== DRAW_WEEKDAY || now.getHours() !== DRAW_HOUR) return;
  runWeeklyDraw(client, { now }).catch((err) => console.warn('[lottery] weekly draw failed:', err.message));
}

function startLotteryTimer(client) {
  if (started) return;
  started = true;
  checkLotteryDraw(client); // in case the bot (re)starts inside the draw hour
  setInterval(() => checkLotteryDraw(client), CHECK_INTERVAL_MS);
}

module.exports = {
  weekStartOf, formatWeekStart, drawWinningNumbers, validateNumbers,
  matchCount, nextDrawDate, formatDuration,
  jackpotForWeek, getUserTicket, buyTicket,
  runWeeklyDraw, drawGuildWeek, checkLotteryDraw, startLotteryTimer,
  CONSOLATION_PRIZE, DRAW_WEEKDAY, DRAW_HOUR,
};

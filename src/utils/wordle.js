// Wordle / daily games (1.7.1): one game per user per day, same word for
// everyone in the server that day (seeded from date + guild id, like daily
// trivia). Guesses are checked against the word list in src/data/words.json:
//   answers — 1,200 common 5-letter words, frequency-ordered from the
//     google-10000-english list (first20hours/google-10000-english on
//     GitHub) intersected with the tabatkins/wordle-list guess list.
//   allowed — the full 14,855-word tabatkins guess list (all valid guesses).
// Streaks: consecutive winning days; a loss or a missed day resets to 0.
const db = require('./database');

const { answers, allowed } = require('../data/words.json');
const ANSWER_SET = new Set(answers);
const ALLOWED_SET = new Set(allowed);

const MAX_GUESSES = 6;
const WORD_LENGTH = 5;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // UTC date — one word per UTC day.
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

function dailyWord(guildId, date = new Date()) {
  if (!answers.length) return null;
  return answers[hashString(`${guildId}:${dayKey(date)}`) % answers.length];
}

function isValidGuess(word) {
  return /^[a-z]{5}$/.test(word) && ALLOWED_SET.has(word);
}

// Standard Wordle scoring: green = right letter right place, yellow =
// right letter wrong place (letter counts respected), gray = not in word.
function evaluateGuess(guess, word) {
  const result = Array(WORD_LENGTH).fill('gray');
  const remaining = {};
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === word[i]) result[i] = 'green';
    else remaining[word[i]] = (remaining[word[i]] || 0) + 1;
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === 'green') continue;
    if (remaining[guess[i]] > 0) { result[i] = 'yellow'; remaining[guess[i]]--; }
  }
  return result;
}

function renderBoard(guesses, word) {
  if (!guesses.length) return '⬜⬜⬜⬜⬜\n⬜⬜⬜⬜⬜\n⬜⬜⬜⬜⬜\n⬜⬜⬜⬜⬜\n⬜⬜⬜⬜⬜\n⬜⬜⬜⬜⬜';
  const squares = { green: '🟩', yellow: '🟨', gray: '⬜' };
  return guesses.map((g) => evaluateGuess(g, word).map((r) => squares[r]).join('')).join('\n');
}

async function getGame(guildId, userId, date = new Date()) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM wordle_games WHERE guild_id = ? AND user_id = ? AND date = ?', [guildId, userId, dayKey(date)]);
  return rows?.[0] || null;
}

async function getOrCreateGame(guildId, userId, date = new Date()) {
  const existing = await getGame(guildId, userId, date);
  if (existing) {
    try { existing.guesses = JSON.parse(existing.guesses || '[]'); } catch { existing.guesses = []; }
    return existing;
  }
  const word = dailyWord(guildId, date);
  // Streak: keep the previous day's streak only if yesterday was a win.
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const prev = await getGame(guildId, userId, yesterday);
  const streak = prev?.won ? (prev.streak || 0) : 0;
  await db.query(
    'INSERT INTO wordle_games (guild_id, user_id, date, word, guesses, won, attempts, streak) VALUES (?, ?, ?, ?, ?, 0, 0, ?) ON DUPLICATE KEY UPDATE word = VALUES(word)',
    [guildId, userId, dayKey(date), word, '[]', streak],
  );
  return { guild_id: guildId, user_id: userId, date: dayKey(date), word, guesses: [], won: 0, attempts: 0, streak };
}

// Submit a guess. Returns { status: 'invalid'|'playing'|'won'|'lost'|'done', game, feedback }.
async function submitGuess(guildId, userId, guess, date = new Date()) {
  const word = (guess || '').toLowerCase().trim();
  if (!isValidGuess(word)) return { status: 'invalid', reason: 'not-in-list' };
  const game = await getOrCreateGame(guildId, userId, date);
  if (game.won) return { status: 'done', game };
  if (game.attempts >= MAX_GUESSES) return { status: 'done', game };
  const guesses = [...(game.guesses || []), word];
  const won = word === game.word ? 1 : 0;
  const attempts = guesses.length;
  const streak = won ? (game.streak || 0) + 1 : game.streak;
  await db.query(
    'UPDATE wordle_games SET guesses = ?, won = ?, attempts = ?, streak = ? WHERE guild_id = ? AND user_id = ? AND date = ?',
    [JSON.stringify(guesses), won, attempts, streak, guildId, userId, dayKey(date)],
  );
  const updated = { ...game, guesses, won, attempts, streak };
  const feedback = evaluateGuess(word, game.word);
  if (won) return { status: 'won', game: updated, feedback };
  if (attempts >= MAX_GUESSES) return { status: 'lost', game: updated, feedback };
  return { status: 'playing', game: updated, feedback };
}

async function getWordleLeaderboard(guildId, limit = 10) {
  if (!db.isEnabled()) return [];
  return (await db.query(
    `SELECT user_id, MAX(streak) AS best_streak, SUM(won) AS wins, COUNT(*) AS games
     FROM wordle_games WHERE guild_id = ? GROUP BY user_id ORDER BY best_streak DESC, wins DESC LIMIT ?`,
    [guildId, limit],
  )) || [];
}

module.exports = {
  MAX_GUESSES, WORD_LENGTH, dayKey, dailyWord, isValidGuess, evaluateGuess,
  renderBoard, getGame, getOrCreateGame, submitGuess, getWordleLeaderboard,
  ANSWER_SET, ALLOWED_SET,
};

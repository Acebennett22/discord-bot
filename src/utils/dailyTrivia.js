// Daily trivia — one server-wide question per day per guild, posted at a
// configured hour (default 12:00). Reuses src/data/trivia.json — no second
// question bank. The daily question is picked deterministically from the
// date + guild id, so every member in the server gets the same question.
// First correct answer wins 50 coins (economy wallet) + a trivia point.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const triviaBank = require('../data/trivia.json');
const { infoEmbed, successEmbed } = require('./embeds');
const { addCoins } = require('./economy');
const errorLogger = require('./errorLogger');

const DAILY_WIN_COINS = 50;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // UTC date — one question per UTC day.
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

function pickDailyQuestion(guildId, date) {
  if (!triviaBank.length) return null;
  const idx = hashString(`${guildId}:${dayKey(date)}`) % triviaBank.length;
  return { ...triviaBank[idx], index: idx };
}

function shuffleOptions(q) {
  const options = [...q.options];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

async function getTriviaSettings(guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM trivia_settings WHERE guild_id = ?', [guildId]);
  return rows?.[0] || null;
}

async function saveTriviaSettings(guildId, patch) {
  if (!db.isEnabled()) return false;
  const cur = await getTriviaSettings(guildId);
  const next = {
    channel_id: patch.channelId !== undefined ? (patch.channelId || null) : (cur?.channel_id || null),
    hour: patch.hour !== undefined ? patch.hour : (cur?.hour ?? 12),
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (cur?.enabled ?? 1),
  };
  await db.query(
    `INSERT INTO trivia_settings (guild_id, channel_id, hour, enabled) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id), hour = VALUES(hour), enabled = VALUES(enabled)`,
    [guildId, next.channel_id, next.hour, next.enabled],
  );
  return true;
}

async function getDailyRow(guildId, date) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM trivia_daily WHERE guild_id = ? AND date = ?', [guildId, dayKey(date)]);
  return rows?.[0] || null;
}

function dailyEmbed(guildId, date, q, options, winnerId) {
  const embed = infoEmbed('🧠 Daily Trivia',
    `**${q.question}**\n\n${options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}\n\nFirst correct answer wins **${DAILY_WIN_COINS} coins**!`);
  if (winnerId) embed.setDescription(`**${q.question}**\n\n🏆 Answered first by <@${winnerId}> — **${q.answer}**.`);
  return embed;
}

function dailyRow(guildId, date, options) {
  return new ActionRowBuilder().addComponents(
    options.map((opt, i) => new ButtonBuilder()
      .setCustomId(`dtrivia:${guildId}:${dayKey(date)}:${i}`)
      .setLabel(opt.length > 80 ? opt.slice(0, 77) + '…' : opt)
      .setStyle(ButtonStyle.Primary)),
  );
}

// Post today's question (or return the existing row). Returns null if not configured.
async function postDailyTrivia(client, guildId, date = new Date()) {
  const settings = await getTriviaSettings(guildId);
  if (!settings?.channel_id || !settings.enabled) return null;
  const existing = await getDailyRow(guildId, date);
  if (existing) return existing;
  const q = pickDailyQuestion(guildId, date);
  if (!q) return null;
  const options = shuffleOptions(q);
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const channel = guild?.channels.cache.get(settings.channel_id)
    || await guild?.channels.fetch(settings.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const msg = await channel.send({ embeds: [dailyEmbed(guildId, date, q, options, null)], components: [dailyRow(guildId, date, options)] }).catch(() => null);
  if (!msg) return null;
  await db.query(
    `INSERT INTO trivia_daily (guild_id, date, question, answer, options_json, message_id, channel_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [guildId, dayKey(date), q.question, q.answer, JSON.stringify(options), msg.id, channel.id],
  );
  return { guild_id: guildId, date: dayKey(date), question: q.question, answer: q.answer, options_json: JSON.stringify(options), message_id: msg.id, channel_id: channel.id, winner_id: null };
}

// Resolve a daily-trivia button click. Returns { status } for the handler.
async function answerDaily(interaction, guildId, dateStr, pickedIdx) {
  const row = await getDailyRow(guildId, new Date(`${dateStr}T12:00:00Z`));
  if (!row) return { status: 'gone', message: "Today's trivia has expired." };
  if (row.winner_id) return { status: 'won', message: `Already answered — <@${row.winner_id}> got it first! The answer was **${row.answer}**.` };
  const options = JSON.parse(row.options_json || '[]');
  const picked = options[pickedIdx];
  if (picked === undefined) return { status: 'gone', message: 'That answer is no longer available.' };
  if (picked !== row.answer) {
    return { status: 'wrong', message: `❌ **${picked}** isn't right — try another answer!` };
  }
  await db.query('UPDATE trivia_daily SET winner_id = ? WHERE guild_id = ? AND date = ?', [interaction.user.id, guildId, dateStr]);
  await db.query(
    `INSERT INTO trivia_scores (guild_id, user_id, wins, points) VALUES (?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE wins = wins + 1, points = points + 1`,
    [guildId, interaction.user.id],
  );
  await addCoins(guildId, interaction.user.id, DAILY_WIN_COINS, 'trivia_daily', 'Won the daily trivia');
  // Update the posted question: winner + no buttons.
  const channel = interaction.guild.channels.cache.get(row.channel_id)
    || await interaction.guild.channels.fetch(row.channel_id).catch(() => null);
  const msg = channel ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
  if (msg) {
    await msg.edit({ embeds: [dailyEmbed(guildId, new Date(`${dateStr}T12:00:00Z`), { question: row.question, answer: row.answer }, options, interaction.user.id)], components: [] }).catch(() => {});
  }
  return { status: 'correct', message: `✅ Correct! **${row.answer}** — you won **${DAILY_WIN_COINS} coins** and a trivia point!` };
}

async function getTriviaLeaderboard(guildId, limit = 10) {
  if (!db.isEnabled()) return [];
  return (await db.query(
    'SELECT user_id, wins, points FROM trivia_scores WHERE guild_id = ? ORDER BY points DESC, wins DESC LIMIT ?',
    [guildId, limit],
  )) || [];
}

// Timer: every minute, post the daily question to every guild whose hour
// has just arrived and which has no question posted yet today.
function startDailyTrivia(client) {
  const tick = async () => {
    if (!db.isEnabled()) return;
    try {
      const rows = await db.query('SELECT guild_id, hour FROM trivia_settings WHERE enabled = 1 AND channel_id IS NOT NULL') || [];
      const now = new Date();
      for (const s of rows) {
        if (now.getUTCHours() !== (s.hour ?? 12)) continue;
        const existing = await getDailyRow(s.guild_id, now);
        if (existing) continue;
        await postDailyTrivia(client, s.guild_id, now).catch((e) => errorLogger.log({ level: 'error', guildId: s.guild_id, commandName: 'trivia-daily', message: `Daily trivia post failed: ${e.message}`, stack: e.stack }));
      }
    } catch (e) {
      errorLogger.log({ level: 'error', commandName: 'trivia-daily', message: `Daily trivia tick failed: ${e.message}`, stack: e.stack });
    }
  };
  tick();
  setInterval(tick, 60_000);
}

module.exports = {
  DAILY_WIN_COINS, dayKey, pickDailyQuestion, shuffleOptions, dailyEmbed, dailyRow,
  getTriviaSettings, saveTriviaSettings, getDailyRow, postDailyTrivia, answerDaily,
  getTriviaLeaderboard, startDailyTrivia,
};

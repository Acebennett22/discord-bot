// Counting game: in the counting channel each message must start with the
// next number. Same user twice in a row or a wrong number ruins the run.
// Pure logic (evaluateCounting) is exported for stub tests — no Discord
// objects needed for it.
const db = require('./database');
const { errorEmbed, infoEmbed } = require('./embeds');
const { markBotDeleted } = require('../events/ghostPing');

// Leading integer at the start of a message ("5" or "5 hello") or null.
function parseLeadingNumber(text) {
  if (!text) return null;
  const m = /^\s*(\d+)\b/.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

// Pure decision: given the expected number and who counted last, is this
// message a valid count? Returns { valid, reason } — reason is one of
// 'ok' | 'not-a-number' | 'wrong-number' | 'same-user'.
function evaluateCounting({ expected, text, authorId, lastCounterId }) {
  const n = parseLeadingNumber(text);
  if (n === null) return { valid: false, reason: 'not-a-number' };
  if (n !== expected) return { valid: false, reason: 'wrong-number' };
  if (lastCounterId && authorId === lastCounterId) return { valid: false, reason: 'same-user' };
  return { valid: true, reason: 'ok' };
}

async function getSettings(guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM counting_settings WHERE guild_id = ?', [guildId]);
  return rows?.[0] || null;
}

async function setSettings(guildId, channelId) {
  if (!db.isEnabled()) return false;
  await db.query(
    'INSERT INTO counting_settings (guild_id, channel_id, current_count, last_counter_id, highest_count) VALUES (?, ?, 0, NULL, 0) ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id)',
    [guildId, channelId],
  );
  return true;
}

async function resetCount(guildId) {
  if (!db.isEnabled()) return false;
  await db.query('UPDATE counting_settings SET current_count = 0, last_counter_id = NULL WHERE guild_id = ?', [guildId]);
  return true;
}

// Handle one message in (potentially) the counting channel.
// Returns 'counted' | 'ruined' | 'ignored'.
async function handleCountingMessage(message) {
  if (!db.isEnabled() || !message.guild || message.author.bot) return 'ignored';
  const settings = await getSettings(message.guildId);
  if (!settings?.channel_id || settings.channel_id !== message.channelId) return 'ignored';
  if (message.content.startsWith('/')) return 'ignored';
  const expected = (settings.current_count || 0) + 1;
  const result = evaluateCounting({
    expected,
    text: message.content,
    authorId: message.author.id,
    lastCounterId: settings.last_counter_id,
  });
  if (!result.valid) {
    const ruinedAt = expected - 1;
    markBotDeleted(message.id); await message.delete().catch(() => {});
    await db.query(
      'UPDATE counting_settings SET current_count = 0, last_counter_id = NULL WHERE guild_id = ?',
      [message.guildId],
    );
    const why = result.reason === 'same-user'
      ? `${message.author} counted twice in a row!`
      : `${message.author} counted **${parseLeadingNumber(message.content) ?? '???'}** instead of **${expected}**.`;
    await message.channel.send({
      embeds: [errorEmbed('Counting ruined!', `${why}\nThe count resets to **0**. The run reached **${ruinedAt}** — the highest so far is **${Math.max(settings.highest_count || 0, ruinedAt)}**.`)],
    }).catch(() => {});
    return 'ruined';
  }
  const newCount = expected;
  await db.query(
    'UPDATE counting_settings SET current_count = ?, last_counter_id = ?, highest_count = GREATEST(highest_count, ?) WHERE guild_id = ?',
    [newCount, message.author.id, newCount, message.guildId],
  );
  await message.react('✅').catch(() => {});
  return 'counted';
}

module.exports = { parseLeadingNumber, evaluateCounting, getSettings, setSettings, resetCount, handleCountingMessage, infoEmbed };

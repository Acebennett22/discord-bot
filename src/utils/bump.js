// Bump reminders: DISBOARD-style bumps. A bump is recorded when someone
// types !d bump, or when the DISBOARD bot (302050872383242240) posts a
// successful bump. Two hours after the last bump the bot posts a reminder
// in the configured channel. All state lives in MySQL (bump_settings).
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { infoEmbed } = require('./embeds');

const DISBOARD_BOT_ID = '302050872383242240';
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000;

async function recordBump(guildId, when = new Date()) {
  if (!db.isEnabled()) return;
  await db.query(
    'INSERT INTO bump_settings (guild_id, last_bump_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_bump_at = VALUES(last_bump_at)',
    [guildId, when],
  );
}

async function getBumpSettings(guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM bump_settings WHERE guild_id = ?', [guildId]);
  return rows?.[0] || null;
}

function isBumpMessage(message) {
  if (!message.guild || message.author.bot) {
    // DISBOARD's own bot is the one exception: its bump confirmations count.
    if (message.author?.id !== DISBOARD_BOT_ID) return false;
  }
  const content = (message.content || '').trim().toLowerCase();
  if (content.startsWith('!d bump') || content === '/bump') return true;
  if (message.author?.id === DISBOARD_BOT_ID) {
    const text = `${message.content || ''} ${(message.embeds?.[0]?.description || '')}`.toLowerCase();
    return text.includes('bump done') || text.includes('server bumped');
  }
  return false;
}

async function handleBumpMessage(message) {
  if (!isBumpMessage(message)) return false;
  await recordBump(message.guildId);
  return true;
}

function msUntilNextBump(lastBumpAt) {
  if (!lastBumpAt) return 0;
  const elapsed = Date.now() - new Date(lastBumpAt).getTime();
  return Math.max(0, BUMP_COOLDOWN_MS - elapsed);
}

function formatDuration(ms) {
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

let started = false;

async function checkBumpReminders(client) {
  if (!db.isEnabled()) return;
  const rows = await db.query(
    'SELECT guild_id, last_bump_at, last_reminder_at FROM bump_settings WHERE last_bump_at IS NOT NULL',
  ) || [];
  const now = Date.now();
  for (const row of rows) {
    const lastBump = new Date(row.last_bump_at).getTime();
    if (now - lastBump < BUMP_COOLDOWN_MS) continue;
    if (row.last_reminder_at && new Date(row.last_reminder_at).getTime() > lastBump) continue;
    const settings = await getGuildSettings(row.guild_id).catch(() => null);
    if (!settings?.bumpChannelId) continue;
    const channel = await client.channels.fetch(settings.bumpChannelId).catch(() => null);
    if (!channel?.isTextBased()) continue;
    await channel.send({
      embeds: [infoEmbed('⏰ Time to bump!', 'It has been **2 hours** since the last bump. Run `!d bump` (or `/bump`) to bump the server and bring in new members!')],
    }).catch(() => {});
    await db.query('UPDATE bump_settings SET last_reminder_at = NOW() WHERE guild_id = ?', [row.guild_id]);
  }
}

function startBumpChecker(client) {
  if (started) return;
  started = true;
  setInterval(() => checkBumpReminders(client).catch(() => {}), 60_000);
}

module.exports = {
  DISBOARD_BOT_ID, BUMP_COOLDOWN_MS, recordBump, getBumpSettings,
  isBumpMessage, handleBumpMessage, msUntilNextBump, formatDuration,
  checkBumpReminders, startBumpChecker,
};

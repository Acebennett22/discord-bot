// Countdowns: a message embed that counts down to a date/time and edits
// itself as the deadline approaches. Update interval: every minute when
// under 24h is left, every 5 minutes before that (Discord message-edit
// rate limits make minute-by-minute edits wasteful for far-off dates).
// Everything lives in MySQL, so countdowns survive restarts.
const { EmbedBuilder } = require('discord.js');
const db = require('./database');
const { infoEmbed } = require('./embeds');

let started = false;
const lastUpdate = new Map(); // countdownId -> ms of last embed edit

// Accepts: "in 2h30m", "in 3d", "in 90s", "2026-12-25 18:00", "2026-12-25".
// Absolute dates are interpreted in the bot host's local time.
function parseWhen(text) {
  const raw = (text || '').trim();
  const rel = /^in\s+((?:\d+\s*[smhdw]\s*)+)$/i.exec(raw);
  if (rel) {
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
    let ms = 0;
    for (const [, n, u] of raw.slice(3).trim().matchAll(/(\d+)\s*([smhdw])/gi)) ms += parseInt(n, 10) * unitMs[u.toLowerCase()];
    if (ms <= 0) return null;
    return new Date(Date.now() + ms);
  }
  const abs = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  if (abs) {
    const d = new Date(+abs[1], +abs[2] - 1, +abs[3], +(abs[4] || 0), +(abs[5] || 0), +(abs[6] || 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatRemaining(ms) {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (mins || hours || days) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

function countdownEmbed(row, remainingMs) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`⏳ ${row.title}`)
    .setDescription(`**${formatRemaining(remainingMs)}** left\nEnds <t:${Math.floor(new Date(row.ends_at).getTime() / 1000)}:F> (<t:${Math.floor(new Date(row.ends_at).getTime() / 1000)}:R>)`)
    .setTimestamp();
}

function finishedEmbed(row) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🎉 ${row.title} is here!`)
    .setDescription(`The countdown has finished.`)
    .setTimestamp();
}

async function createCountdown(guildId, channelId, title, endsAt, createdBy) {
  if (!db.isEnabled()) return null;
  const res = await db.query(
    'INSERT INTO countdowns (guild_id, channel_id, title, ends_at, created_by) VALUES (?, ?, ?, ?, ?)',
    [guildId, channelId, title, endsAt, createdBy || null],
  );
  const rows = await db.query('SELECT * FROM countdowns WHERE id = ?', [res.insertId]);
  return rows?.[0] || null;
}

async function listCountdowns(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM countdowns WHERE guild_id = ? ORDER BY ends_at', [guildId])) || [];
}

async function cancelCountdown(guildId, id) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM countdowns WHERE guild_id = ? AND id = ?', [guildId, id]);
  if (!rows?.length) return null;
  await db.query('DELETE FROM countdowns WHERE id = ?', [id]);
  return rows[0];
}

async function updateCountdowns(client) {
  if (!db.isEnabled()) return;
  const now = Date.now();
  const rows = await db.query('SELECT * FROM countdowns ORDER BY ends_at LIMIT 50') || [];
  for (const row of rows) {
    const endsAt = new Date(row.ends_at).getTime();
    const remaining = endsAt - now;
    const last = lastUpdate.get(row.id) || 0;
    // Far-off countdowns update every 5 minutes; under 24h, every minute.
    const intervalMs = remaining > 86_400_000 ? 300_000 : 60_000;
    if (remaining > 0 && now - last < intervalMs) continue;
    try {
      const channel = await client.channels.fetch(row.channel_id).catch(() => null);
      if (!channel?.isTextBased()) { await db.query('DELETE FROM countdowns WHERE id = ?', [row.id]); continue; }
      const message = row.message_id ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
      if (!message) { await db.query('DELETE FROM countdowns WHERE id = ?', [row.id]); continue; }
      if (remaining <= 0) {
        await message.edit({ embeds: [finishedEmbed(row)] }).catch(() => {});
        await channel.send({ content: `🎉 **${row.title}** is here!`, embeds: [infoEmbed('⏳ Countdown finished', row.title)] }).catch(() => {});
        await db.query('DELETE FROM countdowns WHERE id = ?', [row.id]);
        lastUpdate.delete(row.id);
      } else {
        await message.edit({ embeds: [countdownEmbed(row, remaining)] }).catch(() => {});
        lastUpdate.set(row.id, now);
      }
    } catch (err) {
      const errorLogger = require('./errorLogger');
      await errorLogger.log({ level: 'warn', guildId: row.guild_id, commandName: 'countdown', message: `Countdown #${row.id} update failed: ${err.message}` }).catch(() => {});
    }
  }
}

function startCountdownChecker(client) {
  if (started) return;
  started = true;
  setInterval(() => updateCountdowns(client).catch(() => {}), 60_000);
  console.log('[countdowns] Checker started (60s interval).');
}

module.exports = { parseWhen, formatRemaining, countdownEmbed, finishedEmbed, createCountdown, listCountdowns, cancelCountdown, updateCountdowns, startCountdownChecker };

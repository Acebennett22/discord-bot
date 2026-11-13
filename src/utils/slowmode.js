// Slowmode presets (1.7.3): per-channel day/night slowmode schedules.
// A timer (every 15 min) applies the right slowmode for the current hour.
const db = require('./database');
const errorLogger = require('./errorLogger');

function isNightHour(hour, start, end) {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // overnight span, e.g. 22:00–08:00
}

async function setSchedule(guildId, channelId, preset) {
  await db.query(
    `INSERT INTO slowmode_schedules (guild_id, channel_id, preset_name, day_seconds, night_seconds, night_start_hour, night_end_hour)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE preset_name = VALUES(preset_name), day_seconds = VALUES(day_seconds), night_seconds = VALUES(night_seconds), night_start_hour = VALUES(night_start_hour), night_end_hour = VALUES(night_end_hour)`,
    [guildId, channelId, preset.name || 'default', preset.daySeconds, preset.nightSeconds, preset.nightStart, preset.nightEnd],
  );
}

async function removeSchedule(guildId, channelId) {
  await db.query('DELETE FROM slowmode_schedules WHERE guild_id = ? AND channel_id = ?', [guildId, channelId]);
}

async function listSchedules(guildId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM slowmode_schedules WHERE guild_id = ?', [guildId])) || [];
}

async function applySchedule(client, row, now = new Date()) {
  const hour = now.getHours();
  const night = isNightHour(hour, row.night_start_hour, row.night_end_hour);
  const seconds = night ? row.night_seconds : row.day_seconds;
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.isTextBased() || typeof channel.setRateLimitPerUser !== 'function') return { applied: false };
  const current = channel.rateLimitPerUser || 0;
  if (current === seconds) return { applied: false, already: true };
  await channel.setRateLimitPerUser(seconds, 'Slowmode schedule').catch(() => null);
  return { applied: true, seconds, night };
}

function startSlowmodeChecker(client) {
  const tick = async () => {
    if (!db.isEnabled()) return;
    try {
      const rows = await db.query('SELECT * FROM slowmode_schedules') || [];
      for (const row of rows) {
        await applySchedule(client, row).catch((e) => errorLogger.log({ level: 'error', guildId: row.guild_id, commandName: 'slowmode', message: `Slowmode apply failed: ${e.message}`, stack: e.stack }));
      }
    } catch (e) {
      errorLogger.log({ level: 'error', commandName: 'slowmode', message: `Slowmode tick failed: ${e.message}`, stack: e.stack });
    }
  };
  tick();
  setInterval(tick, 15 * 60_000);
}

module.exports = { isNightHour, setSchedule, removeSchedule, listSchedules, applySchedule, startSlowmodeChecker };

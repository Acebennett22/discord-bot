// Member / moderation event logging (1.14.2): joins, leaves, kicks, bans,
// unbans, timeouts, and role changes, posted to one log channel.
// Separate from the modlog (deleted/edited messages) and from Automod's
// log channel — a server can point all three at the same channel or not.
// Every event is individually toggleable; all default to on when a channel
// is set. DB offline = nothing is logged, never fatal.
const db = require('./database');
const { infoEmbed } = require('./embeds');

const DEFAULTS = {
  logChannelId: '',
  logJoins: true,
  logLeaves: true,
  logBans: true,
  logKicks: true,
  logTimeouts: true,
  logRoleChanges: true,
};

async function getSettings(guildId) {
  if (!db.isEnabled()) return { ...DEFAULTS };
  const rows = await db.query('SELECT * FROM logging_settings WHERE guild_id = ?', [guildId]);
  const r = rows?.[0];
  if (!r) return { ...DEFAULTS };
  return {
    logChannelId: r.log_channel_id || '',
    logJoins: Boolean(r.log_joins),
    logLeaves: Boolean(r.log_leaves),
    logBans: Boolean(r.log_bans),
    logKicks: Boolean(r.log_kicks),
    logTimeouts: Boolean(r.log_timeouts),
    logRoleChanges: Boolean(r.log_role_changes),
  };
}

async function setSettings(guildId, patch) {
  const current = await getSettings(guildId);
  const next = { ...current, ...patch };
  if (!db.isEnabled()) return { saved: false, settings: next };
  await db.query(
    `INSERT INTO logging_settings (guild_id, log_channel_id, log_joins, log_leaves, log_bans, log_kicks, log_timeouts, log_role_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE log_channel_id = VALUES(log_channel_id), log_joins = VALUES(log_joins),
       log_leaves = VALUES(log_leaves), log_bans = VALUES(log_bans), log_kicks = VALUES(log_kicks),
       log_timeouts = VALUES(log_timeouts), log_role_changes = VALUES(log_role_changes)`,
    [guildId, next.logChannelId || null, next.logJoins ? 1 : 0, next.logLeaves ? 1 : 0,
     next.logBans ? 1 : 0, next.logKicks ? 1 : 0, next.logTimeouts ? 1 : 0, next.logRoleChanges ? 1 : 0],
  );
  return { saved: true, settings: next };
}

// Post one log line. `event` is a key of DEFAULTS minus logChannelId
// ('joins', 'leaves', 'bans', 'kicks', 'timeouts', 'roleChanges') — the
// per-event toggle is checked here, so callers don't repeat the check.
async function logEvent(guild, event, title, description) {
  const key = `log${event[0].toUpperCase()}${event.slice(1)}`;
  const settings = await getSettings(guild.id);
  if (!settings.logChannelId || settings[key] === false) return;
  const channel = guild.channels.cache.get(settings.logChannelId)
    || await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [infoEmbed(title, description)] }).catch(() => {});
}

module.exports = { DEFAULTS, getSettings, setSettings, logEvent };

// Anti-nuke protection (1.9.6): count a user's destructive actions in a
// rolling 60-second window and act once they hit the guild's threshold.
//   - The in-memory window is the live counter (fast, per-process); the
//     antinuke_events table is the durable audit record.
//   - Detection is BEST-EFFORT: Discord's audit log is the only source for
//     "who did it", and it can lag or be unavailable, so the bot can only
//     act AFTER the damage has started. This limits damage; it cannot
//     prevent the first deletions. See src/events/antinukeEvents.js.
//   - NEVER acts on the guild owner or the bot itself. Whitelisted roles
//     (setting antinukeWhitelistRoles) are skipped.
// INTEGRATION REQUIRED (not done here — this file only reads the settings):
//   guild_settings columns antinuke_enabled TINYINT DEFAULT 0,
//   antinuke_action VARCHAR(16) DEFAULT 'kick', antinuke_threshold INT
//   DEFAULT 5, antinuke_log_channel_id VARCHAR(32) DEFAULT '',
//   antinuke_whitelist_roles JSON DEFAULT '[]', plus matching DEFAULTS /
//   COLUMNS / mapping entries in src/utils/guildSettings.js, plus the
//   antinuke_events table (see report). Until then the settings read below
//   fall back to the defaults via `??`.
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');
const { resolveLogChannel } = require('./logChannels');
const { errorEmbed } = require('./embeds');
const errorLogger = require('./errorLogger');

const WINDOW_MS = 60_000;
const DEFAULT_THRESHOLD = 5;
const DEFAULT_ACTION = 'kick';

// guildId:userId -> [epoch ms, ...] of destructive actions in the window.
const windows = new Map();

function windowKey(guildId, userId) { return `${guildId}:${userId}`; }

function pruneWindow(guildId, userId, now = Date.now()) {
  const key = windowKey(guildId, userId);
  const times = (windows.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length) windows.set(key, times);
  else windows.delete(key);
  return times;
}

// How many destructive actions this user has in the rolling 60s window.
function countRecentEvents(guildId, userId, now = Date.now()) {
  return pruneWindow(guildId, userId, now).length;
}

// Test/restart helper: drop all in-memory windows (DB audit rows untouched).
function resetWindowCache() { windows.clear(); }

function parseWhitelist(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string');
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch { return []; }
  }
  return [];
}

async function getAntinukeSettings(guildId) {
  const settings = await getGuildSettings(guildId);
  return {
    enabled: settings.antInukeEnabled ?? false,
    action: settings.antInukeAction || DEFAULT_ACTION,
    threshold: settings.antInukeThreshold ?? DEFAULT_THRESHOLD,
    logChannelId: settings.antInukeLogChannelId || '',
    whitelistRoles: parseWhitelist(settings.antInukeWhitelistRoles),
  };
}

// Record one destructive action: audit row in MySQL + bump the live window.
// Returns the user's current count in the rolling 60s window.
async function recordEvent(guildId, userId, action, targetId) {
  const now = Date.now();
  const times = pruneWindow(guildId, userId, now);
  times.push(now);
  windows.set(windowKey(guildId, userId), times);
  if (db.isEnabled()) {
    await db.query(
      'INSERT INTO antinuke_events (guild_id, user_id, action, target_id) VALUES (?, ?, ?, ?)',
      [guildId, userId, action, targetId || null],
    );
  }
  return times.length;
}

// True when the user's rolling-60s count reaches the guild threshold.
async function checkThreshold(guild, userId) {
  const settings = await getAntinukeSettings(guild.id);
  return countRecentEvents(guild.id, userId) >= settings.threshold;
}

async function alertOwnerAndLog(guild, user, action, count) {
  const settings = await getAntinukeSettings(guild.id);
  const reason = `Anti-nuke: ${count} destructive actions in 60s (threshold ${settings.threshold})`;
  // DM the guild owner (failure = skip silently — DMs may be closed).
  const owner = await guild.client.users.fetch(guild.ownerId).catch(() => null);
  if (owner) {
    await owner.send({
      embeds: [errorEmbed('Anti-nuke triggered', `**${user.tag}** (<@${user.id}>) performed **${count}** destructive actions in 60 seconds in **${guild.name}**.\n**Action taken:** ${action}\n${reason}`)],
    }).catch(() => {});
  }
  // Post to the anti-nuke log channel. 1.16.20: the per-type channel if
  // set, else the master log channel, else nowhere (the old fallback to
  // the general log channel is now the master fallback).
  const channelId = await resolveLogChannel(guild.id, 'antinuke');
  if (channelId) {
    const channel = await guild.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({
        embeds: [errorEmbed('Anti-nuke triggered', `**User:** <@${user.id}> (${user.tag})\n**Action taken:** ${action}\n**Destructive actions in 60s:** ${count} (threshold ${settings.threshold})`)],
      }).catch(() => {});
    }
  }
}

// Take the configured action against `user` (a User or GuildMember).
// `action` overrides the guild setting when given. Returns
// { acted, action?, reason? }. Never acts on the guild owner or the bot.
async function takeAction(guild, user, action) {
  const settings = await getAntinukeSettings(guild.id);
  if (!settings.enabled) return { acted: false, reason: 'Anti-nuke is disabled in this server.' };
  if (!user || !user.id) return { acted: false, reason: 'No user to act on.' };
  if (user.id === guild.ownerId) return { acted: false, reason: 'Refused: target is the guild owner.' };
  if (guild.client?.user && user.id === guild.client.user.id) return { acted: false, reason: 'Refused: target is the bot itself.' };

  const member = guild.members.cache.get(user.id)
    || await guild.members.fetch(user.id).catch(() => null);
  if (!member) return { acted: false, reason: 'Target is no longer a member of this server (already left / banned).' };

  // Whitelisted roles skip the action entirely.
  if (settings.whitelistRoles.length
    && member.roles.cache.some((r) => settings.whitelistRoles.includes(r.id))) {
    return { acted: false, reason: 'Target holds a whitelisted role.' };
  }

  const chosen = action || settings.action || DEFAULT_ACTION;
  const count = countRecentEvents(guild.id, user.id);
  const reason = `Anti-nuke: ${count} destructive actions in 60s (threshold ${settings.threshold})`;
  let detail = '';
  try {
    if (chosen === 'ban') {
      if (!member.bannable) return { acted: false, reason: 'Cannot ban: bot role is below the target or lacks Ban Members.' };
      await guild.members.ban(user.id, { reason });
      detail = 'banned';
    } else if (chosen === 'lockdown') {
      // Strip every role the bot can manage (never @everyone — it is not
      // in roles.cache as a removable role, but filter it explicitly anyway).
      const removable = member.roles.cache.filter((r) => r.id !== guild.id && r.manageable);
      if (!removable.size) return { acted: false, reason: 'Lockdown: no removable roles (target may outrank the bot).' };
      await member.roles.remove(removable, reason);
      detail = `lockdown: removed ${removable.size} role(s)`;
    } else {
      // Default: kick.
      if (!member.kickable) return { acted: false, reason: 'Cannot kick: bot role is below the target or lacks Kick Members.' };
      await member.kick(reason);
      detail = 'kicked';
    }
  } catch (err) {
    await errorLogger.log({ level: 'error', guildId: guild.id, commandName: 'antinuke', userId: user.id, message: `Anti-nuke ${chosen} failed for ${user.tag}: ${err.message}`, stack: err.stack }).catch(() => {});
    return { acted: false, reason: `Action failed: ${err.message}` };
  }

  // Audit: error log + DB row (action recorded as antinuke_<action>).
  await errorLogger.log({
    level: 'warn', guildId: guild.id, commandName: 'antinuke', userId: user.id,
    message: `Anti-nuke ${chosen} on ${user.tag} (${user.id}) in ${guild.name}: ${detail}. ${reason}`,
  }).catch(() => {});
  if (db.isEnabled()) {
    await db.query(
      'INSERT INTO antinuke_events (guild_id, user_id, action, target_id) VALUES (?, ?, ?, ?)',
      [guild.id, guild.client?.user?.id || 'bot', `antinuke_${chosen}`, user.id],
    );
  }
  await alertOwnerAndLog(guild, user, detail, count).catch(() => {});
  return { acted: true, action: chosen, reason: detail };
}

module.exports = {
  recordEvent, checkThreshold, takeAction,
  countRecentEvents, resetWindowCache, parseWhitelist,
  getAntinukeSettings, WINDOW_MS, DEFAULT_THRESHOLD, DEFAULT_ACTION,
};

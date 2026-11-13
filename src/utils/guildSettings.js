// Per-guild settings stored in MySQL (guild_settings table), with an in-memory
// cache. When the DB is down or no row exists, defaults are returned — the bot
// never breaks because a server hasn't run /setup yet.
const db = require('./database');
const config = require('./config');

// Short TTL cache (60s): dashboard edits are picked up without a restart,
// while the bot still avoids a DB query on every single event.
const cache = new Map(); // guildId -> { settings, at }
const CACHE_TTL_MS = 60_000;
const DEFAULTS = {
  welcomeChannelId: '', logChannelId: '',
  ticketCategoryId: '', ticketLogChannelId: '', ticketSupportRoleId: '',
  serverStatsEnabled: false, serverStatsChannels: {},
  warnThreshold: null, warnAction: null, djRoleId: '', embedColor: '',
  ticketPanelChannelId: '',
  levelUpMessages: true, levelRoles: {},
  liveChannelNameTemplate: '',
  applicationReviewerRoleId: '',
  inviteLogChannelId: '',
  inviteMinAccountAgeDays: null,
};

async function getGuildSettings(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.settings;
  let settings = { ...DEFAULTS };
  if (db.isEnabled()) {
    const rows = await db.query('SELECT welcome_channel_id, log_channel_id, ticket_category_id, ticket_log_channel_id, ticket_support_role_id, warn_threshold, warn_action, dj_role_id, embed_color, ticket_panel_channel_id, level_up_messages, level_roles, server_stats_enabled, server_stats_channels, live_channel_name_template, application_reviewer_role_id, invite_log_channel_id, invite_min_account_age_days FROM guild_settings WHERE guild_id = ?', [guildId]);
    if (rows?.length) {
      let statChannels = {};
      try { statChannels = rows[0].server_stats_channels ? JSON.parse(rows[0].server_stats_channels) : {}; } catch {}
      settings = {
        welcomeChannelId: rows[0].welcome_channel_id || '',
        logChannelId: rows[0].log_channel_id || '',
        ticketCategoryId: rows[0].ticket_category_id || '',
        ticketLogChannelId: rows[0].ticket_log_channel_id || '',
        ticketSupportRoleId: rows[0].ticket_support_role_id || '',
        serverStatsEnabled: Boolean(rows[0].server_stats_enabled),
        serverStatsChannels: statChannels,
        warnThreshold: rows[0].warn_threshold,
        warnAction: rows[0].warn_action,
        djRoleId: rows[0].dj_role_id || '',
        embedColor: rows[0].embed_color || '',
        ticketPanelChannelId: rows[0].ticket_panel_channel_id || '',
        levelUpMessages: rows[0].level_up_messages !== 0,
        levelRoles: (() => { try { return rows[0].level_roles ? JSON.parse(rows[0].level_roles) : {}; } catch { return {}; } })(),
        liveChannelNameTemplate: rows[0].live_channel_name_template || '',
        applicationReviewerRoleId: rows[0].application_reviewer_role_id || '',
        inviteLogChannelId: rows[0].invite_log_channel_id || '',
        inviteMinAccountAgeDays: rows[0].invite_min_account_age_days,
      };
    }
  }
  // Legacy fallback: a single welcome channel from config.json.
  if (!settings.welcomeChannelId && config.welcomeChannelId) settings.welcomeChannelId = config.welcomeChannelId;
  cache.set(guildId, { settings, at: Date.now() });
  return settings;
}

async function setGuildSettings(guildId, patch) {
  const current = await getGuildSettings(guildId);
  const next = { ...current, ...patch };
  cache.set(guildId, { settings: next, at: Date.now() });
  if (!db.isEnabled()) return { saved: false, settings: next };
  await db.query(
    `INSERT INTO guild_settings (guild_id, welcome_channel_id, log_channel_id, ticket_category_id, ticket_log_channel_id, ticket_support_role_id, warn_threshold, warn_action, dj_role_id, embed_color, ticket_panel_channel_id, level_up_messages, level_roles, server_stats_enabled, server_stats_channels, live_channel_name_template, application_reviewer_role_id, invite_log_channel_id, invite_min_account_age_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       welcome_channel_id = VALUES(welcome_channel_id),
       log_channel_id = VALUES(log_channel_id),
       ticket_category_id = VALUES(ticket_category_id),
       ticket_log_channel_id = VALUES(ticket_log_channel_id),
       ticket_support_role_id = VALUES(ticket_support_role_id),
       warn_threshold = VALUES(warn_threshold),
       warn_action = VALUES(warn_action),
       dj_role_id = VALUES(dj_role_id),
       embed_color = VALUES(embed_color),
       ticket_panel_channel_id = VALUES(ticket_panel_channel_id),
       level_up_messages = VALUES(level_up_messages),
       level_roles = VALUES(level_roles),
       server_stats_enabled = VALUES(server_stats_enabled),
       server_stats_channels = VALUES(server_stats_channels),
       live_channel_name_template = VALUES(live_channel_name_template),
       application_reviewer_role_id = VALUES(application_reviewer_role_id),
       invite_log_channel_id = VALUES(invite_log_channel_id),
       invite_min_account_age_days = VALUES(invite_min_account_age_days)`,
    [guildId, next.welcomeChannelId || null, next.logChannelId || null,
     next.ticketCategoryId || null, next.ticketLogChannelId || null, next.ticketSupportRoleId || null,
     next.warnThreshold ?? null, next.warnAction || null, next.djRoleId || null,
     next.embedColor || null, next.ticketPanelChannelId || null,
     next.levelUpMessages ? 1 : 0, JSON.stringify(next.levelRoles || {}),
     next.serverStatsEnabled ? 1 : 0, JSON.stringify(next.serverStatsChannels || {}),
     next.liveChannelNameTemplate || null,
     next.applicationReviewerRoleId || null,
     next.inviteLogChannelId || null,
     next.inviteMinAccountAgeDays ?? null],
  );
  return { saved: true, settings: next };
}

function invalidate(guildId) { cache.delete(guildId); }

module.exports = { getGuildSettings, setGuildSettings, invalidate, DEFAULTS };

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
  welcomeChannelId: '', welcomeMessage: '', welcomeEnabled: true,
  goodbyeChannelId: '', goodbyeMessage: '', goodbyeEnabled: true,
  suggestionChannelId: '',
  logChannelId: '',
  ticketCategoryId: '', ticketLogChannelId: '', ticketSupportRoleId: '',
  serverStatsEnabled: false, serverStatsChannels: {},
  warnThreshold: null, warnAction: null, djRoleId: '', embedColor: '',
  ticketPanelChannelId: '',
  levelUpMessages: true, levelRoles: {},
  liveChannelNameTemplate: '',
  applicationReviewerRoleId: '',
  inviteLogChannelId: '',
  inviteMinAccountAgeDays: null,
  botThreshold: null,
  botAutoAction: 'flag',
  botSuspectRoleId: '',
};

const DEFAULT_WELCOME_MESSAGE = 'Welcome to {server}, {user}! You are member #{membercount}.';
const DEFAULT_GOODBYE_MESSAGE = '{username} has left {server}. We had {membercount} members.';

const COLUMNS = [
  'welcome_channel_id', 'welcome_message', 'welcome_enabled',
  'goodbye_channel_id', 'goodbye_message', 'goodbye_enabled',
  'suggestion_channel_id',
  'log_channel_id', 'ticket_category_id', 'ticket_log_channel_id', 'ticket_support_role_id',
  'warn_threshold', 'warn_action', 'dj_role_id', 'embed_color', 'ticket_panel_channel_id',
  'level_up_messages', 'level_roles', 'server_stats_enabled', 'server_stats_channels',
  'live_channel_name_template', 'application_reviewer_role_id',
  'invite_log_channel_id', 'invite_min_account_age_days',
  'bot_threshold', 'bot_auto_action', 'bot_suspect_role_id',
];

async function getGuildSettings(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.settings;
  let settings = { ...DEFAULTS };
  if (db.isEnabled()) {
    const rows = await db.query(`SELECT ${COLUMNS.join(', ')} FROM guild_settings WHERE guild_id = ?`, [guildId]);
    if (rows?.length) {
      const r = rows[0];
      let statChannels = {};
      try { statChannels = r.server_stats_channels ? JSON.parse(r.server_stats_channels) : {}; } catch {}
      settings = {
        welcomeChannelId: r.welcome_channel_id || '',
        welcomeMessage: r.welcome_message || DEFAULT_WELCOME_MESSAGE,
        welcomeEnabled: r.welcome_enabled !== 0,
        goodbyeChannelId: r.goodbye_channel_id || '',
        goodbyeMessage: r.goodbye_message || DEFAULT_GOODBYE_MESSAGE,
        goodbyeEnabled: r.goodbye_enabled !== 0,
        suggestionChannelId: r.suggestion_channel_id || '',
        logChannelId: r.log_channel_id || '',
        ticketCategoryId: r.ticket_category_id || '',
        ticketLogChannelId: r.ticket_log_channel_id || '',
        ticketSupportRoleId: r.ticket_support_role_id || '',
        serverStatsEnabled: Boolean(r.server_stats_enabled),
        serverStatsChannels: statChannels,
        warnThreshold: r.warn_threshold,
        warnAction: r.warn_action,
        djRoleId: r.dj_role_id || '',
        embedColor: r.embed_color || '',
        ticketPanelChannelId: r.ticket_panel_channel_id || '',
        levelUpMessages: r.level_up_messages !== 0,
        levelRoles: (() => { try { return r.level_roles ? JSON.parse(r.level_roles) : {}; } catch { return {}; } })(),
        liveChannelNameTemplate: r.live_channel_name_template || '',
        applicationReviewerRoleId: r.application_reviewer_role_id || '',
        inviteLogChannelId: r.invite_log_channel_id || '',
        inviteMinAccountAgeDays: r.invite_min_account_age_days,
        botThreshold: r.bot_threshold,
        botAutoAction: r.bot_auto_action || 'flag',
        botSuspectRoleId: r.bot_suspect_role_id || '',
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
  const values = [
    next.welcomeChannelId || null, next.welcomeMessage || null, next.welcomeEnabled ? 1 : 0,
    next.goodbyeChannelId || null, next.goodbyeMessage || null, next.goodbyeEnabled ? 1 : 0,
    next.suggestionChannelId || null,
    next.logChannelId || null, next.ticketCategoryId || null, next.ticketLogChannelId || null,
    next.ticketSupportRoleId || null,
    next.warnThreshold ?? null, next.warnAction || null, next.djRoleId || null,
    next.embedColor || null, next.ticketPanelChannelId || null,
    next.levelUpMessages ? 1 : 0, JSON.stringify(next.levelRoles || {}),
    next.serverStatsEnabled ? 1 : 0, JSON.stringify(next.serverStatsChannels || {}),
    next.liveChannelNameTemplate || null,
    next.applicationReviewerRoleId || null,
    next.inviteLogChannelId || null,
    next.inviteMinAccountAgeDays ?? null,
    next.botThreshold ?? null,
    next.botAutoAction || 'flag',
    next.botSuspectRoleId || null,
  ];
  // COLUMNS.length columns, values.length params — keep them in sync.
  if (values.length !== COLUMNS.length) throw new Error(`guildSettings column/param mismatch: ${COLUMNS.length} columns, ${values.length} values`);
  await db.query(
    `INSERT INTO guild_settings (guild_id, ${COLUMNS.join(', ')})
     VALUES (?, ${COLUMNS.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${COLUMNS.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
    [guildId, ...values],
  );
  return { saved: true, settings: next };
}

function invalidate(guildId) { cache.delete(guildId); }

module.exports = { getGuildSettings, setGuildSettings, invalidate, DEFAULTS, DEFAULT_WELCOME_MESSAGE, DEFAULT_GOODBYE_MESSAGE };

// Per-guild premium settings (economy, starboard, modlog, auto-role /
// sticky roles), stored in the guild_premium_settings table in
// sql/premium.sql — separate from guild_settings.js so premium features
// never clash with the core settings. Same pattern: in-memory cache with
// a 60s TTL, defaults when the DB is down or no row exists.
const db = require('./database');
const config = require('./config');
const { mirrorLogChannel } = require('./logChannels');

const cache = new Map(); // guildId -> { settings, at }
const CACHE_TTL_MS = 60_000;

function defaults() {
  const eco = config.economy || {};
  return {
    starboardChannelId: '',
    starboardThreshold: 3,
    starboardEmoji: '⭐',
    modlogChannelId: '',
    autoroleId: '',
    stickyRolesEnabled: false,
    economyStartingBalance: eco.startingBalance ?? 100,
    economyDailyMin: eco.dailyMin ?? 100,
    economyDailyMax: eco.dailyMax ?? 500,
    economyWorkMin: eco.workMin ?? 50,
    economyWorkMax: eco.workMax ?? 250,
    economyCurrencyName: eco.currencyName || 'coins',
    economyCurrencyEmoji: eco.currencyEmoji || '🪙',
  };
}

async function getPremiumSettings(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.settings;
  let settings = defaults();
  if (db.isEnabled()) {
    const rows = await db.query(
      'SELECT starboard_channel_id, starboard_threshold, starboard_emoji, modlog_channel_id, autorole_id, sticky_roles_enabled, economy_starting_balance, economy_daily_min, economy_daily_max, economy_work_min, economy_work_max, economy_currency_name, economy_currency_emoji FROM guild_premium_settings WHERE guild_id = ?',
      [guildId],
    );
    if (rows?.length) {
      const r = rows[0];
      settings = {
        starboardChannelId: r.starboard_channel_id || '',
        starboardThreshold: r.starboard_threshold ?? 3,
        starboardEmoji: r.starboard_emoji || '⭐',
        modlogChannelId: r.modlog_channel_id || '',
        autoroleId: r.autorole_id || '',
        stickyRolesEnabled: Boolean(r.sticky_roles_enabled),
        economyStartingBalance: r.economy_starting_balance ?? settings.economyStartingBalance,
        economyDailyMin: r.economy_daily_min ?? settings.economyDailyMin,
        economyDailyMax: r.economy_daily_max ?? settings.economyDailyMax,
        economyWorkMin: r.economy_work_min ?? settings.economyWorkMin,
        economyWorkMax: r.economy_work_max ?? settings.economyWorkMax,
        economyCurrencyName: r.economy_currency_name || settings.economyCurrencyName,
        economyCurrencyEmoji: r.economy_currency_emoji || settings.economyCurrencyEmoji,
      };
    }
  }
  cache.set(guildId, { settings, at: Date.now() });
  return settings;
}

async function setPremiumSettings(guildId, patch) {
  const current = await getPremiumSettings(guildId);
  const next = { ...current, ...patch };
  cache.set(guildId, { settings: next, at: Date.now() });
  if (!db.isEnabled()) return { saved: false, settings: next };
  await db.query(
    `INSERT INTO guild_premium_settings
       (guild_id, starboard_channel_id, starboard_threshold, starboard_emoji, modlog_channel_id, autorole_id, sticky_roles_enabled, economy_starting_balance, economy_daily_min, economy_daily_max, economy_work_min, economy_work_max, economy_currency_name, economy_currency_emoji)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       starboard_channel_id = VALUES(starboard_channel_id),
       starboard_threshold = VALUES(starboard_threshold),
       starboard_emoji = VALUES(starboard_emoji),
       modlog_channel_id = VALUES(modlog_channel_id),
       autorole_id = VALUES(autorole_id),
       sticky_roles_enabled = VALUES(sticky_roles_enabled),
       economy_starting_balance = VALUES(economy_starting_balance),
       economy_daily_min = VALUES(economy_daily_min),
       economy_daily_max = VALUES(economy_daily_max),
       economy_work_min = VALUES(economy_work_min),
       economy_work_max = VALUES(economy_work_max),
       economy_currency_name = VALUES(economy_currency_name),
       economy_currency_emoji = VALUES(economy_currency_emoji)`,
    [guildId, next.starboardChannelId || null, next.starboardThreshold, next.starboardEmoji || '⭐',
     next.modlogChannelId || null, next.autoroleId || null, next.stickyRolesEnabled ? 1 : 0,
     next.economyStartingBalance, next.economyDailyMin, next.economyDailyMax,
     next.economyWorkMin, next.economyWorkMax,
     next.economyCurrencyName || 'coins', next.economyCurrencyEmoji || '🪙'],
  );
  // 1.16.20: keep the new log_channels table in sync — only when the modlog
  // channel actually changed, so a save that only touches economy/starboard
  // never touches it.
  await mirrorLogChannel(guildId, 'message', current.modlogChannelId, next.modlogChannelId);
  return { saved: true, settings: next };
}

function invalidate(guildId) { cache.delete(guildId); }

module.exports = { getPremiumSettings, setPremiumSettings, invalidate, defaults };

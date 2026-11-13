// Command + feature toggles (global '' = everywhere, or per-guild).
// Enforced in interactionCreate before any command runs, and in the
// relevant background jobs. No DB = everything enabled.
const db = require('./database');

const COMMAND_FEATURES = {
  play: 'music', skip: 'music', stop: 'music', queue: 'music', pause: 'music', resume: 'music',
  'ticket-setup': 'tickets', 'ticket-close': 'tickets', 'ticket-add': 'tickets', 'ticket-remove': 'tickets', 'ticket-claim': 'tickets',
  rank: 'leveling', leaderboard: 'leveling', setlevel: 'leveling',
  giveaway: 'giveaways',
  'stream-add': 'streams', 'stream-remove': 'streams', 'stream-list': 'streams', 'stream-announce': 'streams',
  serverstatus: 'gameservers', 'gameserver-add': 'gameservers', 'gameserver-remove': 'gameservers', 'gameserver-list': 'gameservers',
  'serverstats-setup': 'serverstats', 'serverstats-toggle': 'serverstats',
  'errors': null, 'error': null, 'errors-clear': null,
  'invites': 'invites', 'inviteleaderboard': 'invites', 'invite-info': 'invites', 'invite-reset': 'invites',
  'application-create': 'applications', 'application-list': 'applications', 'application-open': 'applications', 'application-close': 'applications', 'apply': 'applications', 'application-accept': 'applications', 'application-deny': 'applications', 'application-status': 'applications', 'application-view': 'applications',
  'reactionroles-setup': 'reactionroles', 'reactionroles-add': 'reactionroles', 'reactionroles-remove': 'reactionroles', 'reactionroles-list': 'reactionroles',
  'welcome-setup': 'welcome', 'welcome-toggle': 'welcome', 'goodbye-setup': 'welcome', 'goodbye-toggle': 'welcome', 'welcome-test': 'welcome',
  'automod': 'automod', 'automod-setup': 'automod', 'automod-words': 'automod', 'automod-exempt': 'automod',
  'suggest': 'suggestions', 'suggestions-setup': 'suggestions', 'suggest-status': 'suggestions',
  'balance': 'economy', 'daily': 'economy', 'work': 'economy', 'pay': 'economy', 'eco-leaderboard': 'economy', 'shop': 'economy', 'shop-add': 'economy', 'deposit': 'economy', 'withdraw': 'economy', 'slots': 'casino', 'blackjack': 'casino', 'roulette': 'casino', 'gamble-coinflip': 'casino', 'gamble-dice': 'casino', 'buy': 'economy', 'sell': 'economy', 'inventory': 'economy', 'open-crate': 'economy', 'use': 'economy', 'trade': 'trading', 'trade-cancel': 'trading', 'botflags': 'bottracking', 'botflag': 'bottracking', 'botflag-clear': 'bottracking', 'bottrack': 'bottracking',
  'starboard-setup': 'starboard',
  'custom-add': 'customcommands', 'custom-remove': 'customcommands', 'custom-list': 'customcommands',
  'modlog-setup': 'modlog',
  'afk': 'afk', 'afk-remove': 'afk',
  'poll': 'polls', 'poll-end': 'polls',
  'autorole': 'autorole',
  'schedule': 'scheduler', 'schedule-list': 'scheduler', 'schedule-cancel': 'scheduler', 'remindme': 'scheduler',
  'faq-add': 'faq', 'faq-remove': 'faq', 'faq-list': 'faq',
  'presence': 'presence',
  'verify-setup': 'verification', 'verify-toggle': 'verification',
  'counting-setup': 'counting', 'counting-reset': 'counting',
  'bump-setup': 'counting', 'bump': 'counting',
  'tempvc': 'tempvc',
  'filter': 'music', 'lyrics': 'music', 'nowplaying': 'music',
  'birthday': 'birthdays', 'birthday-setup': 'birthdays',
  'weather': 'weather', 'forecast': 'weather', 'weather-set': 'weather',
  'ask': 'ai', 'ai-setup': 'ai',
  'mcstatus-setup': 'gameservers',
  'voicexp': 'leveling', 'color': 'colorroles', 'color-add': 'colorroles', 'color-remove-role': 'colorroles',
  'stream-clip-toggle': 'streams',
  'modmail-setup': 'modmail', 'modmail-close': 'modmail', 'modmail-block': 'modmail',
  'mediathreads': 'media', 'temprole': 'temproles', 'ghostping-setup': 'moderation',
  'serverbackup': 'admin', 'quote': 'quotes', 'quotes': 'quotes', 'quote-random': 'quotes', 'quote-leaderboard': 'quotes',
  'threadarchive': 'moderation', 'xpshop': 'leveling', 'xpshop-add': 'leveling', 'xpshop-remove': 'leveling',
  'streak': 'economy', 'streak-leaderboard': 'economy', 'confess': 'confessions',
  'birthday-role': 'birthdays', 'voicelb': 'leveling', 'voicetime': 'leveling',
  'playlist': 'music',
  'trivia-daily': 'fun', 'trivia-leaderboard': 'fun',
  'heist': 'casino',
  'milestones': 'welcome', 'milestone-setup': 'welcome',
  'rolemenu': 'reactionroles',
  'translate': 'translate', 'translate-setup': 'translate',
  'dj-setup': 'music', 'dj': 'music', 'queue-clear': 'music',
  'emoji-add': 'emojis', 'emoji-remove': 'emojis', 'emoji-list': 'emojis',
  'countdown': 'countdowns',
  'prestige': 'leveling', 'prestige-leaderboard': 'leveling',
  'ticket-panel': 'tickets',
  'inviterole': 'invites',
  'wordle': 'fun', 'wordle-leaderboard': 'fun',
  'event': 'events',
  'slowmode': 'moderation', 'slowmode-schedule': 'moderation', 'slowmode-schedule-remove': 'moderation',
  'afkvoice-setup': 'moderation', 'afkchannel-setup': 'tempvc',
  'starboard-image-setup': 'starboard',
  'statusrole': 'statusroles',
  'snipe': 'moderation', 'editsnipe': 'moderation',
  'embed': 'embeds',
  'poll-results': 'polls',
  'ticket-ratings': 'tickets',
  'levelup-channel': 'leveling',
  'invitereward': 'invites', 'myinviterewards': 'invites',
  'bookmark': 'bookmarks', 'Bookmark message': 'bookmarks',
  'autopublish': 'announcements',
  'reengage-setup': 'reengage', 'reengage-optout': 'reengage', 'reengage-preview': 'reengage',
};

const FEATURES = ['media', 'temproles', 'quotes', 'confessions','music', 'tickets', 'leveling', 'giveaways', 'streams', 'gameservers', 'serverstats', 'reactionroles', 'applications', 'invites', 'welcome', 'automod', 'suggestions', 'economy', 'starboard', 'customcommands', 'modlog', 'afk', 'polls', 'autorole', 'scheduler', 'faq', 'presence', 'casino', 'trading', 'bottracking', 'verification', 'counting', 'tempvc', 'birthdays', 'weather', 'ai', 'colorroles', 'modmail', 'fun', 'translate', 'emojis', 'countdowns', 'events', 'statusroles', 'embeds', 'bookmarks', 'announcements', 'reengage'];

async function isEnabled(table, key, guildId) {
  if (!db.isEnabled()) return true;
  const col = table === 'command_toggles' ? 'command_name' : 'feature';
  const rows = await db.query(
    `SELECT guild_id, enabled FROM ${table} WHERE ${col} = ? AND guild_id IN ('', ?)`,
    [key, guildId || ''],
  ) || [];
  for (const r of rows) {
    if (r.enabled === 0) return false;
  }
  return true;
}

async function isCommandEnabled(commandName, guildId) {
  if (!(await isEnabled('command_toggles', commandName, guildId))) return { enabled: false, reason: 'command' };
  const feature = COMMAND_FEATURES[commandName];
  if (feature && !(await isEnabled('feature_toggles', feature, guildId))) return { enabled: false, reason: 'feature', feature };
  return { enabled: true };
}

async function isFeatureEnabled(feature, guildId) {
  return isEnabled('feature_toggles', feature, guildId);
}

async function setToggle(table, key, guildId, enabled, updatedBy) {
  if (!db.isEnabled()) return false;
  const col = table === 'command_toggles' ? 'command_name' : 'feature';
  await db.query(
    `INSERT INTO ${table} (${col}, guild_id, enabled, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by)`,
    [key, guildId || '', enabled ? 1 : 0, updatedBy || null],
  );
  return true;
}

module.exports = { COMMAND_FEATURES, FEATURES, isCommandEnabled, isFeatureEnabled, setToggle };

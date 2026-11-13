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
};

const FEATURES = ['music', 'tickets', 'leveling', 'giveaways', 'streams', 'gameservers', 'serverstats', 'reactionroles', 'applications', 'invites'];

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

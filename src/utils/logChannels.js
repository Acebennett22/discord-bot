// Per-type log channels + a master log channel (1.16.20, Dyno-style).
//
// Every log the bot emits belongs to one of LOG_TYPES. Each type has its own
// channel setting, and there is one master channel every type falls back to:
//
//   type's channel set  -> log goes there
//   type unset (NULL)  -> log goes to the master channel, if set
//   type set to ''      -> explicitly off, never falls back to the master
//   nothing set        -> the log goes nowhere (the pre-1.16.20 behaviour
//                         for a server with no log channel configured)
//
// The single source of truth is the `log_channels` table (created by the
// startup self-heal in src/utils/database.js, mirrored in sql/schema.sql).
// The legacy per-table settings (guild_settings.log_channel_id,
// guild_settings.ticket_log_channel_id, guild_settings.invite_log_channel_id,
// guild_settings.antinuke_log_channel_id, logging_settings.log_channel_id,
// guild_premium_settings.modlog_channel_id, automod_settings.log_channel_id)
// keep working: they are lazily seeded into the new table on first read
// (legacy values fill only columns that are still NULL — an explicit
// per-type choice or an explicit off on the Log Channels page is never
// overwritten), and the legacy setters mirror a changed log channel into
// the new table (see mirrorLogChannel), so the old slash commands and
// dashboard pages keep writing where they always did.
const db = require('./database');

// The log types the bot emits, in dashboard order. This is the complete
// list as of 1.16.20 — no separate voice, channel, role, or emoji log
// types exist in code; those events are covered by the member type.
const LOG_TYPES = [
  { key: 'member', label: 'Member logs', description: 'Joins, leaves, bans, kicks, timeouts, role changes' },
  { key: 'message', label: 'Message logs', description: 'Deleted and edited messages, bot-join flags, confession review queue' },
  { key: 'moderation', label: 'Moderation logs', description: 'Mod command usage, user reports, AFK voice kicks' },
  { key: 'ticket', label: 'Ticket logs', description: 'Ticket close logs and transcripts' },
  { key: 'invite', label: 'Invite logs', description: 'Joins via invite, invite rewards' },
  { key: 'antinuke', label: 'Anti-nuke logs', description: 'Anti-nuke triggers and actions' },
  { key: 'automod', label: 'Automod logs', description: 'Automod actions (spam, links, banned words)' },
];

const COLUMNS = [
  ['master', 'master_channel_id'],
  ['member', 'member_channel_id'],
  ['message', 'message_channel_id'],
  ['moderation', 'moderation_channel_id'],
  ['ticket', 'ticket_channel_id'],
  ['invite', 'invite_channel_id'],
  ['antinuke', 'antinuke_channel_id'],
  ['automod', 'automod_channel_id'],
];

const EMPTY = { master: null, member: null, message: null, moderation: null, ticket: null, invite: null, antinuke: null, automod: null };

// Guilds already seeded this process — the seed is idempotent, so one
// successful run per guild per process is enough.
const seeded = new Set();

const idOrNull = (v) => (v ? String(v) : null);

// Copy the legacy per-table log channel settings into the new table.
// Only fills columns that are still NULL (COALESCE), so a per-type choice
// or an explicit off saved on the Log Channels page is never overwritten,
// and a later mirror from a legacy setter always wins over the seed.
async function ensureSeeded(guildId) {
  if (seeded.has(guildId) || !db.isEnabled()) return;
  try {
    const gsRows = await db.query('SELECT log_channel_id, ticket_log_channel_id, invite_log_channel_id, antinuke_log_channel_id, welcome_channel_id FROM guild_settings WHERE guild_id = ?', [guildId]);
    const lsRows = await db.query('SELECT log_channel_id FROM logging_settings WHERE guild_id = ?', [guildId]);
    const psRows = await db.query('SELECT modlog_channel_id FROM guild_premium_settings WHERE guild_id = ?', [guildId]);
    const amRows = await db.query('SELECT log_channel_id FROM automod_settings WHERE guild_id = ?', [guildId]);
    const gs = gsRows?.[0];
    const ls = lsRows?.[0];
    const ps = psRows?.[0];
    const am = amRows?.[0];
    // Invite logs are the one legacy quirk: when no invite log channel was
    // set, they went to the welcome channel, not the general log channel.
    // Seed the invite type from the welcome channel too, so a server that
    // logged invites to its welcome channel keeps doing exactly that. (If
    // the welcome channel is set later, the invite emitter still falls back
    // to it when the type is unset and no master is set — see
    // resolveLogChannelOr.)
    await db.query(
      `INSERT INTO log_channels (guild_id, master_channel_id, member_channel_id, message_channel_id, moderation_channel_id, ticket_channel_id, invite_channel_id, antinuke_channel_id, automod_channel_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         master_channel_id = COALESCE(master_channel_id, VALUES(master_channel_id)),
         member_channel_id = COALESCE(member_channel_id, VALUES(member_channel_id)),
         message_channel_id = COALESCE(message_channel_id, VALUES(message_channel_id)),
         moderation_channel_id = COALESCE(moderation_channel_id, VALUES(moderation_channel_id)),
         ticket_channel_id = COALESCE(ticket_channel_id, VALUES(ticket_channel_id)),
         invite_channel_id = COALESCE(invite_channel_id, VALUES(invite_channel_id)),
         antinuke_channel_id = COALESCE(antinuke_channel_id, VALUES(antinuke_channel_id)),
         automod_channel_id = COALESCE(automod_channel_id, VALUES(automod_channel_id))`,
      [guildId, idOrNull(gs?.log_channel_id), idOrNull(ls?.log_channel_id), idOrNull(ps?.modlog_channel_id), idOrNull(gs?.log_channel_id), idOrNull(gs?.ticket_log_channel_id), idOrNull(gs?.invite_log_channel_id || gs?.welcome_channel_id), idOrNull(gs?.antinuke_log_channel_id), idOrNull(am?.log_channel_id)],
    );
    seeded.add(guildId);
  } catch {
    // Seeding is best-effort: routing falls back to nowhere, and the next
    // read retries the seed.
  }
}

// Raw settings for a guild: channel id, null (unset — use master), or ''
// (explicitly off). Seeded from the legacy settings on first access.
async function getLogChannels(guildId) {
  if (!db.isEnabled()) return { ...EMPTY };
  if (!seeded.has(guildId)) await ensureSeeded(guildId);
  const rows = await db.query('SELECT * FROM log_channels WHERE guild_id = ?', [guildId]).catch(() => null);
  const r = rows?.[0];
  if (!r) return { ...EMPTY };
  const val = (v) => (v == null ? null : String(v));
  return {
    master: val(r.master_channel_id),
    member: val(r.member_channel_id),
    message: val(r.message_channel_id),
    moderation: val(r.moderation_channel_id),
    ticket: val(r.ticket_channel_id),
    invite: val(r.invite_channel_id),
    antinuke: val(r.antinuke_channel_id),
    automod: val(r.automod_channel_id),
  };
}

// Resolve a type against an already-fetched settings object (pure).
// Returns a channel id, or '' when the type logs nowhere.
function resolveFromChannels(channels, type) {
  if (!LOG_TYPES.some((t) => t.key === type)) return '';
  const v = channels[type];
  if (v === '') return ''; // explicitly off — never falls back to the master
  if (v) return v;
  if (channels.master) return channels.master;
  return '';
}

// Resolve one type for a guild: its channel if set, else the master
// channel if set, else '' (nowhere).
async function resolveLogChannel(guildId, type) {
  const channels = await getLogChannels(guildId);
  return resolveFromChannels(channels, type);
}

// Like resolveLogChannel, but with one extra fallback: when the type is
// unset (NULL) and no master is set, `fallbackId` is used instead of ''.
// An explicitly-off type ('') never falls back. Only the invite emitter
// uses this — it is the one legacy fallback (the welcome channel) that
// predates the master channel.
async function resolveLogChannelOr(guildId, type, fallbackId) {
  const channels = await getLogChannels(guildId);
  if (channels[type] === '') return '';
  return resolveFromChannels(channels, type) || (fallbackId || '');
}

// Effective channel for every type, from one settings read. Pass an
// already-fetched settings object to avoid a second read.
async function getEffectiveChannels(guildId, channels) {
  const ch = channels || await getLogChannels(guildId);
  const effective = {};
  for (const t of LOG_TYPES) effective[t.key] = resolveFromChannels(ch, t.key);
  return effective;
}

// Resolve and fetch the Discord channel for a log type, or null when the
// type logs nowhere or the channel is gone / not a text channel.
async function fetchLogChannel(guild, type) {
  const id = await resolveLogChannel(guild.id, type);
  if (!id) return null;
  const channel = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

// Save log channel settings. `patch` keys are the LOG_TYPES keys plus
// 'master'; values are a channel id, null (use master / unset), or ''
// (explicitly off). Only the keys present are written. Returns
// { saved, channels } — saved is false when MySQL is down.
async function setLogChannels(guildId, patch) {
  const clean = {};
  for (const [key] of COLUMNS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    clean[key] = v == null ? null : String(v);
  }
  if (Object.keys(clean).length === 0) return { saved: true, channels: await getLogChannels(guildId) };
  if (!db.isEnabled()) return { saved: false, channels: await getLogChannels(guildId) };
  const set = COLUMNS.filter(([key]) => key in clean);
  const colNames = ['guild_id', ...set.map(([, col]) => col)];
  const updates = set.map(([, col]) => `${col} = VALUES(${col})`).join(', ');
  await db.query(
    `INSERT INTO log_channels (${colNames.join(', ')}) VALUES (${colNames.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${updates}`,
    [guildId, ...set.map(([key]) => clean[key])],
  );
  return { saved: true, channels: await getLogChannels(guildId) };
}

// Mirror a changed legacy log channel into the new table. Called by the
// legacy setters after a successful save, only when the value actually
// changed — so a settings save that did not touch the log channel (or
// re-saved the same empty value, as the staff antinuke form does on every
// save) leaves the new table alone. `oldValue`/`newValue` are the legacy
// field values (channel id or ''/null).
async function mirrorLogChannel(guildId, type, oldValue, newValue) {
  const norm = (v) => (v == null ? '' : String(v));
  if (norm(oldValue) === norm(newValue)) return;
  await setLogChannels(guildId, { [type]: norm(newValue) }).catch(() => {});
}

module.exports = {
  LOG_TYPES,
  ensureSeeded,
  getLogChannels,
  resolveFromChannels,
  resolveLogChannel,
  resolveLogChannelOr,
  getEffectiveChannels,
  fetchLogChannel,
  setLogChannels,
  mirrorLogChannel,
};

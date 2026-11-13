// Tempbans: duration parsing, DB records, expiry processing + timer.
// The ban itself is a normal Discord ban; this module only tracks when it
// should end. If MySQL is down (db.query() returns null) every helper
// degrades gracefully — the ban still happens, it just won't auto-expire
// until the DB is back (processExpiredTempbans re-reads the table each run).
const db = require('./database');
const { logError, logWarn } = require('./errorLogger');

const CHECK_INTERVAL_MS = 5 * 60_000; // every 5 minutes

// "7d" | "30d" | "12h" | "2w" | "90m" | "45s" -> milliseconds, or null.
// Units: s = seconds, m = minutes, h = hours, d = days, w = weeks.
function parseDuration(str) {
  const m = /^(\d+)([smhdw])$/.exec(String(str || '').trim().toLowerCase());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]];
  return n * mult;
}

// Duration string -> expiry Date (from `from`, default now), or null.
function getExpiry(durationStr, from = Date.now()) {
  const ms = parseDuration(durationStr);
  if (ms === null) return null;
  return new Date(from + ms);
}

async function recordTempban(guildId, userId, bannedBy, reason, expiresAt) {
  const rows = await db.query(
    'INSERT INTO temp_bans (guild_id, user_id, banned_by, reason, banned_at, expires_at, unbanned, cancelled) VALUES (?, ?, ?, ?, NOW(), ?, 0, 0)',
    [guildId, userId, bannedBy, reason || 'No reason given', expiresAt],
  );
  if (!rows) return null; // DB down/unconfigured — caller must say so in its reply.
  return rows.insertId ?? null;
}

async function getActiveTempbans(guildId) {
  const rows = await db.query(
    "SELECT id, guild_id, user_id, banned_by, reason, banned_at, expires_at FROM temp_bans WHERE guild_id = ? AND unbanned = 0 AND cancelled = 0 AND expires_at > NOW() ORDER BY expires_at ASC",
    [guildId],
  );
  return rows; // null when the DB is down — callers must handle that (see tempban-list).
}

async function getActiveTempban(guildId, userId) {
  const rows = await db.query(
    "SELECT id, guild_id, user_id, banned_by, reason, banned_at, expires_at FROM temp_bans WHERE guild_id = ? AND user_id = ? AND unbanned = 0 AND cancelled = 0 AND expires_at > NOW() ORDER BY expires_at ASC LIMIT 1",
    [guildId, userId],
  );
  return rows?.[0] || null;
}

async function cancelTempban(guildId, userId) {
  const res = await db.query(
    'UPDATE temp_bans SET cancelled = 1, unbanned = 1, unbanned_at = NOW() WHERE guild_id = ? AND user_id = ? AND unbanned = 0 AND cancelled = 0',
    [guildId, userId],
  );
  if (!res) return false;
  return (res.affectedRows ?? 0) > 0;
}

async function markUnbanned(id) {
  await db.query('UPDATE temp_bans SET unbanned = 1, unbanned_at = NOW() WHERE id = ?', [id]);
}

// Unban every expired tempban. Only unbans a user who is still actually
// banned (a manual unban first means there is nothing to do — the row is
// still marked done so it is not retried forever). Returns the number of
// users unbanned. Failures are logged, never thrown.
async function processExpiredTempbans(client) {
  if (!db.isEnabled()) return 0;
  const rows = await db.query(
    'SELECT id, guild_id, user_id, expires_at FROM temp_bans WHERE unbanned = 0 AND cancelled = 0 AND expires_at <= NOW() ORDER BY expires_at ASC',
  );
  if (!rows?.length) return 0;
  let unbanned = 0;
  for (const row of rows) {
    try {
      const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
      if (!guild) {
        await logWarn('Tempban expiry skipped: guild not found', { guildId: row.guild_id, userId: row.user_id, tempbanId: row.id });
        continue;
      }
      // Guard: only unban if still banned.
      const ban = await guild.bans.fetch(row.user_id).catch(() => null);
      if (ban) {
        await guild.members.unban(row.user_id, 'Tempban expired');
        unbanned += 1;
      }
      await markUnbanned(row.id);
    } catch (err) {
      await logError('Tempban expiry failed', { guildId: row.guild_id, userId: row.user_id, tempbanId: row.id, error: err });
    }
  }
  return unbanned;
}

let started = false;

function startTempbanTimer(client) {
  if (started) return;
  started = true;
  // Run once at startup (catches bans that expired while the bot was down),
  // then every 5 minutes.
  processExpiredTempbans(client).catch(() => {});
  setInterval(() => processExpiredTempbans(client).catch(() => {}), CHECK_INTERVAL_MS);
}

module.exports = {
  CHECK_INTERVAL_MS,
  parseDuration,
  getExpiry,
  recordTempban,
  getActiveTempbans,
  getActiveTempban,
  cancelTempban,
  markUnbanned,
  processExpiredTempbans,
  startTempbanTimer,
};

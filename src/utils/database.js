// MySQL logging + stats (mysql2/promise connection pool).
// GRACEFUL FALLBACK: if the database section in config.json is still a
// placeholder, or MySQL is unreachable, the bot keeps running — every
// helper below becomes a no-op and logs a warning once. Commands still work.
const mysql = require('mysql2/promise');
const config = require('./config');

let pool = null;
let enabled = false;
let warned = false;

function dbConfigured() {
  const db = config.database || {};
  return db.host && db.user && db.database
    && db.password && db.password !== 'YOUR_MYSQL_PASSWORD_HERE';
}

async function initDatabase() {
  if (!dbConfigured()) {
    console.warn('[db] Database not configured in config.json — running without MySQL logging/stats.');
    return false;
  }
  const db = config.database;
  try {
    pool = mysql.createPool({
      host: db.host,
      port: db.port || 3306,
      user: db.user,
      password: db.password,
      database: db.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    enabled = true;
    console.log('[db] Connected to MySQL.');
    return true;
  } catch (err) {
    console.warn('[db] Could not connect to MySQL — continuing without database logging:', err.message);
    pool = null;
    enabled = false;
    return false;
  }
}

function isEnabled() { return enabled; }

async function query(sql, params = []) {
  if (!enabled || !pool) return null;
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    if (!warned) { console.warn('[db] Query failed (logging skipped from here on):', err.message); warned = true; }
    return null;
  }
}

// --- Command logging + counters -------------------------------------------------

async function logCommand({ guildId, userId, username, commandName, channelId, success, errorMessage }) {
  if (!enabled) return;
  await query(
    'INSERT INTO command_logs (guild_id, user_id, username, command_name, channel_id, success, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [guildId || null, userId, username || null, commandName, channelId || null, success ? 1 : 0, errorMessage || null],
  );
  // Counters: one upsert per guild + per user.
  await query(
    'INSERT INTO guild_stats (guild_id, commands_used) VALUES (?, 1) ON DUPLICATE KEY UPDATE commands_used = commands_used + 1, updated_at = CURRENT_TIMESTAMP',
    [guildId || 'DM'],
  );
  await query(
    'INSERT INTO user_stats (user_id, guild_id, commands_used, last_seen) VALUES (?, ?, 1, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE commands_used = commands_used + 1, last_seen = CURRENT_TIMESTAMP',
    [userId, guildId || 'DM'],
  );
}

async function incrementSongsPlayed(guildId) {
  if (!enabled) return;
  await query(
    'INSERT INTO guild_stats (guild_id, songs_played) VALUES (?, 1) ON DUPLICATE KEY UPDATE songs_played = songs_played + 1, updated_at = CURRENT_TIMESTAMP',
    [guildId],
  );
}

async function incrementMembersJoined(guildId) {
  if (!enabled) return;
  await query(
    'INSERT INTO guild_stats (guild_id, members_joined) VALUES (?, 1) ON DUPLICATE KEY UPDATE members_joined = members_joined + 1, updated_at = CURRENT_TIMESTAMP',
    [guildId],
  );
}

async function incrementWarns(guildId, userId) {
  if (!enabled) return;
  await query(
    'INSERT INTO user_stats (user_id, guild_id, warns) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE warns = warns + 1',
    [userId, guildId],
  );
}

// --- Reads ----------------------------------------------------------------------

async function getGlobalStats() {
  if (!enabled) return null;
  const totals = await query('SELECT COUNT(*) AS total_commands, SUM(success) AS successes FROM command_logs');
  const top = await query('SELECT command_name, COUNT(*) AS uses FROM command_logs GROUP BY command_name ORDER BY uses DESC LIMIT 10');
  const songs = await query('SELECT COALESCE(SUM(songs_played), 0) AS songs FROM guild_stats');
  const guilds = await query('SELECT COUNT(*) AS guilds FROM guild_stats');
  const users = await query('SELECT COUNT(*) AS users FROM user_stats');
  return {
    totalCommands: totals?.[0]?.total_commands || 0,
    successes: totals?.[0]?.successes || 0,
    songsPlayed: songs?.[0]?.songs || 0,
    guilds: guilds?.[0]?.guilds || 0,
    users: users?.[0]?.users || 0,
    topCommands: top || [],
  };
}

async function getGuildStats(guildId) {
  if (!enabled) return null;
  const rows = await query('SELECT commands_used, songs_played, members_joined FROM guild_stats WHERE guild_id = ?', [guildId]);
  const warns = await query('SELECT COUNT(*) AS warns FROM warns WHERE guild_id = ?', [guildId]);
  return {
    commandsUsed: rows?.[0]?.commands_used || 0,
    songsPlayed: rows?.[0]?.songs_played || 0,
    membersJoined: rows?.[0]?.members_joined || 0,
    warns: warns?.[0]?.warns || 0,
  };
}

async function getUserStats(userId, guildId) {
  if (!enabled) return null;
  const rows = await query('SELECT commands_used, warns, last_seen FROM user_stats WHERE user_id = ? AND guild_id = ?', [userId, guildId]);
  return rows?.[0] || { commands_used: 0, warns: 0, last_seen: null };
}

async function getTopCommands(guildId, limit = 10) {
  if (!enabled) return null;
  return query(
    'SELECT command_name, COUNT(*) AS uses FROM command_logs WHERE guild_id = ? GROUP BY command_name ORDER BY uses DESC LIMIT ?',
    [guildId, limit],
  );
}

async function getTopUsers(guildId, limit = 10) {
  if (!enabled) return null;
  return query(
    'SELECT user_id, username, COUNT(*) AS uses FROM command_logs WHERE guild_id = ? GROUP BY user_id, username ORDER BY uses DESC LIMIT ?',
    [guildId, limit],
  );
}

async function closePool() {
  if (pool) { try { await pool.end(); } catch {} pool = null; enabled = false; }
}

module.exports = {
  initDatabase, isEnabled, query, logCommand,
  incrementSongsPlayed, incrementMembersJoined, incrementWarns,
  getGlobalStats, getGuildStats, getUserStats, getTopCommands, getTopUsers,
  closePool,
};

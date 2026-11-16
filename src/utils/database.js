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
    // Self-heal schema drift: CREATE TABLE IF NOT EXISTS never adds columns
    // to tables that already exist, and older ALTER notes in sql/schema.sql
    // were only comments — so an existing DB can be missing columns the code
    // already queries (e.g. user_levels.messages). Add any that are absent.
    // A failure here only warns; the bot keeps running without the column.
    await runMigrations(db.database).catch((err) => console.warn('[db] Migration check failed (continuing):', err.message));
    return true;
  } catch (err) {
    console.warn('[db] Could not connect to MySQL — continuing without database logging:', err.message);
    pool = null;
    enabled = false;
    return false;
  }
}

// Columns that were added by ALTER notes but never made it into the CREATE
// TABLE statements — fresh installs get them from the CREATE now, existing
// installs get them here. [table, column, definition]
const MISSING_COLUMNS = [
  ['user_levels', 'messages', 'INT UNSIGNED NOT NULL DEFAULT 0'],
  ['user_levels', 'prestige', 'INT UNSIGNED NOT NULL DEFAULT 0'],
  ['tickets', 'panel_id', 'BIGINT UNSIGNED NULL'],
  ['giveaways', 'bonus_role_id', 'VARCHAR(32) NULL'],
  ['giveaways', 'bonus_entries', 'INT NULL'],
  ['polls', 'final_counts', 'JSON NULL'],
  ['guild_settings', 'ticket_button_label', 'VARCHAR(80) NULL'],
];

// The autoresponders table failed to create on installs whose wizard ran
// before the `trigger` reserved-word fix (1.14.12) — recreate if absent.
const AUTORESPONDERS_CREATE = `CREATE TABLE IF NOT EXISTS autoresponders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  \`trigger\` VARCHAR(128) NOT NULL,
  response VARCHAR(2000) NOT NULL,
  match_type ENUM('contains','exact') NOT NULL DEFAULT 'contains',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_autoresponder (guild_id, \`trigger\`),
  INDEX idx_autoresponders_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

// The sticky_messages table (1.15.15) — same self-heal as autoresponders:
// CREATE TABLE IF NOT EXISTS in sql/schema.sql only runs on fresh installs
// (the wizard), so existing installs get the table here on startup.
const STICKY_MESSAGES_CREATE = `CREATE TABLE IF NOT EXISTS sticky_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(32) NULL,
  content VARCHAR(2000) NOT NULL,
  created_by VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sticky_channel (guild_id, channel_id),
  INDEX idx_sticky_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function runMigrations(dbName) {
  if (!pool) return;
  for (const [table, column, definition] of MISSING_COLUMNS) {
    try {
      const [rows] = await pool.execute(
        'SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [dbName, table, column],
      );
      if (rows[0]?.n === 0) {
        await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        console.log(`[db] Migration: added missing column ${table}.${column}.`);
      }
    } catch (err) {
      // Table itself may not exist (e.g. premium tables) — not an error.
      console.warn(`[db] Migration: could not check/add ${table}.${column}:`, err.message);
    }
  }
  try {
    await pool.execute(AUTORESPONDERS_CREATE);
  } catch (err) {
    console.warn('[db] Migration: could not ensure autoresponders table:', err.message);
  }
  try {
    await pool.execute(STICKY_MESSAGES_CREATE);
  } catch (err) {
    console.warn('[db] Migration: could not ensure sticky_messages table:', err.message);
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

// Run fn inside a real MySQL transaction: fn receives a query(sql, params)
// bound to one pooled connection. Commit on success, rollback on any
// error (rethrown). Used for atomic swaps (trades) so a failed trade can
// never duplicate items or coins. Returns fn's return value, or null if
// the DB is unavailable.
async function withTransaction(fn) {
  if (!enabled || !pool) return null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const txQuery = async (sql, params = []) => {
      const [rows] = await conn.execute(sql, params);
      return rows;
    };
    const result = await fn(txQuery);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  initDatabase, isEnabled, query, logCommand, withTransaction,
  incrementSongsPlayed, incrementMembersJoined, incrementWarns,
  getGlobalStats, getGuildStats, getUserStats, getTopCommands, getTopUsers,
  closePool,
};

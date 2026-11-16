// Central error logging. EVERY error/warn the bot handles is written to the
// MySQL error_logs table — no sampling, no dropping. If the DB is down, the
// entry is ALSO written to logs/bot-errors.log (JSON lines, survives DB
// outages) AND queued in memory for backfill: the queue is retried every
// 60s and after every successful insert, so nothing is lost.
// Secrets are redacted before storage or file write, in two layers:
//  1. `redact()` on the `context` object: any field whose name matches
//     token/password/secret/key/api key/auth is replaced with [REDACTED].
//  2. `scrubText()` on `message` and `stack` (free text, where a field-name
//     check cannot help): every configured secret VALUE is replaced, plus
//     common secret shapes (Discord bot tokens, Authorization headers,
//     key=value pairs, OpenAI-style keys). The configured values are only
//     ever used as match strings — they are never logged or written out.
const fs = require('fs');
const path = require('path');
const db = require('./database');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bot-errors.log');
// Purge marker: when the dashboard purges the error logs, it stamps this
// file with the purge instant (epoch ms). The bot and the dashboard run as
// SEPARATE processes with separate in-memory retry queues, so a dashboard
// purge cannot clear the bot's queue directly — instead flushQueue() drops
// any queued entry logged before the marker instead of re-inserting it, so
// a purge-all can never be undone by a queued backfill. Entries logged
// after the purge are unaffected.
const PURGE_MARKER_FILE = path.join(LOG_DIR, '.error-logs-purged-at');
const REDACT_KEYS = /token|password|passwd|secret|api[-_]?key|apikey|auth|credential|private[-_]?key/i;
const MAX_QUEUE = 500;
// Paths (from the project root) of every secret the config holds. Read
// lazily at log time so tests can inject fake values via the config object.
// Values shorter than 8 chars are skipped: scrubbing a tiny string would
// mangle unrelated text, and real secrets are never that short.
const SECRET_VALUE_PATHS = [
  ['token'], // Discord bot token
  ['dashboard', 'clientSecret'], // Discord OAuth client secret
  ['dashboard', 'sessionSecret'], // dashboard session signing secret
  ['database', 'password'], // MySQL password
  ['streams', 'twitch', 'clientSecret'], // Twitch client secret
  ['streams', 'youtube', 'apiKey'], // YouTube Data API key
  ['steam', 'apiKey'], // Steam Web API key
  ['ai', 'apiKey'], // OpenAI-compatible API key
];
// Secret shapes that can appear in free text even when the exact value is
// unknown (e.g. a token from another source, or a header in an HTTP error).
// Kept tight on purpose: YouTube URLs, Discord snowflake IDs, usernames,
// channel names and ordinary prose must survive unchanged.
const SECRET_TEXT_PATTERNS = [
  // Discord bot token: 24 chars . 6 chars . 27+ chars.
  { re: /[\w-]{24}\.[\w-]{6}\.[\w-]{27,}/g, replacement: '[REDACTED]' },
  // Authorization: Bearer/Basic <credentials>
  { re: /Authorization:\s*(Bearer|Basic)\s+[^\s'"]+/gi, replacement: 'Authorization: $1 [REDACTED]' },
  // OpenAI-style API key: sk-... / sk-proj-...
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED]' },
  // key=value / key: value pairs (query params, JSON, headers, prose):
  // token=..., access_token=..., api_key=..., "client_secret": "...",
  // password: ... — the value runs to the next delimiter, never past it.
  // The word "token" in ordinary prose ("invalid token type") has no
  // = or : after it, so it is left alone.
  { re: /\b(access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|client[_-]?secret|session[_-]?secret|password|passwd|token|secret)(["']?\s*(?:[:=]|%3D|%3A)\s*["']?)([^\s&"'<>,}\]; )]+)/gi, replacement: '$1$2[REDACTED]' },
];

function secretValues() {
  let cfg;
  try { cfg = require('./config'); } catch { return []; }
  const out = [];
  for (const p of SECRET_VALUE_PATHS) {
    let v = cfg;
    for (const k of p) v = v?.[k];
    if (typeof v === 'string' && v.length >= 8) out.push(v);
  }
  return out;
}

// Scrub a free-text string (message or stack) of any secret it contains:
// first every configured secret value (exact match, via split/join so
// regex-special characters in the value cannot break the match), then the
// secret-shape patterns above. Non-string input is returned as-is.
function scrubText(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const secret of secretValues()) {
    if (out.includes(secret)) out = out.split(secret).join('[REDACTED]');
  }
  for (const { re, replacement } of SECRET_TEXT_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

let currentShardId = null;
const retryQueue = []; // entries awaiting DB backfill

function setShardId(id) { currentShardId = id; }

function redact(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && REDACT_KEYS.test(value) && value.length > 40) return '[REDACTED]';
  return value;
}

function writeFile(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

async function insertDb(entry) {
  await db.query(
    'INSERT INTO error_logs (level, shard_id, guild_id, command_name, user_id, message, stack, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [entry.level, entry.shard_id, entry.guild_id, entry.command_name, entry.user_id,
     entry.message, entry.stack, entry.context ? JSON.stringify(entry.context) : null],
  );
}

function readPurgeMarkerMs() {
  try {
    const v = parseInt(fs.readFileSync(PURGE_MARKER_FILE, 'utf8').trim(), 10);
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

function truncateLogFile() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LOG_FILE, '');
    return true;
  } catch { return false; }
}

async function flushQueue() {
  if (!db.isEnabled() || !retryQueue.length) return;
  // Drop entries queued before the last purge-all: the purge already
  // removed their DB counterparts (or they never landed), so re-inserting
  // them would resurrect purged logs. Entries logged after the purge are
  // kept. An unparseable timestamp is kept too (fail-safe: never drop an
  // entry we cannot date).
  const purgedAt = readPurgeMarkerMs();
  if (purgedAt) {
    for (let i = retryQueue.length - 1; i >= 0; i--) {
      const t = Date.parse(retryQueue[i]?.created_at || '');
      if (Number.isFinite(t) && t <= purgedAt) retryQueue.splice(i, 1);
    }
    if (!retryQueue.length) return;
  }
  const pending = retryQueue.splice(0, retryQueue.length);
  for (const entry of pending) {
    try { await insertDb(entry); }
    catch { retryQueue.push(entry); break; }
  }
}

setInterval(() => flushQueue().catch(() => {}), 60_000).unref?.();

// Purge error logs. Shared by the dashboard purge route (and reusable by a
// future slash command) so both processes purge the same way.
// - ids omitted -> purge ALL: delete every row from error_logs, truncate
//   logs/bot-errors.log, clear this process's retry queue, and stamp the
//   purge marker so the OTHER process (bot vs dashboard) drops queued
//   entries predating the purge instead of re-inserting them.
// - ids non-empty array -> delete ONLY those rows from error_logs. The log
//   file is append-only JSON lines with no per-row id to match against, so
//   per-row file removal would be guesswork: the file is left untouched and
//   no marker is written (queued entries that later land are new rows, not
//   rows the user selected).
// - ids an array with no valid ids -> throws (an empty/invalid list must
//   never silently become a purge-all).
// Returns { deleted, fileCleared, dbAvailable, mode }.
// Throws if the DB is reachable but the DELETE fails — the file is only
// touched after a successful DELETE, so a failed purge is all-or-nothing.
async function purgeErrorLogs(ids) {
  const idsProvided = Array.isArray(ids);
  const selected = idsProvided
    ? [...new Set(ids.map((v) => parseInt(v, 10)).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  if (idsProvided && selected.length === 0) throw new Error('No valid error log ids provided.');
  const purgeAll = !idsProvided;
  let deleted = 0;
  const dbAvailable = db.isEnabled();
  if (dbAvailable) {
    const res = purgeAll
      ? await db.query('DELETE FROM error_logs')
      : await db.query(`DELETE FROM error_logs WHERE id IN (${selected.map(() => '?').join(',')})`, selected);
    // db.query returns null when the query throws (see src/utils/database.js).
    if (res === null) throw new Error('Database query failed — error logs were not purged.');
    deleted = res.affectedRows ?? 0;
  }
  let fileCleared = false;
  if (purgeAll) {
    fileCleared = truncateLogFile();
    retryQueue.length = 0;
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(PURGE_MARKER_FILE, String(Date.now()));
    } catch {}
  }
  return { deleted, fileCleared, dbAvailable, mode: purgeAll ? 'all' : 'selected' };
}

async function log({ level = 'error', shardId, guildId, commandName, userId, message, stack, context, error } = {}) {
  if (error instanceof Error) {
    message = message || error.message;
    stack = stack || error.stack;
  }
  const entry = {
    level: ['error', 'warn', 'info'].includes(level) ? level : 'error',
    shard_id: shardId ?? currentShardId,
    guild_id: guildId || null,
    command_name: commandName || null,
    user_id: userId || null,
    message: scrubText(String(message || 'Unknown error')).slice(0, 4000),
    stack: stack ? scrubText(String(stack)).slice(0, 8000) : null,
    context: context ? redact(context) : null,
    created_at: new Date().toISOString(),
  };
  writeFile(entry);
  if (db.isEnabled()) {
    try {
      await insertDb(entry);
      if (retryQueue.length) await flushQueue();
    } catch {
      if (retryQueue.length < MAX_QUEUE) retryQueue.push(entry);
    }
  } else if (retryQueue.length < MAX_QUEUE) {
    retryQueue.push(entry);
  }
  if (level === 'error') console.error(`[${entry.created_at}] ERROR ${entry.command_name ? `/${entry.command_name} ` : ''}${entry.message}`);
  else if (level === 'warn') console.warn(`[${entry.created_at}] WARN ${entry.message}`);
  return entry;
}

function logError(message, context) { return log({ level: 'error', message, context }); }
function logWarn(message, context) { return log({ level: 'warn', message, context }); }
function logInfo(message, context) { return log({ level: 'info', message, context }); }

module.exports = { log, logError, logWarn, logInfo, setShardId, flushQueue, retryQueue, purgeErrorLogs, scrubText };

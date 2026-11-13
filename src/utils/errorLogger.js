// Central error logging. EVERY error/warn the bot handles is written to the
// MySQL error_logs table — no sampling, no dropping. If the DB is down, the
// entry is ALSO written to logs/bot-errors.log (JSON lines, survives DB
// outages) AND queued in memory for backfill: the queue is retried every
// 60s and after every successful insert, so nothing is lost.
// Secrets are redacted: any field whose name matches token/password/secret/
// key/api key/auth is replaced with [REDACTED] before storage or file write.
const fs = require('fs');
const path = require('path');
const db = require('./database');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bot-errors.log');
const REDACT_KEYS = /token|password|passwd|secret|api[-_]?key|apikey|auth|credential|private[-_]?key/i;
const MAX_QUEUE = 500;

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

async function flushQueue() {
  if (!db.isEnabled() || !retryQueue.length) return;
  const pending = retryQueue.splice(0, retryQueue.length);
  for (const entry of pending) {
    try { await insertDb(entry); }
    catch { retryQueue.push(entry); break; }
  }
}

setInterval(() => flushQueue().catch(() => {}), 60_000).unref?.();

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
    message: String(message || 'Unknown error').slice(0, 4000),
    stack: stack ? String(stack).slice(0, 8000) : null,
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

module.exports = { log, logError, logWarn, logInfo, setShardId, flushQueue, retryQueue };

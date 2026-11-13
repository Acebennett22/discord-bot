// Simple JSON-backed warn store: { "<guildId>:<userId>": [ { reason, moderator, date } ] }.
// Stored in src/data/warns.json. No database needed for a small bot.
const fs = require('fs');
const path = require('path');

const warnsPath = path.join(__dirname, '..', 'data', 'warns.json');

function readWarns() {
  try {
    if (!fs.existsSync(warnsPath)) return {};
    return JSON.parse(fs.readFileSync(warnsPath, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeWarns(data) {
  fs.mkdirSync(path.dirname(warnsPath), { recursive: true });
  fs.writeFileSync(warnsPath, JSON.stringify(data, null, 2));
}

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function addWarn(guildId, userId, { reason, moderator }) {
  const data = readWarns();
  const k = key(guildId, userId);
  data[k] = data[k] || [];
  data[k].push({ reason, moderator, date: new Date().toISOString() });
  writeWarns(data);
  // Mirror to MySQL when available (JSON file stays the primary store, so
  // warns still work with no DB). Fire-and-forget — never blocks the command.
  try {
    const db = require('./database');
    db.query(
      'INSERT INTO warns (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
      [guildId, userId, null, reason],
    );
    db.incrementWarns(guildId, userId);
  } catch {}
  return data[k];
}

function getWarns(guildId, userId) {
  return readWarns()[key(guildId, userId)] || [];
}

function clearWarns(guildId, userId) {
  const data = readWarns();
  const k = key(guildId, userId);
  const count = (data[k] || []).length;
  delete data[k];
  writeWarns(data);
  return count;
}

module.exports = { addWarn, getWarns, clearWarns };

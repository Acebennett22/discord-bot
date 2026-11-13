// Custom commands: per-guild trigger word -> response, stored in MySQL.
// Looked up by the messageCreate handler in src/events/customCommands.js.
const db = require('./database');

async function findCustomCommand(guildId, trigger) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM custom_commands WHERE guild_id = ? AND trigger_word = ?', [guildId, trigger.toLowerCase()]);
  return rows?.[0] || null;
}

async function incrementUse(guildId, trigger) {
  await db.query('UPDATE custom_commands SET use_count = use_count + 1 WHERE guild_id = ? AND trigger_word = ?', [guildId, trigger.toLowerCase()]);
}

// @everyone / @here pings in a custom response are stripped — a custom
// command must never be able to mass-ping a server.
function sanitizeResponse(text) {
  return String(text).replace(/@everyone/g, '@\u200beveryone').replace(/@here/g, '@\u200bhere');
}

module.exports = { findCustomCommand, incrementUse, sanitizeResponse };

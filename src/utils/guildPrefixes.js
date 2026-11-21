// Per-guild command prefix (1.16.8): config for later, stored in
// guild_settings.prefix (NULL = no prefix configured). The bot loads every
// guild's prefix into memory at startup (ready.js). Slash commands are
// unchanged and the bot does not respond to prefix commands yet — the
// setting only keeps the option open. The dashboard is the only place it
// can be changed (Bot Identity tab), and a dashboard edit takes effect on
// the next bot restart (the dashboard is a separate process, so it cannot
// touch this map directly).
const db = require('./database');

const prefixes = new Map(); // guildId -> prefix string

async function loadGuildPrefixes() {
  prefixes.clear();
  if (!db.isEnabled()) return 0;
  const rows = await db.query(
    'SELECT guild_id, prefix FROM guild_settings WHERE prefix IS NOT NULL AND prefix <> ?',
    [''],
  );
  for (const r of rows || []) prefixes.set(r.guild_id, r.prefix);
  return prefixes.size;
}

function getPrefix(guildId) {
  return prefixes.get(guildId) || null;
}

function setPrefixCached(guildId, prefix) {
  if (prefix) prefixes.set(guildId, prefix);
  else prefixes.delete(guildId);
}

module.exports = { loadGuildPrefixes, getPrefix, setPrefixCached };

// FAQ auto-responder: per-guild trigger phrase -> response.
// Cached per guild (60s TTL) so every chat message doesn't hit MySQL.
const db = require('./database');
const { sanitizeResponse } = require('./customCommands');

const cache = new Map(); // guildId -> { rows, at }
const CACHE_TTL_MS = 60_000;

async function getFaqs(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;
  let rows = [];
  if (db.isEnabled()) {
    rows = await db.query('SELECT id, trigger_phrase, response, match_type, use_count FROM faq_responses WHERE guild_id = ? ORDER BY created_at ASC', [guildId]) || [];
  }
  cache.set(guildId, { rows, at: Date.now() });
  return rows;
}

function invalidateFaqs(guildId) { cache.delete(guildId); }

// First matching FAQ for a message, or null. Exact matches beat contains
// matches only by creation order — first match in created_at order wins.
function matchFaq(rows, content) {
  const text = content.trim().toLowerCase();
  if (!text) return null;
  for (const row of rows) {
    const trigger = (row.trigger_phrase || '').trim().toLowerCase();
    if (!trigger) continue;
    if (row.match_type === 'exact' && text === trigger) return row;
    if (row.match_type === 'contains' && text.includes(trigger)) return row;
  }
  return null;
}

async function incrementFaqUse(id) {
  await db.query('UPDATE faq_responses SET use_count = use_count + 1 WHERE id = ?', [id]);
}

module.exports = { getFaqs, invalidateFaqs, matchFaq, incrementFaqUse, sanitizeResponse };

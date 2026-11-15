// Resolve Discord user IDs to "Name (id)" labels for dashboard staff rows.
// The dashboard runs as a separate process with no discord.js client, so
// names come from the bot REST API (GET /users/{id}) — the same pattern
// botGuilds() in dashboard.js uses. Lookups are de-duplicated per call so
// the same ID is never fetched twice for one page render.
const axios = require('axios');
const config = require('./config');

const discordApi = axios.create({ baseURL: 'https://discord.com/api/v10', timeout: 10_000 });

async function fetchUser(id) {
  try {
    const res = await discordApi.get(`/users/${id}`, { headers: { Authorization: `Bot ${config.token}` } });
    return res.data || null;
  } catch { return null; }
}

function displayName(user) {
  if (!user) return null;
  return user.global_name || user.username || null;
}

// ids: array of Discord user IDs (nulls/empties ignored).
// Returns a Map of String(id) -> "Name (id)", or "id (unknown user)" when
// the user cannot be resolved (left Discord, fetch failed, bad token).
// fetchUserFn is injectable for tests; defaults to the REST lookup.
async function resolveUserLabels(ids, fetchUserFn = fetchUser) {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  const out = new Map();
  await Promise.all(unique.map(async (id) => {
    let user = null;
    try { user = await fetchUserFn(id); } catch { user = null; }
    const name = displayName(user);
    out.set(id, name ? `${name} (${id})` : `${id} (unknown user)`);
  }));
  return out;
}

module.exports = { resolveUserLabels, fetchUser, displayName };

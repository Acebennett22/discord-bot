// Steam Web API integration. Needs steam.apiKey in config.json
// (get one at https://steamcommunity.com/dev/apikey — free).
// Without a key, commands reply that Steam isn't configured.
const config = require('./config');
const db = require('./database');

function apiKey() {
  const key = config.steam?.apiKey;
  return key && !key.includes('YOUR_') ? key : null;
}

async function resolveVanity(vanity) {
  const key = apiKey();
  if (!key) return null;
  const res = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${key}&vanityurl=${encodeURIComponent(vanity)}`);
  const json = await res.json();
  return json.response?.success === 1 ? json.response.steamid : null;
}

async function resolveSteamId(input) {
  const trimmed = String(input).trim();
  if (/^\d{17}$/.test(trimmed)) return trimmed; // 64-bit SteamID
  // Vanity name or profile URL.
  const vanity = trimmed.replace(/^https?:\/\/(www\.)?steamcommunity\.com\/(id|profiles)\//, '').replace(/\/.*$/, '');
  return resolveVanity(vanity);
}

async function getPlayerSummary(steamId) {
  const key = apiKey();
  if (!key) return null;
  const res = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${key}&steamids=${steamId}`);
  const json = await res.json();
  return json.response?.players?.[0] || null;
}

async function linkSteam(userId, steamId) {
  if (!db.isEnabled()) return false;
  await db.query(
    "INSERT INTO user_links (user_id, platform, external_id) VALUES (?, 'steam', ?) ON DUPLICATE KEY UPDATE external_id = VALUES(external_id)",
    [userId, steamId],
  );
  return true;
}

async function getLinkedSteamId(userId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query("SELECT external_id FROM user_links WHERE user_id = ? AND platform = 'steam'", [userId]);
  return rows?.[0]?.external_id || null;
}

module.exports = { apiKey, resolveSteamId, resolveVanity, getPlayerSummary, linkSteam, getLinkedSteamId };

// Bot presence / activity rotation. The bot's Discord status shows live
// stats: templates with {guilds}, {users}, {commands}, {uptime}, {version}.
// Global for the bot (NOT per-server). Rotation runs per shard — each shard
// sets its own presence from the same templates, with global counts
// gathered via broadcastEval when sharded.
// Templates live in config.json `presence.activities` (strings default to
// Watching, or {text, type} objects). The dashboard Staff area edits that
// list; the bot re-reads config.json from disk on every rotation tick so
// dashboard edits take effect without a restart.
// Current activity is written to the `presence_state` table (best effort)
// so the standalone dashboard process can show it.
const { ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const config = require('./config');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');
const PKG_PATH = path.join(__dirname, '..', '..', 'package.json');

const ACTIVITY_TYPES = {
  Playing: ActivityType.Playing,
  Watching: ActivityType.Watching,
  Listening: ActivityType.Listening,
  Competing: ActivityType.Competing,
};

const DEFAULT_ACTIVITIES = [
  'Watching {guilds} servers',
  'Listening to /help',
  'Playing with {users} users',
  'Watching {commands} commands',
];

let currentIndex = 0;
let override = null; // { text, type } — one-off until next rotation or reset
let timer = null;
let started = false;
let lastRotateRequestSeen = null;

function getVersion() {
  try { return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version || '1.0.0'; } catch { return '1.0.0'; }
}

function normalizeActivities(raw) {
  const list = Array.isArray(raw) && raw.length ? raw : DEFAULT_ACTIVITIES;
  return list.map((entry) => {
    if (typeof entry === 'string') return { text: entry, type: 'Watching' };
    if (entry && typeof entry.text === 'string') {
      return { text: entry.text, type: ACTIVITY_TYPES[entry.type] ? entry.type : 'Watching' };
    }
    return null;
  }).filter(Boolean);
}

function loadActivities() {
  // Re-read config.json from disk so dashboard edits apply without restart.
  try {
    const onDisk = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (Array.isArray(onDisk.presence?.activities)) return normalizeActivities(onDisk.presence.activities);
  } catch {}
  return normalizeActivities(config.presence?.activities);
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function getStats(client) {
  let guilds = client.guilds.cache.size;
  let users = client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0);
  if (client.shard) {
    try {
      const guildCounts = await client.shard.fetchClientValues('guilds.cache.size');
      guilds = guildCounts.reduce((a, b) => a + b, 0);
    } catch {}
    try {
      const memberCounts = await client.shard.broadcastEval((c) => c.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0));
      users = memberCounts.reduce((a, b) => a + b, 0);
    } catch {}
  }
  return {
    guilds,
    users,
    commands: client.commands?.size ?? 0,
    uptime: formatUptime(client.uptime || 0),
    version: getVersion(),
  };
}

function fillTemplate(text, stats) {
  return String(text)
    .replaceAll('{guilds}', String(stats.guilds))
    .replaceAll('{users}', String(stats.users))
    .replaceAll('{commands}', String(stats.commands))
    .replaceAll('{uptime}', stats.uptime)
    .replaceAll('{version}', stats.version)
    .slice(0, 128);
}

async function applyActivity(client, activity, stats) {
  const text = fillTemplate(activity.text, stats);
  const type = ACTIVITY_TYPES[activity.type] || ActivityType.Watching;
  try {
    await client.user.setActivity(text, { type });
  } catch {}
  // Record it for the dashboard (separate process) — best effort.
  if (db.isEnabled()) {
    await db.query(
      'INSERT INTO presence_state (id, current_text, current_type) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE current_text = VALUES(current_text), current_type = VALUES(current_type), updated_at = NOW()',
      [text, activity.type],
    ).catch(() => {});
  }
  return { text, type: activity.type };
}

async function rotateOnce(client) {
  const activities = loadActivities();
  if (!activities.length) return null;
  const activity = activities[currentIndex % activities.length];
  currentIndex = (currentIndex + 1) % activities.length;
  return applyActivity(client, activity, await getStats(client));
}

async function tick(client) {
  if (override) return; // one-off override holds until reset
  // A "rotate now" from the dashboard sets rotate_requested_at in the DB.
  if (db.isEnabled()) {
    try {
      const rows = await db.query('SELECT rotate_requested_at FROM presence_state WHERE id = 1');
      const requested = rows?.[0]?.rotate_requested_at;
      if (requested && String(requested) !== String(lastRotateRequestSeen)) {
        lastRotateRequestSeen = requested;
        await rotateOnce(client);
        return;
      }
    } catch {}
  }
  await rotateOnce(client);
}

function startPresence(client) {
  if (started) return;
  started = true;
  const seconds = Math.max(10, config.presence?.rotateSeconds ?? 60);
  tick(client).catch(() => {});
  timer = setInterval(() => tick(client).catch(() => {}), seconds * 1000);
  timer.unref?.();
}

function setOverride(client, text, type) {
  override = { text: text.slice(0, 128), type: ACTIVITY_TYPES[type] ? type : 'Watching' };
  return getStats(client).then((stats) => applyActivity(client, override, stats));
}

async function clearOverride(client) {
  override = null;
  return rotateOnce(client);
}

async function getCurrent(client) {
  if (override) {
    const stats = await getStats(client);
    return { text: fillTemplate(override.text, stats), type: override.type, override: true };
  }
  const activities = loadActivities();
  const next = activities[(currentIndex - 1 + activities.length) % activities.length];
  if (!next) return null;
  const stats = await getStats(client);
  return { text: fillTemplate(next.text, stats), type: next.type, override: false, templates: activities };
}

module.exports = {
  ACTIVITY_TYPES, DEFAULT_ACTIVITIES, normalizeActivities, loadActivities,
  fillTemplate, getStats, getVersion, applyActivity, rotateOnce, startPresence,
  setOverride, clearOverride, getCurrent,
};

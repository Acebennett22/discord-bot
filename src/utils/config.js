// Single source of configuration: config.json at the project root.
// Validates required fields and exits with a clear error if placeholders remain.
// NEVER put a real token in config.example.json or commit config.json.
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', '..', 'config.json');

if (!fs.existsSync(configPath)) {
  console.error('[config] config.json not found at the project root.');
  console.error('[config] Copy config.example.json to config.json and fill in your token and clientId.');
  process.exit(1);
}

const config = require(configPath);

const PLACEHOLDERS = new Set([
  '',
  'YOUR_DISCORD_BOT_TOKEN_HERE',
  'YOUR_CLIENT_ID_HERE',
  'YOUR_TOKEN_HERE',
  'YOUR_CLIENT_ID',
]);

function isPlaceholder(value) {
  return typeof value !== 'string' || PLACEHOLDERS.has(value.trim());
}

// The dashboard sets ALLOW_PLACEHOLDER_CONFIG=1 when it runs the first-run
// setup wizard (no valid token exists yet) — warn instead of exiting.
// The bot itself (index.js / shardManager.js) never sets this, so it still
// refuses to start with placeholders.
const SETUP_MODE = process.env.ALLOW_PLACEHOLDER_CONFIG === '1';

if (isPlaceholder(config.token)) {
  if (SETUP_MODE) {
    console.warn('[config] token in config.json is still a placeholder — setup wizard mode (dashboard only).');
  } else {
    console.error('[config] token in config.json is still a placeholder.');
    console.error('[config] Paste your bot token from the Discord Developer Portal into config.json (never share it).');
    process.exit(1);
  }
}

if (isPlaceholder(config.clientId)) {
  if (SETUP_MODE) {
    console.warn('[config] clientId in config.json is still a placeholder — setup wizard mode (dashboard only).');
  } else {
    console.error('[config] clientId in config.json is still a placeholder.');
    console.error('[config] Paste your application/client ID from the Discord Developer Portal into config.json.');
    process.exit(1);
  }
}

// Sensible defaults so optional fields can be left blank.
config.embedColor = config.embedColor || '#5865F2';
config.music = config.music || {};
config.music.maxQueueSize = config.music.maxQueueSize || 25;
config.database = config.database || {};
config.database.host = config.database.host || 'localhost';
config.database.port = config.database.port || 3306;
config.database.user = config.database.user || '';
config.database.password = config.database.password || '';
config.database.database = config.database.database || '';
config.leveling = config.leveling || {};
config.leveling.xpPerMessageMin = config.leveling.xpPerMessageMin ?? 15;
config.leveling.xpPerMessageMax = config.leveling.xpPerMessageMax ?? 25;
config.leveling.cooldownSeconds = config.leveling.cooldownSeconds || 60;
config.gameServers = config.gameServers || {};
config.gameServers.checkIntervalMinutes = config.gameServers.checkIntervalMinutes || 5;
config.gameServers.custom = config.gameServers.custom || [];
config.economy = config.economy || {};
config.economy.startingBalance = config.economy.startingBalance ?? 100;
config.economy.dailyMin = config.economy.dailyMin ?? 100;
config.economy.dailyMax = config.economy.dailyMax ?? 500;
config.economy.workMin = config.economy.workMin ?? 50;
config.economy.workMax = config.economy.workMax ?? 250;
config.economy.currencyName = config.economy.currencyName || 'coins';
config.economy.currencyEmoji = config.economy.currencyEmoji || '🪙';
config.presence = config.presence || {};
config.presence.rotateSeconds = config.presence.rotateSeconds ?? 60;
config.presence.activities = config.presence.activities || [
  'Watching {guilds} servers',
  'Listening to /help',
  'Playing with {users} users',
  'Watching {commands} commands',
];
config.steam = config.steam || {};
config.staffUserIds = config.staffUserIds || [];
config.dashboard = config.dashboard || {};
config.dashboard.port = config.dashboard.port || 3010;
config.dashboard.redirectUri = config.dashboard.redirectUri || 'http://localhost:3010/callback';
config.dashboard.invitePermissions = config.dashboard.invitePermissions || 1099951041558;
config.streams = config.streams || {};
config.streams.checkIntervalMinutes = config.streams.checkIntervalMinutes || 5;
config.streams.twitch = config.streams.twitch || {};
config.streams.youtube = config.streams.youtube || {};
config.streams.announceOfflineMessage = config.streams.announceOfflineMessage || false;
config.serverStats = config.serverStats || {};
config.serverStats.updateIntervalMinutes = config.serverStats.updateIntervalMinutes || 10;
config.sharding = config.sharding || {};
config.sharding.mode = config.sharding.mode || 'auto';
config.sharding.totalShards = config.sharding.totalShards ?? null;
config.guildId = config.guildId || '';
config.welcomeChannelId = config.welcomeChannelId || '';
config.ownerId = config.ownerId || '';

module.exports = config;

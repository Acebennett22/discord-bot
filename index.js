// IPv4-first DNS (1.15.21): this box has broken IPv6 DNS — `curl -6`
// fails with exit 6 (could not resolve host) while `curl -4` works. Node's
// default DNS order is `verbatim` (OS order), so a Discord voice endpoint
// that resolves IPv6-first hands the voice WebSocket an unreachable IPv6
// address and the join dies (connecting -> signalling, 10s timeout). Forcing
// IPv4-first keeps every lookup on the working stack. Must run before any
// other require that could trigger a DNS lookup.
require('node:dns').setDefaultResultOrder('ipv4first');

// Entry point — Ace's multi-file Discord bot (discord.js v14, CommonJS).
// Config lives in config.json at the project root (see config.example.json).
const { Client, Collection, Events, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./src/utils/config');
const db = require('./src/utils/database');
const { loadCommands } = require('./src/handlers/commandHandler');
const { loadEvents } = require('./src/handlers/eventHandler');
const errorLogger = require('./src/utils/errorLogger');
const { startHealthServer, healthPort } = require('./src/utils/healthServer');

process.on('unhandledRejection', (err) => errorLogger.log({ level: 'error', message: `Unhandled rejection: ${err?.message || err}`, stack: err?.stack, context: { type: 'unhandledRejection' } }));
process.on('uncaughtException', (err) => errorLogger.log({ level: 'error', message: `Uncaught exception: ${err?.message || err}`, stack: err?.stack, context: { type: 'uncaughtException' } }));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
  ],
  // Partials let reaction handlers (starboard, polls) work on messages
  // sent before the bot started / not in cache.
  partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.Channel],
});

client.commands = new Collection();
client.config = config;

loadCommands(client);
loadEvents(client);

// MySQL is optional: initDatabase() warns and returns false if it is
// unconfigured/unreachable — the bot keeps running without logging/stats.
db.initDatabase();

client.once(Events.ClientReady, () => {
  if (client.shard?.ids?.length) errorLogger.setShardId(client.shard.ids[0]);
});

// Health endpoint (1.16.5): localhost-only, so the dashboard status page can
// tell whether the bot is online. Only in the unsharded path — under
// `npm start` the ShardingManager owns the endpoint and each shard worker
// has client.shard set, so workers never try to bind the same port.
if (!client.shard) {
  startHealthServer({
    port: healthPort(config),
    getStatus: () => ({
      shards: [{ id: 0, ready: client.isReady() }],
      guilds: client.guilds.cache.size,
    }),
  });
}

client.login(config.token).catch((err) => {
  errorLogger.log({ level: 'error', message: `Login failed: ${err.message}`, stack: err.stack, context: { type: 'login' } });
  console.error('[login] Failed to log in. Check the token in config.json:', err.message);
  process.exit(1);
});

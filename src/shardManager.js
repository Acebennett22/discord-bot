// Production entry point — spawns index.js as shard workers via ShardingManager.
// Run with: npm start        (sharded)
// Or single-process: npm run start:unsharded
// Shard count comes from config.json `sharding`:
//   mode "auto" (default) — Discord recommends ~1 shard per 1,000 guilds, so the
//   count scales with usage and you don't need to hand-tune it.
//   mode "manual" + totalShards N — use only when you have a specific reason.
const { ShardingManager } = require('discord.js');
const path = require('path');
const config = require('./utils/config');
const errorLogger = require('./utils/errorLogger');
const { startHealthServer, healthPort } = require('./utils/healthServer');

process.on('unhandledRejection', (err) => errorLogger.log({ level: 'error', message: `ShardManager unhandled rejection: ${err?.message || err}`, stack: err?.stack }));
process.on('uncaughtException', (err) => errorLogger.log({ level: 'error', message: `ShardManager uncaught exception: ${err?.message || err}`, stack: err?.stack }));

const sharding = config.sharding || {};
const totalShards = sharding.mode === 'manual' && Number.isInteger(sharding.totalShards) && sharding.totalShards > 0
  ? sharding.totalShards
  : 'auto';

const manager = new ShardingManager(path.join(__dirname, '..', 'index.js'), {
  token: config.token,
  totalShards,
});

manager.on('shardCreate', (shard) => {
  console.log(`[sharding] Launched shard ${shard.id}.`);
  shard.on('ready', () => console.log(`[sharding] Shard ${shard.id} ready.`));
  shard.on('disconnect', () => console.warn(`[sharding] Shard ${shard.id} disconnected.`));
  shard.on('reconnecting', () => console.log(`[sharding] Shard ${shard.id} reconnecting…`));
  shard.on('death', () => console.warn(`[sharding] Shard ${shard.id} died.`));
});

// Health endpoint (1.16.5): localhost-only, so the dashboard status page can
// tell whether the bot is online. Shard readiness comes straight from the
// ShardingManager (synchronous, cheap). The guild total is only attempted
// when every shard is ready — a disconnected shard can't answer anyway —
// and is omitted on any failure or timeout, so the endpoint stays fast.
startHealthServer({
  port: healthPort(config),
  getStatus: async () => {
    const shards = [...manager.shards.values()].map((s) => ({ id: s.id, ready: s.ready === true }));
    let guilds;
    if (shards.length && shards.every((s) => s.ready)) {
      try {
        const sizes = await Promise.race([
          manager.fetchClientValues('guilds.cache.size'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('guild total timeout')), 1000)),
        ]);
        guilds = sizes.reduce((total, n) => total + (Number(n) || 0), 0);
      } catch {
        guilds = undefined;
      }
    }
    return { shards, guilds };
  },
});

manager.spawn({ timeout: 60_000 }).catch((err) => {
  errorLogger.log({ level: 'error', message: `Failed to spawn shards: ${err.message}`, stack: err.stack, context: { type: 'shard.spawn' } });
  console.error('[sharding] Failed to spawn shards:', err.message);
  process.exit(1);
});

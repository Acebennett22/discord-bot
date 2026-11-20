// Tiny localhost-only HTTP health endpoint for the bot process (1.16.5).
// The bot connects outbound to Discord and otherwise listens on no port, so
// the dashboard status page had no way to tell whether the bot is actually
// online — it hardcoded "not connected". This answers that one question:
// "is the bot process up, and are its shards ready?"
// Bound to 127.0.0.1 ONLY — never 0.0.0.0, never exposed through nginx or
// the public dashboard domain. The dashboard fetches it server-side.
// Dependency-free (Node's built-in http). The endpoint answers even while
// Discord is briefly disconnected: readiness is reported per shard, honestly,
// rather than a flat "true".
const http = require('http');
const { version } = require('../../package.json');

const DEFAULT_PORT = 3011;

// Port from config.json `health.port` (default 3011; the dashboard is 3010,
// so there is no clash). Garbage values fall back to the default.
function healthPort(config) {
  const p = Number(config?.health?.port);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}

// getStatus: () => ({ shards: [{ id, ready }], guilds? }) — may be sync or
// async; a slow provider can never hang the endpoint (2s race cap).
// Returns the http.Server. A listen error (e.g. port in use) is logged, never
// thrown, so a health-server failure can never take the bot down with it.
function startHealthServer({ port = DEFAULT_PORT, getStatus }) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    let status = {};
    try {
      const s = await Promise.race([
        Promise.resolve(getStatus ? getStatus() : {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error('health status timeout')), 2000)),
      ]);
      if (s && typeof s === 'object') status = s;
    } catch {
      // A failing status provider still gets a response — the process is up,
      // the shards just can't be confirmed right now.
    }
    const shards = Array.isArray(status.shards)
      ? status.shards.map((s) => ({ id: s?.id, ready: s?.ready === true }))
      : [];
    const payload = {
      online: shards.some((s) => s.ready),
      version,
      uptimeSeconds: Math.floor(process.uptime()),
      shards,
    };
    if (typeof status.guilds === 'number') payload.guilds = status.guilds;
    const body = JSON.stringify(payload);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  });
  server.on('error', (err) => console.error(`[health] Failed to listen on 127.0.0.1:${port}: ${err.message}`));
  server.listen(port, '127.0.0.1', () => console.log(`[health] Health endpoint listening on 127.0.0.1:${port}/health`));
  return server;
}

module.exports = { startHealthServer, healthPort, DEFAULT_PORT };

// Verify 1.16.5: bot health endpoint + dashboard fetch logic.
// Starts the real health server on ephemeral localhost ports with mocked
// shard states, fetches /health over real HTTP, and exercises the dashboard's
// fetchBotHealth helper with the server up, down, and black-holed.
// Run: node tmp/verify-1.16.5.js   (no token, no Discord, no DB needed)
const fs = require('fs');
const path = require('path');
const net = require('net');
const { startHealthServer, healthPort } = require('../src/utils/healthServer');
const { fetchBotHealth } = require('../src/utils/botHealth');
const { version: pkgVersion } = require('../package.json');

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

async function getJSON(port, p = '/health') {
  const res = await fetch(`http://127.0.0.1:${port}${p}`);
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
}

function closeServer(server) {
  // close() waits for open connections to end; a black-holed socket never
  // ends, and with no other handles pending Node would exit the process
  // while this await is still outstanding. Race it against a 1s timer —
  // the timer itself keeps the loop alive, so the suite always continues.
  return Promise.race([
    new Promise((resolve) => server.close(() => resolve())),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

async function main() {
  console.log('1.16.5 health endpoint — live HTTP checks');

  // --- health server: mixed shard readiness -------------------------------
  const mixed = startHealthServer({
    port: 0,
    getStatus: () => ({ shards: [{ id: 0, ready: true }, { id: 1, ready: false }], guilds: 3 }),
  });
  await new Promise((r) => mixed.once('listening', r));
  const port = mixed.address().port;
  check('binds 127.0.0.1 only', mixed.address().address === '127.0.0.1', `got ${mixed.address().address}`);
  check('ephemeral port assigned', Number.isInteger(port) && port > 0);

  const { status, json } = await getJSON(port);
  check('GET /health returns 200', status === 200);
  check('payload.online is true when a shard is ready', json?.online === true);
  check('payload.version matches package.json', json?.version === pkgVersion, `got ${json?.version}`);
  check('payload.uptimeSeconds is a number >= 0', typeof json?.uptimeSeconds === 'number' && json.uptimeSeconds >= 0);
  check('payload.shards lists both shards with ready flags',
    Array.isArray(json?.shards) && json.shards.length === 2
    && json.shards[0].id === 0 && json.shards[0].ready === true
    && json.shards[1].id === 1 && json.shards[1].ready === false);
  check('payload.guilds passes through when known', json?.guilds === 3);
  await closeServer(mixed);

  // --- all shards down: still answers, online false -----------------------
  const down = startHealthServer({ port: 0, getStatus: () => ({ shards: [{ id: 0, ready: false }] }) });
  await new Promise((r) => down.once('listening', r));
  const downPort = down.address().port;
  const downRes = await getJSON(downPort);
  check('answers while Discord is down (all shards not ready)', downRes.status === 200 && downRes.json?.online === false
    && downRes.json?.shards?.[0]?.ready === false);
  check('guilds omitted when the provider has none', !('guilds' in (downRes.json || {})));
  await closeServer(down);

  // --- unknown path, slow provider ----------------------------------------
  const misc = startHealthServer({
    port: 0,
    getStatus: () => new Promise(() => {}), // never resolves — must not hang the endpoint
  });
  await new Promise((r) => misc.once('listening', r));
  const miscPort = misc.address().port;
  const notFound = await getJSON(miscPort, '/nope');
  check('non-/health path returns 404', notFound.status === 404);
  const t0 = Date.now();
  const slowRes = await getJSON(miscPort);
  const slowMs = Date.now() - t0;
  check('hanging status provider still answers (2s cap)', slowRes.status === 200 && slowRes.json?.online === false, `${slowMs}ms`);
  check('hanging provider answer arrives in reasonable time', slowMs < 4000, `${slowMs}ms`);
  await closeServer(misc);

  // --- throwing provider ----------------------------------------------------
  const throwing = startHealthServer({ port: 0, getStatus: () => { throw new Error('boom'); } });
  await new Promise((r) => throwing.once('listening', r));
  const throwRes = await getJSON(throwing.address().port);
  check('throwing status provider still answers', throwRes.status === 200 && throwRes.json?.online === false);
  await closeServer(throwing);

  // --- healthPort config -----------------------------------------------------
  check('healthPort defaults to 3011', healthPort({}) === 3011);
  check('healthPort honours config.health.port', healthPort({ health: { port: 3999 } }) === 3999);
  check('healthPort rejects garbage (string)', healthPort({ health: { port: 'abc' } }) === 3011);
  check('healthPort rejects out-of-range port', healthPort({ health: { port: 70000 } }) === 3011);
  check('healthPort rejects zero', healthPort({ health: { port: 0 } }) === 3011);

  // --- dashboard fetch helper: server up --------------------------------------
  const up = startHealthServer({ port: 0, getStatus: () => ({ shards: [{ id: 0, ready: true }], guilds: 1 }) });
  await new Promise((r) => up.once('listening', r));
  const upPort = up.address().port;
  const fetched = await fetchBotHealth(upPort);
  check('fetchBotHealth returns the payload when the bot is up',
    fetched?.online === true && fetched?.version === pkgVersion && fetched?.guilds === 1);
  await closeServer(up);

  // --- dashboard fetch helper: server down (connection refused) ----------------
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const deadPort = probe.address().port;
  await new Promise((r) => probe.close(r));
  const t1 = Date.now();
  const dead = await fetchBotHealth(deadPort);
  const deadMs = Date.now() - t1;
  check('fetchBotHealth returns null when the bot is down', dead === null);
  check('fetchBotHealth fails fast on a dead bot (no hang)', deadMs < 1500, `${deadMs}ms`);

  // --- dashboard fetch helper: black hole (accepts, never responds) -------------
  const blackhole = net.createServer((socket) => { /* accept and say nothing */ });
  await new Promise((r) => blackhole.listen(0, '127.0.0.1', r));
  const holePort = blackhole.address().port;
  const t2 = Date.now();
  const holed = await fetchBotHealth(holePort, { timeoutMs: 200 });
  const holeMs = Date.now() - t2;
  check('fetchBotHealth aborts on a black-holed bot', holed === null);
  check('fetchBotHealth abort is near the timeout, not the default', holeMs < 1500, `${holeMs}ms`);
  // The aborted fetch leaves a server-side socket that close() waits on
  // forever (closeAllConnections doesn't drop it either) — just let it go;
  // the suite's process.exit at the end cleans up.
  if (typeof blackhole.closeAllConnections === 'function') blackhole.closeAllConnections();
  blackhole.close();

  // --- fetch helper: garbage payload -------------------------------------------
  const garbage = startHealthServer({ port: 0, getStatus: () => ({ nope: true }) });
  await new Promise((r) => garbage.once('listening', r));
  // /health itself still returns a valid shape (empty shards) even for a
  // garbage provider — the helper's job is to reject non-shape payloads, so
  // test the helper against a raw server that returns junk JSON instead.
  await closeServer(garbage);
  const junk = require('http').createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hello: 'world' }));
  });
  await new Promise((r) => junk.listen(0, '127.0.0.1', r));
  const junkRes = await fetchBotHealth(junk.address().port);
  check('fetchBotHealth rejects a payload without a shards array', junkRes === null);
  await closeServer(junk);

  // --- wiring: source checks ----------------------------------------------------
  const shardManager = read('src/shardManager.js');
  check('source: shardManager starts the health server', shardManager.includes('startHealthServer'));
  check('source: shardManager reads shard readiness from the manager', shardManager.includes('manager.shards'));
  check('source: shardManager guild total only when all shards ready', shardManager.includes('shards.every((s) => s.ready)'));
  const indexJs = read('index.js');
  check('source: index.js starts the health server only when unsharded', indexJs.includes('if (!client.shard)') && indexJs.includes('startHealthServer'));
  check('source: index.js reports client.isReady() + guild count', indexJs.includes('client.isReady()') && indexJs.includes('client.guilds.cache.size'));
  const dashboard = read('src/dashboard.js');
  check('source: dashboard GET /staff fetches bot health', dashboard.includes('fetchBotHealth(healthPort(config))'));
  check('source: dashboard keeps the exact not-connected wording', dashboard.includes('Bot not connected — the dashboard runs standalone'));
  check('source: dashboard sets botConnected true only on a live answer', dashboard.includes('data.botConnected = true'));
  check('source: dashboard exposes no public /health route', !dashboard.includes("app.get('/health'") && !dashboard.includes('app.use(\'/health\''));
  check('source: health server binds 127.0.0.1, never 0.0.0.0', read('src/utils/healthServer.js').includes("server.listen(port, '127.0.0.1'"));
  const staffEjs = read('dashboard/views/staff.ejs');
  check('source: staff overview renders live status when connected', staffEjs.includes('data.botHealth.online') && staffEjs.includes('data.botHealth.shards'));
  check('source: staff overview keeps the old line for the offline case', staffEjs.includes('<%= data.shardInfo %>'));
  check('source: config.example.json documents health.port', read('config.example.json').includes('"health"') && read('config.example.json').includes('"port": 3011'));
  const cmdRoot = path.join(__dirname, '..', 'src', 'commands');
  const cmdFiles = fs.readdirSync(cmdRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => fs.readdirSync(path.join(cmdRoot, d.name))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(cmdRoot, d.name, f)));
  check('source: no slash command file references the health utils',
    !cmdFiles.some((f) => { const src = fs.readFileSync(f, 'utf8'); return src.includes('healthServer') || src.includes('botHealth'); }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error('VERIFY CRASH:', err); process.exit(1); });

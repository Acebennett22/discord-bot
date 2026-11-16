// Verify 1.15.40: log the voice WebSocket close code on every failed join.
//
// LIVE INCIDENT: /music join fails with "Could not join" (6th identical
// error in #botspamtemp, Nov 16 00:25 EST). The 1.15.22 diagnostics proved
// the voice gateway sends HELLO (op 8) then closes the WebSocket while the
// bot is still Identifying, before Ready (op 2) — Staff Errors rows #64-72.
// Reading the installed @discordjs/voice 0.18.0 source (dist/index.js):
//   - Networking.onWsClose (line ~684) destroys the instance and emits
//     'close' WITH the code (line ~694: this.emit("close", code)).
//   - VoiceConnection.configureNetworking attaches
//     networking.once("close", this.onNetworkingClose) — and
//     onNetworkingClose stores the code on the connection state ONLY for
//     4014 (Disconnected + closeCode); every other code just flips the
//     connection back to Signalling and the code is lost. That is why the
//     stateChange stream shows connecting -> signalling and the 10s timeout
//     without ever saying why.
//   - The Networking instance is reachable as connection.state.networking
//     while Connecting/Ready, and a second 'close' listener on the same
//     instance fires alongside the library's own `once`.
//   - destroy() sets state to { code: 6 } WITHOUT emitting 'close', so
//     destroying a connection (normal teardown, rejoin replace) logs nothing
//     spurious.
// Fix (src/utils/musicQueue.js, 1.15.40): on every connection stateChange,
// when a NEW Networking instance appears, attach a one-time 'close'
// listener that logs the code + human meaning through the same errorLogger
// pipeline as the 1.15.20/1.15.22 voice diagnostics (warn, guildId,
// commandName 'play' — visible on the dashboard Staff Errors page).
// No join behavior, timeout, or retry logic changed.
//
// This script runs the REAL musicQueue.js with a fake @discordjs/voice
// (a fake VoiceConnection EventEmitter + fake Networking EventEmitters)
// and a capturing errorLogger, and replays the live incident.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.40.js
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';
'use strict';
const path = require('path');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..');
const GUILD = '1571439343976058970';
const CH = '1571757621503983749'; // the "test" VC from the live incident

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.log(`  FAIL - ${name}${extra ? ` — ${extra}` : ''}`); }
}
function tick() { return new Promise((r) => setImmediate(r)); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// --- Capturing errorLogger (same .log({level, guildId, commandName, message}) shape) ---
const logs = [];
const fakeErrorLogger = { log: (entry) => { logs.push(entry); } };

// --- Fake @discordjs/voice ---
class FakeConnection extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'signalling' };
    this.joinConfig = { channelId: CH };
    this.destroyed = false;
  }
  subscribe() {}
  destroy() { this.destroyed = true; this.state = { status: 'destroyed' }; }
}
class FakePlayer extends EventEmitter {
  play() {} stop() {} pause() { return true; } unpause() { return true; }
}
let currentConnection = null;
let entersStateDeferred = null;
const fakeVoice = {
  joinVoiceChannel: () => { currentConnection = new FakeConnection(); return currentConnection; },
  createAudioPlayer: () => new FakePlayer(),
  createAudioResource: () => ({}),
  AudioPlayerStatus: { Idle: 'idle', Playing: 'playing' },
  VoiceConnectionStatus: {
    Signalling: 'signalling', Connecting: 'connecting', Ready: 'ready',
    Disconnected: 'disconnected', Destroyed: 'destroyed',
  },
  VoiceConnectionDisconnectReason: { WebSocketClose: 0, AdapterUnavailable: 1, EndpointRemoved: 2, Manual: 3 },
  entersState: () => entersStateDeferred.promise,
  StreamType: { Raw: 'raw' },
};

// --- Stub every dependency of musicQueue.js in the require cache ---
function stubModule(request, exportsObj) {
  const resolved = require.resolve(request, { paths: [path.join(ROOT, 'src', 'utils')] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
stubModule('@discordjs/voice', fakeVoice);
stubModule('./errorLogger', fakeErrorLogger);
stubModule('./database', { incrementSongsPlayed: () => {} });
stubModule('./embeds', { infoEmbed: () => ({}), errorEmbed: () => ({}) });
stubModule('./config', { music: { maxQueueSize: 25 } });
stubModule('./spotify', { isSpotifyUrl: () => false, resolveSpotifyUrl: async () => null });
stubModule('./musicFilters', { filterArgs: () => null });
stubModule('./youtube', { search: async () => [], stream: async () => ({}), videoInfo: async () => null });
stubModule('discord.js', { PermissionFlagsBits: { Connect: 1 << 20, Speak: 1 << 21 } });

const mq = require(path.join(ROOT, 'src', 'utils', 'musicQueue.js'));

const voiceChannel = {
  id: CH,
  guild: { voiceAdapterCreator: () => ({}), members: { me: {} } },
  permissionsFor: () => ({ has: () => true }),
};
const textChannel = { send: async () => {} };

function closeCodeLines() {
  return logs.filter((e) => typeof e.message === 'string' && e.message.includes('Voice WebSocket closed'));
}

async function startJoin() {
  logs.length = 0;
  entersStateDeferred = deferred();
  const promise = mq.joinVoice(GUILD, voiceChannel, textChannel);
  await tick(); // let createQueue run up to the entersState await
  return { promise, connection: currentConnection };
}
async function finishJoin(promise) {
  entersStateDeferred.reject(new Error('timeout'));
  const result = await promise;
  return result;
}

async function main() {
  console.log('1.15.40 close-code logging — live incident replay (4006):');
  {
    const { promise, connection } = await startJoin();
    check('join attempt started (connection created)', !!connection);
    const net = new EventEmitter();
    net.token = 'FAKE_TOKEN_XYZ'; // must never appear in any log line
    connection.emit('stateChange', { status: 'signalling' }, { status: 'connecting', networking: net });
    net.emit('close', 4006);
    const result = await finishJoin(promise);
    check('join still fails cleanly (timeout path unchanged)', result.joined === false && typeof result.reason === 'string');
    const lines = closeCodeLines();
    check('exactly one close-code line logged', lines.length === 1, `got ${lines.length}`);
    const line = lines[0] || {};
    check('line carries guild + channel + command context',
      line.guildId === GUILD && line.commandName === 'play' && String(line.message).includes(`#${CH}`),
      JSON.stringify(line));
    check('line names code 4006 + identify-rejected meaning',
      String(line.message).includes('close code 4006') && String(line.message).includes('session no longer valid') && String(line.message).includes('server rejected the Identify'),
      line.message);
    check('line is warn level (Staff Errors, same as other voice diagnostics)', line.level === 'warn', line.level);
    check('no token anywhere in the logged lines', !logs.some((e) => String(e.message).includes('FAKE_TOKEN_XYZ')));
    check('timeout row still logged after the close-code row',
      logs.some((e) => String(e.message).includes('Voice join timed out after 10s')));
  }

  console.log('Meaning table — one close code per case:');
  const cases = [
    [4004, 'authentication failed — server rejected the Identify'],
    [1006, 'abnormal closure — transport dropped, no close frame'],
    [4014, 'disconnected by server — do not reconnect'],
    [4015, 'voice server crashed'],
    [4999, 'unknown close code'],
  ];
  for (const [code, meaning] of cases) {
    const { promise, connection } = await startJoin();
    const net = new EventEmitter();
    connection.emit('stateChange', { status: 'signalling' }, { status: 'connecting', networking: net });
    net.emit('close', code);
    await finishJoin(promise);
    const lines = closeCodeLines();
    check(`code ${code} logs its meaning`,
      lines.length === 1 && String(lines[0].message).includes(`close code ${code}`) && String(lines[0].message).includes(meaning),
      lines.map((l) => l.message).join(' | '));
  }

  console.log('One listener per Networking instance (no duplicates, no leaks):');
  {
    const { promise, connection } = await startJoin();
    const net1 = new EventEmitter();
    const net2 = new EventEmitter();
    // Same instance across two stateChanges (e.g. connecting -> signalling
    // keeps the same networking object via spread) must not double-attach.
    connection.emit('stateChange', { status: 'signalling' }, { status: 'connecting', networking: net1 });
    connection.emit('stateChange', { status: 'connecting', networking: net1 }, { status: 'signalling', networking: net1 });
    net1.emit('close', 4006);
    check('same instance twice -> still exactly one line for its close',
      closeCodeLines().length === 1, `got ${closeCodeLines().length}`);
    // A rejoin swaps in a NEW Networking instance — it gets its own listener.
    connection.emit('stateChange', { status: 'signalling', networking: net1 }, { status: 'connecting', networking: net2 });
    net2.emit('close', 1006);
    check('new instance on rejoin logs its own close',
      closeCodeLines().length === 2 && String(closeCodeLines()[1].message).includes('close code 1006'),
      closeCodeLines().map((l) => l.message).join(' | '));
    // A destroyed instance never emits 'close' (library destroy() only sets
    // state to {code:6}) — replacing the instance logs nothing spurious.
    const before = closeCodeLines().length;
    connection.emit('stateChange', { status: 'connecting', networking: net2 }, { status: 'signalling', networking: net2 });
    check('stateChange with no close emits nothing', closeCodeLines().length === before);
    await finishJoin(promise);
  }

  console.log('No token in the implementation path:');
  {
    const src = require('fs').readFileSync(path.join(ROOT, 'src', 'utils', 'musicQueue.js'), 'utf8');
    const start = src.indexOf('describeVoiceCloseCode');
    const end = src.indexOf('async function createQueue');
    const block = src.slice(start, end);
    // The block's only use of the word "token" is the comment stating the
    // log line carries none — what must never happen is READING a token
    // value into a log call.
    check('close-code block never reads a token value', !/\.token\b|token\s*:/i.test(block));
    check('close-code block logs via errorLogger.log (Staff Errors pipeline)', block.includes('errorLogger.log'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });

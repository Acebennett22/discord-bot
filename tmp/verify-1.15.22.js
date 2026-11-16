// Verify 1.15.22: voice debug logging + connection 'error' guard — mock-based.
// A live Discord voice join cannot be tested from this sandbox (no real
// voice connection), so the @discordjs/voice surface is mocked and the
// logic paths are verified instead.
const Module = require('module');

const checks = [];
function check(name, ok) {
  checks.push([name, !!ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

// ---- Mock state (per-test knobs) -----------------------------------------
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
const FAKE_JOIN_TOKEN = 'FAKE-JOIN-TOKEN-0123456789abcdef';
let allowedPerms = new Set([CONNECT, SPEAK]); // bot's perms in the VC
let connectionReadyBehavior = 'ready'; // 'ready' | 'never'
let streamBehavior = 'ok'; // 'ok' | 'fail'
const sentMessages = [];
const logs = [];
const connectionsByGuild = new Map();
let lastJoinOptions = null;

function makeConnection(guildId, channelId) {
  const handlers = {};
  const conn = {
    // joinConfig carries a fake voice token in the real lib — the diagnostics
    // must never log it.
    joinConfig: { channelId, guildId, group: 'default', token: FAKE_JOIN_TOKEN },
    state: { status: 'signalling' },
    subscribe() {},
    destroy() { this._transition({ status: 'destroyed' }); },
    on(event, cb) { (handlers[event] = handlers[event] || []).push(cb); },
    _transition(newState) {
      const old = this.state;
      this.state = newState;
      (handlers.stateChange || []).forEach((cb) => cb(old, newState));
      // The real lib also emits the status string as an event name.
      (handlers[newState.status] || []).forEach((cb) => cb());
    },
    _emit(event, ...args) { (handlers[event] || []).forEach((cb) => cb(...args)); },
  };
  return conn;
}

const voiceMock = {
  joinVoiceChannel(opts) {
    lastJoinOptions = { ...opts };
    const { channelId, guildId } = opts;
    let conn = connectionsByGuild.get(guildId);
    if (conn && conn.state.status !== 'destroyed') {
      conn.joinConfig.channelId = channelId;
      return conn;
    }
    conn = makeConnection(guildId, channelId);
    connectionsByGuild.set(guildId, conn);
    return conn;
  },
  createAudioPlayer() {
    const handlers = {};
    return {
      _state: 'idle',
      play() { this._state = 'playing'; },
      stop() { this._state = 'idle'; (handlers.idle || []).forEach((cb) => cb()); },
      pause() { return true; },
      unpause() { return true; },
      on(event, cb) { (handlers[event] = handlers[event] || []).push(cb); },
    };
  },
  createAudioResource() { return { mock: true }; },
  AudioPlayerStatus: { Idle: 'idle', Playing: 'playing' },
  VoiceConnectionStatus: {
    Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed',
    Signalling: 'signalling', Connecting: 'connecting',
  },
  // Mirror the real enum incl. reverse mapping.
  VoiceConnectionDisconnectReason: {
    WebSocketClose: 0, AdapterUnavailable: 1, EndpointRemoved: 2, Manual: 3,
    0: 'WebSocketClose', 1: 'AdapterUnavailable', 2: 'EndpointRemoved', 3: 'Manual',
  },
  StreamType: { Raw: 'raw', Opus: 'opus' },
  async entersState(target, status, _timeout) {
    if (status === 'playing') return target; // player always reaches Playing in mocks
    // Connection Ready: behavior knob.
    if (connectionReadyBehavior === 'ready') {
      if (target.state.status !== 'ready') target._transition({ status: 'connecting' });
      target._transition({ status: 'ready' });
      return target;
    }
    // Stuck: reaches Connecting, never Ready.
    if (target.state.status !== 'connecting') target._transition({ status: 'connecting' });
    throw new Error('entersState timed out');
  },
};

function makeVoiceChannel(guildId, channelId) {
  return {
    id: channelId,
    guild: {
      id: guildId,
      members: { me: { id: 'bot' } },
      voiceAdapterCreator: {},
    },
    permissionsFor() {
      return {
        has(flags) {
          const list = Array.isArray(flags) ? flags : [flags];
          return list.every((f) => allowedPerms.has(f));
        },
      };
    },
  };
}

function makeTextChannel() {
  return {
    id: 'text1',
    async send(msg) { sentMessages.push(msg); return { id: 'm1' }; },
  };
}

const fakeStream = { pipe() { return fakeStream; }, on() {} };

// ---- Intercept requires before loading musicQueue ------------------------
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@discordjs/voice') return voiceMock;
  if (request === 'discord.js') {
    return { PermissionFlagsBits: { Connect: CONNECT, Speak: SPEAK } };
  }
  if (request.endsWith('/youtube') || request === './youtube') {
    return {
      search: async () => [{ url: 'https://youtu.be/x', title: 'Found Song', durationInSec: 200 }],
      videoInfo: async () => ({ title: 'URL Song', durationInSec: 180 }),
      stream: async () => {
        if (streamBehavior === 'fail') throw new Error('no stream');
        return { stream: fakeStream, type: 'webm/opus' };
      },
    };
  }
  if (request.endsWith('/database') || request === './database') {
    return { incrementSongsPlayed: () => {} };
  }
  if (request.endsWith('/embeds') || request === './embeds') {
    return {
      infoEmbed: (t, d) => ({ title: t, description: d }),
      errorEmbed: (t, d) => ({ title: t, description: d }),
      successEmbed: (t, d) => ({ title: t, description: d }),
    };
  }
  if (request.endsWith('/config') || request === './config') return { music: { maxQueueSize: 25 } };
  if (request.endsWith('/spotify') || request === './spotify') {
    return { isSpotifyUrl: () => false, resolveSpotifyUrl: async () => null };
  }
  if (request.endsWith('/musicFilters') || request === './musicFilters') return { filterArgs: () => null };
  // NOTE: this mock errorLogger pushes entries raw — it does NOT run the
  // real scrubText(). Token-leak tests below therefore assert the
  // handler-level filter (dropping `>>` lines); scrubText is a backstop
  // already verified by tmp/verify-1.15.19.js (32/32).
  if (request.endsWith('/errorLogger') || request === './errorLogger') {
    return { log: (e) => logs.push(e) };
  }
  if (request.endsWith('/guildSettings') || request === './guildSettings') {
    return { getGuildSettings: async () => ({ music247Enabled: false }) };
  }
  return origLoad.call(this, request, parent, isMain);
};

const mq = require('../src/utils/musicQueue');

function reset() {
  allowedPerms = new Set([CONNECT, SPEAK]);
  connectionReadyBehavior = 'ready';
  streamBehavior = 'ok';
  sentMessages.length = 0;
  logs.length = 0;
  connectionsByGuild.clear();
  lastJoinOptions = null;
  // musicQueue's internal map is per-module; fresh state per test is faked
  // by using a different guild id each time.
}
let guildSeq = 0;
function nextGuild() { guildSeq += 1; return `g${guildSeq}`; }

function debugLogs() {
  return logs.filter((e) => e.level === 'warn' && /^Voice debug in #/.test(e.message || ''));
}

const HELLO_DEBUG = '[NW] [WS] << {"op":8,"d":{"heartbeat_interval":41250}}';
const READY_DEBUG = '[NW] [WS] << {"op":2,"d":{"ssrc":1234,"ip":"203.0.113.7","port":50000,"modes":["xsalsa20_poly1305"]}}';
const IDENTIFY_DEBUG = `[NW] [WS] >> {"op":2,"d":{"server_id":"111","user_id":"222","session_id":"sess1","token":"${FAKE_JOIN_TOKEN}"}}`;

(async () => {
  // (a) A debug HELLO packet is logged at warn with the packet content.
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    logs.length = 0;
    conn._emit('debug', HELLO_DEBUG);
    conn._emit('debug', READY_DEBUG);
    const d = debugLogs();
    check('(a) HELLO debug line logged at warn with packet content',
      d.some((e) => e.message.includes('op":8') && e.message.includes('heartbeat_interval') && e.commandName === 'play' && e.guildId === g));
    check('(a) READY debug line logged with ssrc/ip/port',
      d.some((e) => e.message.includes('op":2') && e.message.includes('203.0.113.7')));
    check('(a) debug lines are warn level, not error',
      d.every((e) => e.level === 'warn'));
  }

  // (b) A networking error with code ECONNRESET is logged at error level
  // WITH the code in the message.
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    logs.length = 0;
    const err = new Error('read ECONNRESET');
    err.code = 'ECONNRESET';
    conn._emit('error', err);
    const e = logs.find((x) => /Voice connection error/.test(x.message || ''));
    check('(b) networking error logged at error level with code in message',
      !!e && e.level === 'error' && /\[ECONNRESET\]/.test(e.message) && /read ECONNRESET/.test(e.message));
    check('(b) error entry carries the stack',
      !!e && typeof e.stack === 'string' && e.stack.includes('ECONNRESET'));
    check('(b) error entry has commandName play',
      !!e && e.commandName === 'play');
  }

  // (c) A clean close with no error event logs NO error entry — only the
  // existing stateChange entries.
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    logs.length = 0;
    conn._transition({ status: 'disconnected', reason: 0, closeCode: 4014 });
    check('(c) clean close logs no error entries',
      !logs.some((e) => e.level === 'error'));
    check('(c) clean close still logs the warn transition',
      logs.some((e) => e.level === 'warn' && /disconnected/.test(e.message || '')));
  }

  // (d) Debug messages are capped in length.
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    logs.length = 0;
    const longMsg = `[NW] [WS] << {"op":8,"d":{"heartbeat_interval":41250,"pad":"${'x'.repeat(1200)}"}}`;
    conn._emit('debug', longMsg);
    const d = debugLogs();
    check('(d) long debug line is capped (prefix + 500 chars max)',
      d.length === 1 && d[0].message.length <= 'Voice debug in #vc1: '.length + 500);
    check('(d) capped line still starts with the packet',
      d.length === 1 && d[0].message.includes('op":8'));
  }

  // (e) No logged entry contains a token-like value: the outgoing identify
  // (`>>`, carries the voice session token) must be dropped, and the
  // joinConfig token must never appear.
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    logs.length = 0;
    conn._emit('debug', IDENTIFY_DEBUG);
    conn._emit('debug', HELLO_DEBUG);
    const leaked = logs.filter((e) =>
      (e.message && (e.message.includes(FAKE_JOIN_TOKEN) || e.message.includes('FAKE-')))
      || (e.stack && (e.stack.includes(FAKE_JOIN_TOKEN) || e.stack.includes('FAKE-'))));
    check('(e) outgoing identify line is dropped, token never logged', leaked.length === 0);
    check('(e) HELLO line still logged alongside the dropped identify',
      debugLogs().some((x) => x.message.includes('op":8')));
    const allLogs = logs.map((x) => `${x.message || ''}${x.stack || ''}`).join('\n');
    check('(e) no logged entry mentions a token at all', !/token/i.test(allLogs));
  }

  // (f) Join success path still works; debug:true is passed to the lib.
  reset();
  {
    const g = nextGuild();
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(f) join success path unchanged: track added + Now playing sent',
      r.added === true && sentMessages.some((m) => m.embeds?.[0]?.title === 'Now playing'));
    check('(f) joinVoiceChannel called with debug:true',
      lastJoinOptions !== null && lastJoinOptions.debug === true);
    check('(f) no error logged on a clean join',
      !logs.some((e) => e.level === 'error'));
  }

  const failed = checks.filter(([, ok]) => !ok);
  console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

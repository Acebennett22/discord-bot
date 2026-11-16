// Verify 1.15.20: voice-connection state diagnostics — mock-based.
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
const FAKE_JOIN_TOKEN = 'FAKE-JOIN-TOKEN-abc123def456';
let allowedPerms = new Set([CONNECT, SPEAK]); // bot's perms in the VC
let connectionReadyBehavior = 'ready'; // 'ready' | 'never'
let streamBehavior = 'ok'; // 'ok' | 'fail'
const sentMessages = [];
const logs = [];
const connectionsByGuild = new Map();

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
  joinVoiceChannel({ channelId, guildId }) {
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
  // musicQueue's internal map is per-module; fresh state per test is faked
  // by using a different guild id each time.
}
let guildSeq = 0;
function nextGuild() { guildSeq += 1; return `g${guildSeq}`; }

function warnTransitions() {
  return logs.filter((e) => e.level === 'warn' && /^Voice .* -> .* in #/.test(e.message));
}

(async () => {
  // (a) Successful join logs every transition at warn level.
  reset();
  {
    const g = nextGuild();
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(a) successful join still adds the track', r.added === true);
    const t = warnTransitions();
    check('(a) signalling -> connecting logged at warn',
      t.some((e) => e.message === 'Voice signalling -> connecting in #vc1' && e.commandName === 'play' && e.guildId === g));
    check('(a) connecting -> ready logged at warn',
      t.some((e) => e.message === 'Voice connecting -> ready in #vc1'));
    check('(a) no error logged on a clean join',
      !logs.some((e) => e.level === 'error'));
  }

  // (b) Stuck in Connecting past the timeout: join fails AND the log names
  // the stuck status (the 1.15.18 blind spot).
  reset();
  {
    const g = nextGuild();
    connectionReadyBehavior = 'never';
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(b) stuck join -> added:false with join-failed reason',
      r.added === false && /Could not join/.test(r.reason));
    const timeoutLog = logs.find((e) => /timed out after 10s/.test(e.message || ''));
    check('(b) timeout log names the stuck status',
      !!timeoutLog && /stuck in connecting/.test(timeoutLog.message) && /vc1/.test(timeoutLog.message));
    check('(b) timeout log is level error with commandName play',
      !!timeoutLog && timeoutLog.level === 'error' && timeoutLog.commandName === 'play');
    check('(b) signalling -> connecting transition was logged before the timeout',
      warnTransitions().some((e) => e.message === 'Voice signalling -> connecting in #vc1'));
    check('(b) destroy after timeout also logged (connecting -> destroyed)',
      warnTransitions().some((e) => e.message === 'Voice connecting -> destroyed in #vc1'));
  }

  // (c) Disconnected transition: close code + reason name when present,
  // clean when absent.
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    logs.length = 0;
    conn._transition({ status: 'disconnected', reason: 0, closeCode: 4014 });
    const ws = warnTransitions().find((e) => /disconnected/.test(e.message));
    check('(c) WebSocketClose logs reason name + close code',
      !!ws && /reason=WebSocketClose/.test(ws.message) && /closeCode=4014/.test(ws.message));
  }
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    logs.length = 0;
    conn._transition({ status: 'disconnected', reason: 3 }); // Manual, no closeCode
    const m = warnTransitions().find((e) => /disconnected/.test(e.message));
    check('(c) Manual disconnect logs reason name, no close code',
      !!m && /reason=Manual/.test(m.message) && !/closeCode/.test(m.message));
  }
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    logs.length = 0;
    conn._transition({ status: 'disconnected', reason: 2 }); // EndpointRemoved
    const e = warnTransitions().find((e2) => /disconnected/.test(e2.message));
    check('(c) EndpointRemoved logs reason name',
      !!e && /reason=EndpointRemoved/.test(e.message));
    conn._transition({ status: 'disconnected', reason: 1 }); // AdapterUnavailable
    const a = warnTransitions().filter((e2) => /disconnected/.test(e2.message)).pop();
    check('(c) AdapterUnavailable logs reason name',
      !!a && /reason=AdapterUnavailable/.test(a.message));
  }

  // (d) No logged entry contains the fake voice token (or any FAKE value).
  {
    const leaked = logs.filter((e) =>
      (e.message && (e.message.includes(FAKE_JOIN_TOKEN) || e.message.includes('FAKE-')))
      || (e.stack && (e.stack.includes(FAKE_JOIN_TOKEN) || e.stack.includes('FAKE-'))));
    check('(d) no logged entry contains the joinConfig token', leaked.length === 0);
    const allLogs = logs.map((e) => `${e.message || ''}${e.stack || ''}`).join('\n');
    check('(d) no logged entry mentions a token at all', !/token/i.test(allLogs));
  }

  // (e) playNext VOICE_NOT_READY branch also names the stuck status.
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    mq.skip(g); // player Idle -> playNext empties the queue (playing=null)
    // Simulate a reconnecting connection: state flipped without an event.
    conn.state = { status: 'connecting' };
    logs.length = 0;
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/y');
    check('(e) voice-not-ready at play time -> added:false',
      r.added === false && /Could not join/.test(r.reason));
    const nr = logs.find((e) => /Voice connection not ready/.test(e.message || ''));
    check('(e) not-ready log names the stuck status',
      !!nr && /stuck in connecting/.test(nr.message));
  }

  // (f) Behavior unchanged: successful play still posts Now playing once.
  reset();
  {
    const g = nextGuild();
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(f) behavior unchanged: track added + Now playing sent',
      r.added === true && sentMessages.some((m) => m.embeds?.[0]?.title === 'Now playing'));
  }

  const failed = checks.filter(([, ok]) => !ok);
  console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

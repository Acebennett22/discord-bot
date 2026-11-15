// Verify 1.15.17: voice-join fix + /music join — mock-based.
// A live Discord voice join cannot be tested from this sandbox (no real
// voice connection), so the @discordjs/voice surface is mocked and the
// logic paths are verified instead.
const Module = require('module');
const path = require('path');

const checks = [];
function check(name, ok) {
  checks.push([name, !!ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

// ---- Mock state (per-test knobs) -----------------------------------------
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
let allowedPerms = new Set([CONNECT, SPEAK]); // bot's perms in the VC
let connectionReadyBehavior = 'ready'; // 'ready' | 'never'
let streamBehavior = 'ok'; // 'ok' | 'fail'
let videoInfoHook = null; // test hook: called inside videoInfo resolution
const sentMessages = [];
const logs = [];
const connectionsByGuild = new Map();

function makeConnection(guildId, channelId) {
  const handlers = {};
  const conn = {
    joinConfig: { channelId, guildId, group: 'default' },
    state: { status: 'signalling' },
    subscribe() {},
    destroy() { this.state.status = 'destroyed'; },
    on(event, cb) { (handlers[event] = handlers[event] || []).push(cb); },
    _emit(event) { (handlers[event] || []).forEach((cb) => cb()); },
  };
  return conn;
}

const voiceMock = {
  joinVoiceChannel({ channelId, guildId }) {
    let conn = connectionsByGuild.get(guildId);
    if (conn && conn.state.status !== 'destroyed') {
      // Real lib reuses the connection and sends the move payload.
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
      stop() { this._state = 'idle'; (handlers['idle'] || []).forEach((cb) => cb()); },
      pause() { return true; },
      unpause() { return true; },
      on(event, cb) { (handlers[event] = handlers[event] || []).push(cb); },
    };
  },
  createAudioResource() { return { mock: true }; },
  AudioPlayerStatus: { Idle: 'idle', Playing: 'playing' },
  VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed', Signalling: 'signalling' },
  StreamType: { Raw: 'raw', Opus: 'opus' },
  async entersState(target, status, _timeout) {
    if (status === 'playing') return target; // player always reaches Playing in mocks
    // Connection Ready: behavior knob.
    if (connectionReadyBehavior === 'ready') {
      target.state.status = 'ready';
      return target;
    }
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
    class FakeBuilder {
      constructor() { this.name = null; this.description = null; }
      setName(n) { this.name = n; return this; }
      setDescription(d) { this.description = d; return this; }
      addStringOption() { return this; }
    }
    return { PermissionFlagsBits: { Connect: CONNECT, Speak: SPEAK }, SlashCommandBuilder: FakeBuilder };
  }
  if (request.endsWith('/youtube') || request === './youtube') {
    return {
      search: async () => [{ url: 'https://youtu.be/x', title: 'Found Song', durationInSec: 200 }],
      videoInfo: async () => {
        if (videoInfoHook) videoInfoHook();
        return { title: 'URL Song', durationInSec: 180 };
      },
      stream: async () => {
        if (streamBehavior === 'fail') throw new Error('no stream');
        return { stream: fakeStream, type: 'webm/opus' };
      },
    };
  }
  if (request.endsWith('/database') || request === './database') {
    return { incrementSongsPlayed: () => { songsPlayed += 1; } };
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
const joinCmd = require('../src/commands/music/join');

function reset() {
  allowedPerms = new Set([CONNECT, SPEAK]);
  connectionReadyBehavior = 'ready';
  streamBehavior = 'ok';
  songsPlayed = 0;
  sentMessages.length = 0;
  logs.length = 0;
  connectionsByGuild.clear();
  // musicQueue's internal map is per-module; fresh state per test is faked
  // by using a different guild id each time.
}
let guildSeq = 0;
function nextGuild() { guildSeq += 1; return `g${guildSeq}`; }

(async () => {
  // (a) Missing Connect permission -> added:false, permission reason, no queue.
  reset();
  {
    const g = nextGuild();
    allowedPerms = new Set([SPEAK]);
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(a) missing Connect -> added:false with permission reason', r.added === false && /Connect and Speak/.test(r.reason));
    check('(a) no queue created', mq.getQueue(g) === undefined);
    check('(a) no song counted', songsPlayed === 0);
  }

  // (a2) Missing Speak permission -> same.
  reset();
  {
    const g = nextGuild();
    allowedPerms = new Set([CONNECT]);
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(a2) missing Speak -> added:false with permission reason', r.added === false && /Connect and Speak/.test(r.reason));
    check('(a2) no queue created', mq.getQueue(g) === undefined);
  }

  // (b) Join never reaches Ready -> added:false, no "Now playing", no count.
  reset();
  {
    const g = nextGuild();
    connectionReadyBehavior = 'never';
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(b) join timeout -> added:false with join-failed reason', r.added === false && /Could not join/.test(r.reason));
    check('(b) no queue left behind', mq.getQueue(g) === undefined);
    check('(b) no "Now playing" sent', !sentMessages.some((m) => m.embeds?.[0]?.title === 'Now playing'));
    check('(b) no song counted', songsPlayed === 0);
  }

  // (b2) Connection dead on an idle queue -> playNext voice-gate fires ->
  // added:false, no phantom playing entry.
  reset();
  {
    const g = nextGuild();
    await mq.joinVoice(g, makeVoiceChannel(g, 'vc1'), makeTextChannel());
    const q = mq.getQueue(g);
    q.connection.state.status = 'disconnected';
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(b2) dead connection -> added:false with join-failed reason', r.added === false && /Could not join/.test(r.reason));
    check('(b2) no phantom playing entry / queue destroyed', mq.getQueue(g) === undefined);
    check('(b2) join-failure error posted to text channel', sentMessages.some((m) => m.embeds?.[0]?.title === 'Could not join voice'));
  }

  // (b3) Connection drops DURING query resolution (Disconnected event fires
  // mid-addTrack) -> added:false, no crash in the caller, no lost track.
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const conn = connectionsByGuild.get(g);
    // Emit the disconnect from inside videoInfo resolution of the 2nd track.
    videoInfoHook = () => conn._emit('disconnected');
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    videoInfoHook = null;
    check('(b3) drop mid-resolution -> added:false with join-failed reason', r.added === false && /Could not join/.test(r.reason));
    check('(b3) queue destroyed', mq.getQueue(g) === undefined);
    check('(b3) left-voice message posted by the disconnect handler', sentMessages.some((m) => m.embeds?.[0]?.title === 'Left voice'));
  }

  // (c) Successful join -> plays, "Now playing" sent, song counted.
  reset();
  {
    const g = nextGuild();
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(c) success -> added:true', r.added === true);
    check('(c) "Now playing" sent', sentMessages.some((m) => m.embeds?.[0]?.title === 'Now playing'));
    check('(c) song counted once', songsPlayed === 1);
    check('(c) queue.playing set', mq.getQueue(g)?.playing?.url === 'https://youtu.be/x');
  }

  // (c2) Stream failure (not a join failure) -> still added:true.
  reset();
  {
    const g = nextGuild();
    streamBehavior = 'fail';
    const r = await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    check('(c2) stream failure -> still added:true (not a join failure)', r.added === true);
    check('(c2) no song counted', songsPlayed === 0);
  }

  // (d) Mid-play disconnect with a track playing -> left-voice message.
  reset();
  {
    const g = nextGuild();
    await mq.addTrack(g, makeVoiceChannel(g, 'vc1'), makeTextChannel(), 'https://youtu.be/x');
    const before = sentMessages.length;
    const conn = connectionsByGuild.get(g);
    conn._emit('disconnected');
    check('(d) disconnect posts left-voice message', sentMessages.slice(before).some((m) => m.embeds?.[0]?.title === 'Left voice'));
    check('(d) queue destroyed after disconnect', mq.getQueue(g) === undefined);
  }

  // (d2) Disconnect while idle -> silent (no message).
  reset();
  {
    const g = nextGuild();
    await mq.joinVoice(g, makeVoiceChannel(g, 'vc1'), makeTextChannel());
    const before = sentMessages.length;
    connectionsByGuild.get(g)._emit('disconnected');
    check('(d2) idle disconnect is silent', sentMessages.length === before);
  }

  // joinVoice: success.
  reset();
  {
    const g = nextGuild();
    const r = await mq.joinVoice(g, makeVoiceChannel(g, 'vc1'), makeTextChannel());
    check('(join) success -> joined:true', r.joined === true && !r.already && !r.moved);
    check('(join) connection Ready', connectionsByGuild.get(g).state.status === 'ready');
  }

  // joinVoice: missing perms.
  reset();
  {
    const g = nextGuild();
    allowedPerms = new Set();
    const r = await mq.joinVoice(g, makeVoiceChannel(g, 'vc1'), makeTextChannel());
    check('(join) missing perms -> joined:false with permission reason', r.joined === false && /Connect and Speak/.test(r.reason));
    check('(join) no connection created', !connectionsByGuild.has(g));
  }

  // joinVoice: already connected to the same channel.
  reset();
  {
    const g = nextGuild();
    await mq.joinVoice(g, makeVoiceChannel(g, 'vc1'), makeTextChannel());
    const connBefore = connectionsByGuild.get(g);
    const r = await mq.joinVoice(g, makeVoiceChannel(g, 'vc1'), makeTextChannel());
    check('(join) already there -> already:true', r.joined === true && r.already === true);
    check('(join) no duplicate connection', connectionsByGuild.get(g) === connBefore);
  }

  // joinVoice: move to a different channel.
  reset();
  {
    const g = nextGuild();
    await mq.joinVoice(g, makeVoiceChannel(g, 'vc1'), makeTextChannel());
    const connBefore = connectionsByGuild.get(g);
    const r = await mq.joinVoice(g, makeVoiceChannel(g, 'vc2'), makeTextChannel());
    check('(join) move -> joined:true, moved:true', r.joined === true && r.moved === true);
    check('(join) same connection object reused', connectionsByGuild.get(g) === connBefore);
    check('(join) connection now on vc2', connBefore.joinConfig.channelId === 'vc2');
  }

  // joinVoice: join timeout -> joined:false.
  reset();
  {
    const g = nextGuild();
    connectionReadyBehavior = 'never';
    const r = await mq.joinVoice(g, makeVoiceChannel(g, 'vc1'), makeTextChannel());
    check('(join) timeout -> joined:false with join-failed reason', r.joined === false && /Could not join/.test(r.reason));
  }

  // join command file: loads, correct name/description.
  check('(cmd) /music join file loads with name "join"', joinCmd.data?.name === 'join');
  check('(cmd) /music join has an execute function', typeof joinCmd.execute === 'function');

  const failed = checks.filter(([, ok]) => !ok);
  console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

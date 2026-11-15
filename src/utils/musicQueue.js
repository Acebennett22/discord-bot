// Per-guild music queue manager built on @discordjs/voice + @distube/ytdl-core.
const errorLogger = require('./errorLogger');
// One queue per guild: { connection, player, queue: [], textChannel, playing }.
// src/utils/youtube.js wraps ytdl-core for search + streaming; no API keys
// are needed for it. (play-dl was dropped in 1.15.11 — its extraction broke.)
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const youtube = require('./youtube');
const db = require('./database');
const { infoEmbed, errorEmbed } = require('./embeds');
const config = require('./config');
const { isSpotifyUrl, resolveSpotifyUrl } = require('./spotify');
const { filterArgs } = require('./musicFilters');
const { StreamType } = require('@discordjs/voice');
const { PermissionFlagsBits } = require('discord.js');

const queues = new Map();

function getQueue(guildId) {
  return queues.get(guildId);
}

// The bot must be able to Connect and Speak in the target voice channel.
// Checked before any join attempt so a missing permission is a clear error
// instead of a silent failed join (1.15.17).
function hasVoicePerms(voiceChannel) {
  const me = voiceChannel.guild?.members?.me;
  const perms = voiceChannel.permissionsFor?.(me);
  return !!perms?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]);
}

const JOIN_FAILED_REASON = 'Could not join the voice channel. Check my permissions and try again.';
const NO_VOICE_PERMS_REASON = 'I need Connect and Speak permission in that voice channel.';

async function createQueue(guildId, voiceChannel, textChannel) {
  if (!hasVoicePerms(voiceChannel)) {
    return { ok: false, reason: NO_VOICE_PERMS_REASON };
  }
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });
  const player = createAudioPlayer();
  connection.subscribe(player);
  const queue = { connection, player, queue: [], textChannel, playing: null, filter: 'off', playingStartedAt: null };
  queues.set(guildId, queue);

  player.on(AudioPlayerStatus.Idle, () => {
    playNext(guildId);
  });
  player.on('error', (err) => {
    errorLogger.log({ level: 'error', guildId, commandName: 'play', message: `Music player error: ${err.message}`, stack: err.stack });
    if (queue.textChannel) queue.textChannel.send({ embeds: [errorEmbed('Playback error', '⚠️ Something went wrong playing that track — skipping it.')] }).catch(() => {});
    playNext(guildId);
  });
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    // Loud disconnect (1.15.17): don't silently vanish mid-song — tell the
    // text channel the music stopped. Silent when idle (stop/idle destroy
    // goes through Destroyed, not Disconnected, so this only fires on real
    // drops, e.g. being kicked from the channel).
    const wasPlaying = !!queue.playing;
    const channel = queue.textChannel;
    destroyQueue(guildId);
    if (wasPlaying && channel) {
      channel.send({ embeds: [errorEmbed('Left voice', '⚠️ I was disconnected from the voice channel — the music stopped. Use /music play to start again.')] }).catch(() => {});
    }
  });

  // The player can reach Playing even on a dead connection, so the join must
  // be confirmed here — a queue that never became Ready is a join failure,
  // not a queue (1.15.17).
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch {
    destroyQueue(guildId);
    return { ok: false, reason: JOIN_FAILED_REASON };
  }
  return { ok: true, queue };
}

const VOICE_NOT_READY = 'VOICE_NOT_READY';

// Returns true when a track started playing, 'voice-failed' when the voice
// connection was not Ready (join failure), false when nothing started
// (empty queue, no queue). Callers that need the outcome (addTrack) await
// it; fire-and-forget callers (Idle handler, player error handler) ignore it.
async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  const next = queue.queue.shift();
  if (!next) {
    queue.playing = null;
    // Stay connected for a bit in case more songs come; destroy after 60s idle.
    // 24/7 mode (1.12.1): never destroy — the bot sits in the channel.
    setTimeout(async () => {
      const q = queues.get(guildId);
      if (!q || q.playing || q.queue.length !== 0) return;
      const { getGuildSettings } = require('./guildSettings');
      const s = await getGuildSettings(guildId).catch(() => null);
      if (s?.music247Enabled) return;
      destroyQueue(guildId);
    }, 60_000);
    return false;
  }
  queue.playing = next;
  queue.playingStartedAt = Date.now();
  try {
    // Gate the announcement on the CONNECTION, not just the player: the
    // player can reach Playing on a dead connection, which used to post
    // "Now playing" while the bot was not in the channel (1.15.17).
    if (queue.connection.state.status !== VoiceConnectionStatus.Ready) {
      throw new Error(VOICE_NOT_READY);
    }
    const stream = await youtube.stream(next.url);
    const args = filterArgs(queue.filter);
    let resource;
    if (args) {
      // Filter on: re-encode the track through FFmpeg with the filter.
      // prism-media pipes the source stream through ffmpeg; on failure we
      // fall back to the unfiltered stream below.
      try {
        const { FFmpeg } = require('prism-media');
        const ffmpegArgs = ['-analyzeduration', '0', '-loglevel', '0'];
        if (stream.ffmpegInputFormat) ffmpegArgs.push('-f', stream.ffmpegInputFormat);
        ffmpegArgs.push('-i', '-', '-af', args, '-f', 's16le', '-ar', '48000', '-ac', '2');
        const transcoder = new FFmpeg({ args: ffmpegArgs });
        stream.stream.pipe(transcoder);
        transcoder.on('error', () => {});
        resource = createAudioResource(transcoder, { inputType: StreamType.Raw });
      } catch {
        resource = createAudioResource(stream.stream, { inputType: stream.type });
      }
    } else {
      resource = createAudioResource(stream.stream, { inputType: stream.type });
    }
    queue.player.play(resource);
    await entersState(queue.player, AudioPlayerStatus.Playing, 10_000);
    if (queue.connection.state.status !== VoiceConnectionStatus.Ready) {
      throw new Error(VOICE_NOT_READY);
    }
    db.incrementSongsPlayed(guildId);
    if (queue.textChannel) {
      queue.textChannel.send({ embeds: [infoEmbed('Now playing', `▶️ **${next.title}**`)] }).catch(() => {});
    }
    return true;
  } catch (err) {
    if (err.message === VOICE_NOT_READY) {
      // Join failure, not a bad track: clear the phantom "playing" entry,
      // tell the text channel plainly, and destroy the dead queue — do not
      // post "Now playing", do not count the song, do not try the next track
      // (it would fail the same way).
      errorLogger.log({ level: 'error', guildId, commandName: 'play', message: `Voice connection not ready for ${next.url} — join failed` });
      queue.playing = null;
      if (queue.textChannel) queue.textChannel.send({ embeds: [errorEmbed('Could not join voice', `⚠️ ${JOIN_FAILED_REASON}`)] }).catch(() => {});
      destroyQueue(guildId);
      return 'voice-failed';
    }
    errorLogger.log({ level: 'error', guildId, commandName: 'play', message: `Failed to play ${next.url}: ${err.message}`, stack: err.stack });
    if (queue.textChannel) queue.textChannel.send({ embeds: [errorEmbed('Playback error', `⚠️ Couldn't play **${next.title}** — skipping it.`)] }).catch(() => {});
    return playNext(guildId);
  }
}

async function addTrack(guildId, voiceChannel, textChannel, query) {
  const maxQueue = (config.music && config.music.maxQueueSize) || 25;
  let queue = queues.get(guildId);
  if (!queue) {
    const created = await createQueue(guildId, voiceChannel, textChannel);
    if (!created.ok) return { added: false, reason: created.reason };
    queue = created.queue;
  }

  if (queue.queue.length >= maxQueue) {
    return { added: false, reason: `Queue is full (max ${maxQueue} tracks).` };
  }

  // Resolve the query: direct URL, Spotify link (looked up on YouTube —
  // Spotify audio itself is never streamed), or a YouTube search via youtube.js.
  let url = query;
  let title = query;
  let durationSec = null;
  let spotifyNote = null;
  if (isSpotifyUrl(query)) {
    const resolved = await resolveSpotifyUrl(query);
    if (!resolved?.query) return { added: false, reason: 'Could not read that Spotify link. Try a Spotify track URL, or search by name instead.' };
    const results = await youtube.search(resolved.query, { limit: 1 });
    if (!results.length) return { added: false, reason: `Could not find "${resolved.title}" on YouTube.` };
    url = results[0].url;
    title = results[0].title || resolved.title;
    durationSec = results[0].durationInSec || null;
    spotifyNote = resolved.kind === 'track'
      ? `Spotify track "${resolved.title}" — matched on YouTube (Spotify audio is not streamed directly).`
      : `Spotify ${resolved.kind} "${resolved.title}" — matched its top YouTube result (playlists/albums can't be expanded without a Spotify API key).`;
  } else if (!/^https?:\/\//i.test(query)) {
    const results = await youtube.search(query, { limit: 1 });
    if (!results.length) return { added: false, reason: `No results found for "${query}".` };
    url = results[0].url;
    title = results[0].title || query;
    durationSec = results[0].durationInSec || null;
  } else {
    const info = await youtube.videoInfo(url).catch(() => null);
    if (info?.title) title = info.title;
    if (info?.durationInSec) durationSec = info.durationInSec;
  }

  const track = { title, url, durationSec, requestedBy: null };
  queue.queue.push(track);
  if (!queue.playing) {
    // Await the start so a failed join is reported to the caller instead of
    // a phantom "Now playing" (1.15.17). Only a voice failure flips the
    // result to added: false — a normal stream failure still returns
    // added: true (the track was queued, it just couldn't play, and the
    // queue moved on to the next track). The queue-gone check covers the
    // race where the connection dropped mid-resolution and the Disconnected
    // handler destroyed the queue under us.
    const started = await playNext(guildId);
    if (started === 'voice-failed' || !queues.get(guildId)) return { added: false, reason: JOIN_FAILED_REASON };
  }
  return { added: true, track, position: queue.queue.length, spotifyNote };
}

// Join (or move to) a voice channel without playing anything, for /music
// join. Reuses the same fixed join path as addTrack: permission check,
// await Ready, clear error on failure. Returns
// { joined: true, already?: boolean, moved?: boolean } or
// { joined: false, reason }.
async function joinVoice(guildId, voiceChannel, textChannel) {
  const existing = queues.get(guildId);
  if (existing) {
    const currentChannelId = existing.connection.joinConfig?.channelId;
    const status = existing.connection.state.status;
    if (currentChannelId === voiceChannel.id && status === VoiceConnectionStatus.Ready) {
      existing.textChannel = textChannel;
      return { joined: true, already: true };
    }
    if (status === VoiceConnectionStatus.Destroyed) {
      destroyQueue(guildId);
    } else {
      // Move the existing connection (joinVoiceChannel reuses it and sends
      // the move payload; the player stays subscribed). Same guards as a
      // fresh join.
      if (!hasVoicePerms(voiceChannel)) return { joined: false, reason: NO_VOICE_PERMS_REASON };
      try {
        joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        await entersState(existing.connection, VoiceConnectionStatus.Ready, 10_000);
      } catch {
        return { joined: false, reason: JOIN_FAILED_REASON };
      }
      existing.textChannel = textChannel;
      return { joined: true, moved: true };
    }
  }
  const created = await createQueue(guildId, voiceChannel, textChannel);
  if (!created.ok) return { joined: false, reason: created.reason };
  return { joined: true, moved: false };
}

// Current track + progress for /nowplaying. Returns null when idle.
function getNowPlaying(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.playing) return null;
  const elapsedSec = queue.playingStartedAt ? Math.floor((Date.now() - queue.playingStartedAt) / 1000) : 0;
  return {
    track: queue.playing,
    elapsedSec,
    durationSec: queue.playing.durationSec || null,
    queueLength: queue.queue.length,
    filter: queue.filter || 'off',
  };
}

// Set the audio filter; restarts the current track from the beginning with
// the filter applied (filters need re-encoding — see musicFilters.js).
function applyFilter(guildId, filter) {
  const queue = queues.get(guildId);
  if (!queue || !queue.playing) return false;
  queue.filter = filter;
  const current = queue.playing;
  queue.queue.unshift(current);
  queue.player.stop(); // Idle -> playNext() replays it, now filtered.
  return true;
}

function setFilterOnly(guildId, filter) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.filter = filter;
  return true;
}

function skip(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.playing) return false;
  queue.player.stop();
  return true;
}

function stop(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.queue = [];
  queue.player.stop();
  destroyQueue(guildId);
  return true;
}

function pause(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.playing) return false;
  return queue.player.pause();
}

function resume(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.playing) return false;
  return queue.player.unpause();
}

function destroyQueue(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;
  try { queue.player.stop(); } catch {}
  try { queue.connection.destroy(); } catch {}
  queues.delete(guildId);
}

function clearQueue(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return 0;
  const cleared = queue.queue.length;
  queue.queue = [];
  return cleared;
}

module.exports = { getQueue, addTrack, joinVoice, skip, stop, pause, resume, destroyQueue, getNowPlaying, applyFilter, setFilterOnly, clearQueue };

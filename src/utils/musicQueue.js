// Per-guild music queue manager built on @discordjs/voice + play-dl.
const errorLogger = require('./errorLogger');
// One queue per guild: { connection, player, queue: [], textChannel, playing }.
// play-dl handles search + streaming; no API keys are needed for it.
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const playdl = require('play-dl');
const db = require('./database');
const { infoEmbed, errorEmbed } = require('./embeds');
const config = require('./config');
const { isSpotifyUrl, resolveSpotifyUrl } = require('./spotify');
const { filterArgs } = require('./musicFilters');
const { StreamType } = require('@discordjs/voice');

const queues = new Map();

function getQueue(guildId) {
  return queues.get(guildId);
}

function createQueue(guildId, voiceChannel, textChannel) {
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
    destroyQueue(guildId);
  });

  return queue;
}

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;
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
    return;
  }
  queue.playing = next;
  queue.playingStartedAt = Date.now();
  try {
    const stream = await playdl.stream(next.url);
    const args = filterArgs(queue.filter);
    let resource;
    if (args) {
      // Filter on: re-encode the track through FFmpeg with the filter.
      // prism-media pipes the source stream through ffmpeg; on failure we
      // fall back to the unfiltered stream below.
      try {
        const { FFmpeg } = require('prism-media');
        const ffmpegArgs = ['-analyzeduration', '0', '-loglevel', '0'];
        if (stream.type === 'opus') ffmpegArgs.push('-f', 'opus');
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
    db.incrementSongsPlayed(guildId);
    if (queue.textChannel) {
      queue.textChannel.send({ embeds: [infoEmbed('Now playing', `▶️ **${next.title}**`)] }).catch(() => {});
    }
  } catch (err) {
    errorLogger.log({ level: 'error', guildId, commandName: 'play', message: `Failed to play ${next.url}: ${err.message}`, stack: err.stack });
    if (queue.textChannel) queue.textChannel.send({ embeds: [errorEmbed('Playback error', `⚠️ Couldn't play **${next.title}** — skipping it.`)] }).catch(() => {});
    playNext(guildId);
  }
}

async function addTrack(guildId, voiceChannel, textChannel, query) {
  const maxQueue = (config.music && config.music.maxQueueSize) || 25;
  let queue = queues.get(guildId);
  if (!queue) queue = createQueue(guildId, voiceChannel, textChannel);

  if (queue.queue.length >= maxQueue) {
    return { added: false, reason: `Queue is full (max ${maxQueue} tracks).` };
  }

  // Resolve the query: direct URL, Spotify link (looked up on YouTube —
  // Spotify audio itself is never streamed), or a YouTube search via play-dl.
  let url = query;
  let title = query;
  let durationSec = null;
  let spotifyNote = null;
  if (isSpotifyUrl(query)) {
    const resolved = await resolveSpotifyUrl(query);
    if (!resolved?.query) return { added: false, reason: 'Could not read that Spotify link. Try a Spotify track URL, or search by name instead.' };
    const results = await playdl.search(resolved.query, { limit: 1 });
    if (!results.length) return { added: false, reason: `Could not find "${resolved.title}" on YouTube.` };
    url = results[0].url;
    title = results[0].title || resolved.title;
    durationSec = results[0].durationInSec || null;
    spotifyNote = resolved.kind === 'track'
      ? `Spotify track "${resolved.title}" — matched on YouTube (Spotify audio is not streamed directly).`
      : `Spotify ${resolved.kind} "${resolved.title}" — matched its top YouTube result (playlists/albums can't be expanded without a Spotify API key).`;
  } else if (!/^https?:\/\//i.test(query)) {
    const results = await playdl.search(query, { limit: 1 });
    if (!results.length) return { added: false, reason: `No results found for "${query}".` };
    url = results[0].url;
    title = results[0].title || query;
    durationSec = results[0].durationInSec || null;
  } else {
    const info = await playdl.video_info(url).catch(() => null);
    if (info?.video_details?.title) title = info.video_details.title;
    if (info?.video_details?.durationInSec) durationSec = info.video_details.durationInSec;
  }

  const track = { title, url, durationSec, requestedBy: null };
  queue.queue.push(track);
  if (!queue.playing) playNext(guildId);
  return { added: true, track, position: queue.queue.length, spotifyNote };
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

module.exports = { getQueue, addTrack, skip, stop, pause, resume, destroyQueue, getNowPlaying, applyFilter, setFilterOnly, clearQueue };

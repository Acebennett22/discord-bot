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
  const queue = { connection, player, queue: [], textChannel, playing: null };
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
    setTimeout(() => {
      const q = queues.get(guildId);
      if (q && !q.playing && q.queue.length === 0) destroyQueue(guildId);
    }, 60_000);
    return;
  }
  queue.playing = next;
  try {
    const stream = await playdl.stream(next.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
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

  // Resolve the query: direct URL, or a YouTube search via play-dl.
  let url = query;
  let title = query;
  if (!/^https?:\/\//i.test(query)) {
    const results = await playdl.search(query, { limit: 1 });
    if (!results.length) return { added: false, reason: `No results found for "${query}".` };
    url = results[0].url;
    title = results[0].title || query;
  } else {
    const info = await playdl.video_info(url).catch(() => null);
    if (info?.video_details?.title) title = info.video_details.title;
  }

  const track = { title, url };
  queue.queue.push(track);
  if (!queue.playing) playNext(guildId);
  return { added: true, track, position: queue.queue.length };
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

module.exports = { getQueue, addTrack, skip, stop, pause, resume, destroyQueue };

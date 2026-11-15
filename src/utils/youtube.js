// YouTube search + streaming via @distube/ytdl-core.
//
// Replaces play-dl (removed in 1.15.11): play-dl 1.9.7 is unmaintained and its
// extraction is broken against current YouTube — `video_info()` fails with
// "socket hang up" and `stream()` fails with "Invalid URL" on every video
// (verified Nov 15, 2026 on Seven Nation Army + 2 controls). @distube/ytdl-core
// v5 works on all three, including search.
//
// The adapter keeps the small surface musicQueue.js used from play-dl, so the
// command interface, queue behavior, and error messages are unchanged:
//   search(query, { limit }) -> [{ url, title, durationInSec, id }]
//   videoInfo(url)           -> { title, durationInSec } (nulls on failure)
//   stream(url)              -> { stream, type, ffmpegInputFormat }
//     type is a @discordjs/voice StreamType: WebmOpus for opus-in-webm
//     (played natively, no ffmpeg), OggOpus for opus-in-ogg, Arbitrary for
//     everything else (m4a/aac — @discordjs/voice transcodes via ffmpeg).
//     ffmpegInputFormat tells the filter path what container to demux the
//     piped stream as; null means let ffmpeg probe.
const { Ytdl } = require('@distube/ytdl-core');
const { StreamType } = require('@discordjs/voice');

const yt = new Ytdl();

// Highest-bitrate opus audio-only format first (itag 251 on most videos) so
// playback is native Opus; otherwise the highest-bitrate audio-only format.
function pickAudioFormat(info) {
  const audio = info.formats.filter((f) => f.hasAudio && !f.hasVideo);
  if (!audio.length) return null;
  const byBitrate = (a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0);
  const opus = audio.filter((f) => /opus/i.test(f.mimeType || '')).sort(byBitrate);
  if (opus.length) return opus[0];
  return audio.sort(byBitrate)[0];
}

function streamTypeFor(format) {
  if (/opus/i.test(format.mimeType || '')) {
    return format.container === 'webm' ? StreamType.WebmOpus : StreamType.OggOpus;
  }
  return StreamType.Arbitrary;
}

function ffmpegInputFormat(format) {
  if (format.container === 'webm') return 'matroska'; // WebM is a Matroska subset
  if (format.container === 'ogg') return 'ogg';
  return null;
}

async function search(query, { limit = 1 } = {}) {
  const results = await yt.search(query, { limit });
  return results.map((r) => ({ url: r.url, title: r.title, durationInSec: r.lengthSeconds || null, id: r.id }));
}

async function videoInfo(url) {
  const info = await yt.getInfo(url);
  return {
    title: info.videoDetails.title,
    durationInSec: Number(info.videoDetails.lengthSeconds) || null,
  };
}

async function stream(url) {
  const info = await yt.getInfo(url);
  const format = pickAudioFormat(info);
  if (!format) throw new Error('No audio format found for this video.');
  const s = yt.download(info, { format });
  return { stream: s, type: streamTypeFor(format), ffmpegInputFormat: ffmpegInputFormat(format) };
}

module.exports = { search, videoInfo, stream };

// Lyrics via the free lyrics.ovh API (https://lyricsovh.docs.apiary.io) —
// no API key needed. Returns { lyrics } or { error }.
async function fetchLyrics(artist, title) {
  if (!artist || !title) return { error: 'Need an artist and a song title.' };
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return { error: 'Could not reach the lyrics service — try again in a bit.' };
  }
  if (!res.ok) return { error: 'No lyrics found for that song.' };
  const data = await res.json().catch(() => null);
  if (!data?.lyrics?.trim()) return { error: 'No lyrics found for that song.' };
  return { lyrics: data.lyrics.trim() };
}

// Split "Artist - Title" style YouTube titles; returns { artist, title }
// or null when there's no separator to split on.
function splitArtistTitle(videoTitle) {
  if (!videoTitle) return null;
  const m = /^\s*(.+?)\s*[-–—]\s*(.+?)\s*$/.exec(videoTitle);
  if (!m) return null;
  return { artist: m[1], title: m[2] };
}

module.exports = { fetchLyrics, splitArtistTitle };

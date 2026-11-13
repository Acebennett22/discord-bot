// Spotify link resolution — lookup only, NOT Spotify audio streaming.
// There is no public Spotify audio API, so a Spotify track URL is resolved
// to its title + artist via Spotify's public oEmbed endpoint (no key),
// then the same track is found on YouTube with play-dl search. A playlist
// URL only gives the playlist name, so it resolves to the top YouTube
// result for that name — stated honestly in the README.
async function resolveSpotifyUrl(url) {
  if (!/open\.spotify\.com\//i.test(url)) return null;
  let data = null;
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'AceBot/1.2.7' },
    });
    if (res.ok) data = await res.json().catch(() => null);
  } catch {}
  if (!data?.title) return { kind: 'unknown', query: null };
  const isPlaylist = /\/playlist\//i.test(url);
  const isAlbum = /\/album\//i.test(url);
  if (isPlaylist || isAlbum) {
    return { kind: isPlaylist ? 'playlist' : 'album', query: data.title, title: data.title, artist: data.author_name || '' };
  }
  return { kind: 'track', query: `${data.title} ${data.author_name || ''}`.trim(), title: data.title, artist: data.author_name || '' };
}

function isSpotifyUrl(query) {
  return /open\.spotify\.com\//i.test(query);
}

module.exports = { resolveSpotifyUrl, isSpotifyUrl };

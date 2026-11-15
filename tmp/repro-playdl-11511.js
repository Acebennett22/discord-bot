// Repro for 1.15.11: test play-dl search + stream for the exact video Ace
// reported failing, plus 2 other ordinary YouTube videos.
const playdl = require('play-dl');

const TESTS = [
  { label: 'Seven Nation Army (reported failing)', query: 'The White Stripes - Seven Nation Army (Official Music Video)' },
  { label: 'Control 1', query: 'Rick Astley - Never Gonna Give You Up (Official Video)' },
  { label: 'Control 2', query: 'Daft Punk - Get Lucky (Official Audio)' },
];

(async () => {
  for (const t of TESTS) {
    try {
      const results = await playdl.search(t.query, { limit: 1 });
      if (!results.length) { console.log(`[${t.label}] SEARCH: no results`); continue; }
      const v = results[0];
      console.log(`[${t.label}] SEARCH OK: ${v.title} | ${v.url} | id=${v.id}`);
      try {
        const info = await playdl.video_info(v.url).catch((e) => ({ __err: e.message }));
        if (info.__err) console.log(`[${t.label}] video_info FAILED: ${info.__err}`);
        else console.log(`[${t.label}] video_info OK: title="${info.video_details.title}" duration=${info.video_details.durationInSec}s`);
      } catch (e) { console.log(`[${t.label}] video_info THREW: ${e.message}`); }
      try {
        const stream = await playdl.stream(v.url);
        console.log(`[${t.label}] STREAM OK: type=${stream.type} streamType=${typeof stream.stream}`);
        stream.stream.destroy();
      } catch (e) {
        console.log(`[${t.label}] STREAM FAILED: ${e.constructor.name}: ${e.message}`);
      }
    } catch (e) {
      console.log(`[${t.label}] SEARCH FAILED: ${e.constructor.name}: ${e.message}`);
    }
  }
  process.exit(0);
})();

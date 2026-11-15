// Verify the 1.15.11 adapter (src/utils/youtube.js) end-to-end: search +
// videoInfo + stream for the exact video Ace reported failing, plus 2
// controls. Proves extraction works through the code the bot will use.
const youtube = require('../src/utils/youtube');

const TESTS = [
  { label: 'Seven Nation Army (reported failing)', query: 'The White Stripes - Seven Nation Army (Official Music Video)' },
  { label: 'Control 1', query: 'Rick Astley - Never Gonna Give You Up (Official Video)' },
  { label: 'Control 2', query: 'Daft Punk - Get Lucky (Official Audio)' },
];

(async () => {
  let pass = 0;
  for (const t of TESTS) {
    try {
      const [r] = await youtube.search(t.query, { limit: 1 });
      if (!r) { console.log(`[${t.label}] SEARCH: no results`); continue; }
      console.log(`[${t.label}] SEARCH OK: "${r.title}" | ${r.url} | duration=${r.durationInSec}s`);
      const info = await youtube.videoInfo(r.url);
      console.log(`[${t.label}] videoInfo OK: "${info.title}" duration=${info.durationInSec}s`);
      const s = await youtube.stream(r.url);
      const chunk = await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('stream timeout 15s')), 15000);
        s.stream.once('data', (c) => { clearTimeout(to); resolve(c); });
        s.stream.once('error', (e) => { clearTimeout(to); reject(e); });
      });
      console.log(`[${t.label}] STREAM OK: type=${s.type} ffmpegInputFormat=${s.ffmpegInputFormat} first chunk=${chunk.length} bytes`);
      s.stream.destroy();
      pass++;
    } catch (e) {
      console.log(`[${t.label}] FAILED: ${e.constructor.name}: ${e.message}`);
    }
  }
  console.log(`\n${pass}/${TESTS.length} videos fully OK through the adapter`);
  process.exit(pass === TESTS.length ? 0 : 1);
})();

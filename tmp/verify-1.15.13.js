// Verify the 1.15.13 hotfix: youtube.js must load under Node-20 behavior,
// where require(esm) is disabled. Run with:
//   node --no-experimental-require-module tmp/verify-1.15.13.js
// (a) plain CommonJS require() of youtube.js succeeds — no ERR_REQUIRE_ESM;
// (b) live search + stream still works through the lazy dynamic import()
//     (Seven Nation Army, the reported video, + 1 control).
const youtube = require('../src/utils/youtube');

(async () => {
  const checks = [];
  const ok = (name, cond) => { checks.push([name, !!cond]); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); };

  ok('youtube.js requires cleanly (no ERR_REQUIRE_ESM)', true);
  ok('exports search/videoInfo/stream', typeof youtube.search === 'function' && typeof youtube.videoInfo === 'function' && typeof youtube.stream === 'function');

  for (const [label, query] of [
    ['Seven Nation Army (reported video)', 'The White Stripes - Seven Nation Army (Official Music Video)'],
    ['Control', 'Daft Punk - Get Lucky (Official Audio)'],
  ]) {
    try {
      const [r] = await youtube.search(query, { limit: 1 });
      if (!r) throw new Error('no search results');
      const info = await youtube.videoInfo(r.url);
      const s = await youtube.stream(r.url);
      const chunk = await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('stream timeout 15s')), 15000);
        s.stream.once('data', (c) => { clearTimeout(to); resolve(c); });
        s.stream.once('error', (e) => { clearTimeout(to); reject(e); });
      });
      s.stream.destroy();
      ok(`${label}: search + videoInfo + stream (${info.title.slice(0, 40)}…, first chunk=${chunk.length} bytes)`, chunk.length > 0);
    } catch (e) {
      ok(`${label}: ${e.constructor.name}: ${e.message}`, false);
    }
  }

  const failed = checks.filter(([, c]) => !c).length;
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL 1.15.13 CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();

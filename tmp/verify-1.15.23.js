// Verify 1.15.23: dashboard streamer delete actually deletes + Streams table CSS.
// - DELETE /api/guilds/:id/streamers/:streamerId handler is exercised with a
//   mocked db (extracted from dashboard.js and eval'd — the dashboard module
//   self-boots a server on require, so it cannot be required in-process).
// - requireAuth: /api/* gets 401 JSON when signed out (no silent redirect to
//   the HTML login page, which fetch followed and read as success).
// - Streams table renders with the 1.15.14-analogous treatment; Staff Errors
//   table is unchanged.
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..');
const DASH = path.join(ROOT, 'src', 'dashboard.js');
const SETTINGS_EJS = path.join(ROOT, 'dashboard', 'views', 'settings.ejs');
const STAFF_EJS = path.join(ROOT, 'dashboard', 'views', 'staff.ejs');
const APP_JS = path.join(ROOT, 'dashboard', 'public', 'app.js');
const SETTINGS_JS = path.join(ROOT, 'dashboard', 'public', 'js', 'settings.js');
const CSS = path.join(ROOT, 'dashboard', 'public', 'style.css');

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

const dashSrc = fs.readFileSync(DASH, 'utf8');

// --- Extract a top-level function/handler from dashboard.js and eval it ----
function extractFn(src, regex, label) {
  const m = src.match(regex);
  if (!m) { check(`${label}: found in dashboard.js`, false); return null; }
  check(`${label}: found in dashboard.js`, true);
  return m[1];
}

function mockRes() {
  const res = { _code: 200, _json: null, _redirect: null };
  res.status = (c) => { res._code = c; return res; };
  res.json = (o) => { res._json = o; return res; };
  res.redirect = (u) => { res._redirect = u; return res; };
  return res;
}

(async () => {
  // === (a) DELETE streamers route ==========================================
  const handlerSrc = extractFn(dashSrc,
    /app\.delete\('\/api\/guilds\/:id\/streamers\/:streamerId', requireAuth, requireGuildAccess, (async \(req, res\) => \{[\s\S]*?\n\})\);/,
    'DELETE streamers route (requireAuth + requireGuildAccess)');
  check('DELETE route SQL deletes by id AND guild_id',
    /DELETE FROM streamers WHERE id = \? AND guild_id = \?/.test(dashSrc));
  check('DELETE route returns 404 when nothing matches',
    /if \(!result\.affectedRows\) return res\.status\(404\)\.json\(\{ error: 'Streamer not found\.' \}\);/.test(dashSrc));
  check('DELETE route returns 503 when the query itself fails',
    /if \(!result\) return res\.status\(503\)\.json\(\{ error: 'Database unavailable\.' \}\);/.test(dashSrc));

  if (handlerSrc) {
    async function runHandler(dbResult) {
      let captured = null;
      const db = {
        isEnabled: () => true,
        query: async (sql, params) => { captured = { sql, params }; return dbResult; },
      };
      // eslint-disable-next-line no-eval
      const handler = eval(`(${handlerSrc})`);
      const req = { params: { id: '1571439343976058970', streamerId: '7' } };
      const res = mockRes();
      await handler(req, res);
      return { res, captured };
    }

    const ok1 = await runHandler({ affectedRows: 1 });
    check('delete matching row: 200 {ok:true}', ok1.res._code === 200 && ok1.res._json && ok1.res._json.ok === true);
    check('delete passes streamer id AND guild id as params',
      JSON.stringify(ok1.captured.params) === JSON.stringify(['7', '1571439343976058970']),
      JSON.stringify(ok1.captured && ok1.captured.params));
    check('delete SQL is scoped to this guild (a row from another guild is untouched)',
      /WHERE id = \? AND guild_id = \?/.test(ok1.captured.sql));

    const miss = await runHandler({ affectedRows: 0 });
    check('delete missing row: 404 Streamer not found',
      miss.res._code === 404 && miss.res._json && miss.res._json.error === 'Streamer not found.');

    const down = await runHandler(null);
    check('delete with failed query: 503 Database unavailable',
      down.res._code === 503 && down.res._json && /Database unavailable/.test(down.res._json.error));
  }

  // === (a2) requireAuth: API calls get 401 JSON, pages keep the redirect ===
  const authSrc = extractFn(dashSrc, /(function requireAuth\(req, res, next\) \{[\s\S]*?\n\})/, 'requireAuth');
  if (authSrc) {
    // eslint-disable-next-line no-eval
    const requireAuth = eval(`(${authSrc})`);
    const apiRes = mockRes();
    let nextCalled = false;
    requireAuth({ path: '/api/guilds/123/streamers/7', session: {} }, apiRes, () => { nextCalled = true; });
    check('requireAuth: signed-out API call gets 401 JSON, not a redirect',
      apiRes._code === 401 && apiRes._json && /log in again/.test(apiRes._json.error) && apiRes._redirect === null);
    const pageRes = mockRes();
    requireAuth({ path: '/guilds/123/streams', session: {} }, pageRes, () => {});
    check('requireAuth: signed-out page still redirects to /login',
      pageRes._redirect === '/login' && pageRes._code === 200);
    const okRes = mockRes();
    let okNext = false;
    requireAuth({ path: '/api/guilds/123/streamers/7', session: { user: { id: '1' } } }, okRes, () => { okNext = true; });
    check('requireAuth: signed-in request calls next()', okNext);
  }

  // === (a3) client-side guards ==============================================
  const appJs = fs.readFileSync(APP_JS, 'utf8');
  check('app.js: non-JSON 200s are refused (assertJson guard)',
    /function assertJson\(res\)/.test(appJs) && /Unexpected response from the server/.test(appJs));
  check('app.js: del() uses the guard', /async function del\(url\) \{[\s\S]*?assertJson\(res\);/.test(appJs));
  check('app.js: postJSON()/getJSON() use the guard',
    /async function postJSON[\s\S]*?assertJson\(res\);/.test(appJs) && /async function getJSON[\s\S]*?assertJson\(res\);/.test(appJs));
  const settingsJs = fs.readFileSync(SETTINGS_JS, 'utf8');
  check('settings.js: Remove calls DELETE /streamers/:id',
    /AceBot\.del\(api\(`\/streamers\/\$\{rmStreamer\.dataset\.removeStreamer\}`\)\);/.test(settingsJs));
  check('settings.js: delete also removes the hidden edit row',
    /document\.getElementById\('edit-row-' \+ rmStreamer\.dataset\.removeStreamer\)\?\.remove\(\);/.test(settingsJs));

  // === (c) Streams table markup =============================================
  const settingsFixture = (module, streamers, channels, roles) => ({
    user: { username: 'Ace', id: '1' }, guild: { id: '123', name: 'Test Guild', icon: null }, module, settings: {},
    channels, roles, streamers, tickets: [], gameServers: [], applicationForms: [], pendingApplications: [],
    inviteLeaderboard: [], inviteStats: [], automodSettings: null, automodActions: [], suggestions: [], premiumSettings: null,
    shopItems: [], customCommands: [], faqs: [], scheduledMessages: [], countingSettings: null, birthdays: [],
    reactionRoleMappings: [], analyticsData: null, giveaways: [], aiUsage: null, aiConfigured: false, mcWidgets: [],
    voiceStats: [], voiceRate: null, colorRoles: [], modmailThreads: [], modmailBlocks: [], playlists: [],
    triviaSettings: null, triviaLeaderboard: [], roleMenus: [], milestoneSettings: null, milestoneNext: null,
    translateSettings: null, ticketPanels: [], inviteRoleRules: [], prestigeLeaderboard: [], countdowns: [], emojis: [],
    workJobs: [], recentRobs: [], tempBans: [], lotteryStatus: null, lotteryDraws: [], serverRules: null,
    inviteUrl: 'https://example.invalid/invite', saved: false, isStaff: false, commandCatalog: [],
    scheduledEventsList: [], wordleLeaderboard: [], wordleToday: null, slowmodeSchedules: [], statusRoleRules: [],
    builtEmbeds: [], pastPolls: [], ticketRatingStats: null, inviteRewardList: [], inactiveMembers: null,
    commandToggles: [], threadOverrides: [], pendingConfessions: [], tempRoles: [], xpShopItems: [],
  });
  const channels = [
    { id: '111', name: 'announcements', type: 0 },
    { id: '222', name: 'a-very-long-channel-name-for-ellipsis', type: 0 },
    { id: '333', name: 'General Voice', type: 2 },
  ];
  const roles = [
    { id: '444', name: 'Raven’s Herald' },
    { id: '555', name: 'A Very Long Role Name That Ellipsizes' },
  ];
  const streamers = [
    { id: 7, platform: 'twitch', channel_id_or_name: 'a_very_long_streamer_name_that_should_ellipsize', notify_channel_id: '222', ping_role_id: '555', live_channel_id: '333', is_live: 1, include_clip: 1 },
    { id: 8, platform: 'youtube', channel_id_or_name: 'UCxxxxxxxxxxxxxxxxxxxx', notify_channel_id: '111', ping_role_id: null, live_channel_id: null, is_live: 0, include_clip: 0 },
    { id: 9, platform: 'kick', channel_id_or_name: 'kickstreamer', notify_channel_id: null, ping_role_id: null, live_channel_id: null, is_live: 0, include_clip: 1 },
  ];
  let html = '';
  try {
    html = ejs.render(fs.readFileSync(SETTINGS_EJS, 'utf8'),
      settingsFixture('streams', streamers, channels, roles), { filename: SETTINGS_EJS });
    check('settings/streams: renders without throwing', html.length > 1000);
  } catch (e) { check(`settings/streams: renders (${e.message})`, false); }

  check('streams table has streams-table class + colgroup',
    /<table class="streams-table"><colgroup>/.test(html) && /<col class="c-actions">/.test(html));
  check('streams table wrapped in .table-scroll',
    /<div class="table-scroll">\s*<table class="streams-table">/.test(html));
  check('platform is a badge (twitch/youtube/kick)',
    /<span class="badge platform-twitch">twitch<\/span>/.test(html)
    && /<span class="badge platform-youtube">youtube<\/span>/.test(html)
    && /<span class="badge platform-kick">kick<\/span>/.test(html));
  check('streamer name cell has full name in title tooltip + ellipsis class',
    /<td class="s-name" title="a_very_long_streamer_name_that_should_ellipsize">/.test(html));
  check('notify/ping/live-channel cells have title tooltips + ellipsis classes',
    /<td class="s-notify" title="#a-very-long-channel-name-for-ellipsis">/.test(html)
    && /<td class="s-ping" title="@A Very Long Role Name That Ellipsizes">/.test(html)
    && /<td class="s-livechan" title="#General Voice">/.test(html));
  check('live dot cell has Live/Offline title',
    /<td class="s-live" title="Live">🔴<\/td>/.test(html) && /<td class="s-live" title="Offline">⚫<\/td>/.test(html));
  check('delete button calls out the streamer id',
    /data-remove-streamer="7"/.test(html) && /data-remove-streamer="8"/.test(html));
  check('edit row colspan is 8 (matches the 8 columns)',
    /<tr id="edit-row-7" style="display:none"><td colspan="8">/.test(html));
  check('refresh/edit/clip controls intact',
    /data-refresh-streamer="7"/.test(html) && /data-edit-streamer="7"/.test(html) && /data-clip-toggle="7"/.test(html));
  check('add-streamer form intact', /id="add-streamer-form"/.test(html) && /id="streamer-result"/.test(html));

  const empty = ejs.render(fs.readFileSync(SETTINGS_EJS, 'utf8'),
    settingsFixture('streams', [], channels, roles), { filename: SETTINGS_EJS });
  check('streams empty state renders', /None yet — add one below/.test(empty));

  // === (d) Staff Errors unchanged ===========================================
  const rows = [
    { id: 101, level: 'error', shard_id: 0, command_name: 'music play', user_id: '1', message: 'TypeError [ERR_INVALID_URL]: Invalid URL at stream_from_info — the YouTube extractor returned no playable formats for this video, so playback was skipped and the queue advanced to the next track in line.', created_at: new Date('2026-11-15T23:31:11Z'), resolved: false },
    { id: 100, level: 'warn', shard_id: 0, command_name: 'translate', user_id: '1', message: 'settings.channels.includes is not a function', created_at: new Date('2026-11-15T23:10:05Z'), resolved: true },
  ];
  const staffHtml = ejs.render(fs.readFileSync(STAFF_EJS, 'utf8'), {
    user: { username: 'tester' }, section: 'errors',
    data: { errors: rows, filters: { level: '', command: '', shard: '' } },
    isStaff: true, inviteUrl: 'https://example.invalid/invite', saved: false,
  }, { filename: STAFF_EJS });
  check('staff/errors: still renders with errors-table + colgroup',
    /<table class="errors-table"><colgroup>/.test(staffHtml) && /<col class="c-when">/.test(staffHtml));
  check('staff/errors: level badges intact',
    /<span class="badge level-error">error<\/span>/.test(staffHtml) && /<span class="badge level-warn">warn<\/span>/.test(staffHtml));
  check('staff/errors: compact WHEN + message ellipsis intact',
    /<td class="when" title="[^"]+">2026-11-15 23:31<\/td>/.test(staffHtml) && /<span class="msg-text">TypeError/.test(staffHtml));
  check('staff/errors: purge hooks intact',
    /id="purge-selected-errors" disabled/.test(staffHtml) && /id="select-all-errors"/.test(staffHtml));

  // === CSS rules =============================================================
  const css = fs.readFileSync(CSS, 'utf8');
  check('CSS: streams-table fixed layout', /\.streams-table\{table-layout:fixed;width:100%\}/.test(css));
  check('CSS: streams colgroup widths (live 26, platform 88, clips 52, actions 190)',
    /\.streams-table col\.c-live\{width:26px\}/.test(css) && /\.streams-table col\.c-platform\{width:88px\}/.test(css)
    && /\.streams-table col\.c-clips\{width:52px\}/.test(css) && /\.streams-table col\.c-actions\{width:190px\}/.test(css));
  check('CSS: streams compact rows + middle alignment',
    /\.streams-table th,\.streams-table td\{padding:6px 8px;vertical-align:middle\}/.test(css));
  check('CSS: streams ellipsis cells',
    /\.streams-table td\.s-name,\.streams-table td\.s-notify,\.streams-table td\.s-ping,\.streams-table td\.s-livechan\{white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/.test(css));
  check('CSS: platform badges (twitch/youtube/kick/facebook/tiktok)',
    /\.badge\.platform-twitch\{/.test(css) && /\.badge\.platform-youtube\{/.test(css) && /\.badge\.platform-kick\{/.test(css)
    && /\.badge\.platform-facebook\{/.test(css) && /\.badge\.platform-tiktok\{/.test(css));
  check('CSS: errors-table rules untouched',
    /\.errors-table\{table-layout:fixed;width:100%\}/.test(css) && /\.errors-table col\.c-when\{width:132px\}/.test(css));
  check('CSS: level badges untouched',
    /\.badge\.level-error\{/.test(css) && /\.badge\.level-warn\{/.test(css) && /\.badge\.level-info\{/.test(css));
  check('CSS: table-scroll wrapper still shared', /\.table-scroll\{overflow-x:auto/.test(css));
  check('CSS: disabled-button rule still present',
    /\.btn:disabled,\.btn:disabled:hover\{opacity:.45;cursor:not-allowed/.test(css));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('VERIFY CRASH:', e); process.exit(1); });

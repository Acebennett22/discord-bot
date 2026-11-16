// Verify 1.15.24: dashboard Streams live-announcement preview.
// - GET /api/guilds/:id/streamers/:streamerId/preview returns the exact
//   message content + embed JSON the notifier would send (same liveEmbed /
//   addClipField code path), with clearly-marked SAMPLE data, 404s for an
//   unknown id or another guild's row, 503 when the DB is down.
// - The preview path performs no Discord send (source check + no send
//   function is reachable from the handler).
// - The Streams table renders with its 1.15.23 classes, a Preview button
//   per row, and the preview panel; Staff Errors is unchanged.
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
// The dashboard sets this before requiring config (see src/dashboard.js);
// without it, config.js exits the process on the placeholder token.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const ROOT = path.join(__dirname, '..');
const DASH = path.join(ROOT, 'src', 'dashboard.js');
const NOTIFIER = path.join(ROOT, 'src', 'utils', 'streamNotifier');
const SETTINGS_EJS = path.join(ROOT, 'dashboard', 'views', 'settings.ejs');
const STAFF_EJS = path.join(ROOT, 'dashboard', 'views', 'staff.ejs');
const SETTINGS_JS = path.join(ROOT, 'dashboard', 'public', 'js', 'settings.js');
const CSS = path.join(ROOT, 'dashboard', 'public', 'style.css');
const THUMB = path.join(ROOT, 'dashboard', 'public', 'img', 'stream-preview-thumbnail.svg');

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

const dashSrc = fs.readFileSync(DASH, 'utf8');
const notifierSrc = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'streamNotifier.js'), 'utf8');

function mockRes() {
  const res = { _code: 200, _json: null, _redirect: null };
  res.status = (c) => { res._code = c; return res; };
  res.json = (o) => { res._json = o; return res; };
  res.redirect = (u) => { res._redirect = u; return res; };
  return res;
}

function extractFn(src, regex, label) {
  const m = src.match(regex);
  if (!m) { check(`${label}: found in dashboard.js`, false); return null; }
  check(`${label}: found in dashboard.js`, true);
  return m[1];
}

(async () => {
  // === shared builder is really shared ======================================
  check('streamNotifier exports liveEmbed + addClipField',
    /module\.exports = \{[^}]*liveEmbed[^}]*addClipField[^}]*\}/.test(notifierSrc));
  check('checkAllStreams attaches clips via addClipField (not an inline copy)',
    /if \(clip\) addClipField\(embed, clip\);/.test(notifierSrc)
    && (notifierSrc.match(/embed\.addFields\(\{ name: clip\.type/g) || []).length === 1);

  // === (a)+(b) preview route =================================================
  const handlerSrc = extractFn(dashSrc,
    /app\.get\('\/api\/guilds\/:id\/streamers\/:streamerId\/preview', requireAuth, requireGuildAccess, (async \(req, res\) => \{[\s\S]*?\n\})\);/,
    'GET preview route (requireAuth + requireGuildAccess)');
  check('preview route loads the row scoped by id AND guild_id',
    /SELECT \* FROM streamers WHERE id = \? AND guild_id = \?/.test(dashSrc));
  check('preview route builds the embed via liveEmbed + addClipField',
    /liveEmbed\(row\.platform, row\.channel_id_or_name, sample\)/.test(dashSrc)
    && /addClipField\(embed, \{ title: 'Sample clip — preview only'/.test(dashSrc));

  const GUILD = '1571439343976058970';
  const rowsById = {
    7: { id: 7, guild_id: GUILD, platform: 'twitch', channel_id_or_name: 'mrrymon84', notify_channel_id: '222', ping_role_id: '444', live_channel_id: null, is_live: 0, include_clip: 1 },
    8: { id: 8, guild_id: GUILD, platform: 'youtube', channel_id_or_name: 'UCxxxxxxxxxxxxxxxxxxxx', notify_channel_id: '111', ping_role_id: null, live_channel_id: null, is_live: 0, include_clip: 0 },
    9: { id: 9, guild_id: GUILD, platform: 'kick', channel_id_or_name: 'kickstreamer', notify_channel_id: null, ping_role_id: null, live_channel_id: null, is_live: 0, include_clip: 1 },
  };
  function mockDb(enabled) {
    return {
      isEnabled: () => enabled,
      query: async (sql, params) => {
        if (!/SELECT \* FROM streamers/.test(sql)) return [];
        const row = rowsById[params[0]];
        return row && row.guild_id === params[1] ? [row] : [];
      },
    };
  }
  const mockGuildChannelsRoles = async () => ({ channels: [], roles: [{ id: '444', name: "Raven's Herald" }] });
  const localRequire = (p) => (p === './utils/streamNotifier' ? require(NOTIFIER) : require(p));

  async function runPreview({ dbEnabled = true, guildId = GUILD, streamerId = '7' } = {}) {
    // eslint-disable-next-line no-eval
    const factory = eval(`(function (require, db, guildChannelsRoles) { return (${handlerSrc}); })`);
    const handler = factory(localRequire, mockDb(dbEnabled), mockGuildChannelsRoles);
    const req = { params: { id: guildId, streamerId }, protocol: 'http', get: (h) => (h === 'host' ? 'localhost:3010' : undefined) };
    const res = mockRes();
    await handler(req, res);
    return res;
  }

  if (handlerSrc) {
    const tw = await runPreview({ streamerId: '7' });
    check('preview twitch row: 200 {ok:true}', tw._code === 200 && tw._json && tw._json.ok === true);
    check('preview content renders the ping role as its name, not a mention',
      tw._json && tw._json.content === "@Raven's Herald 🔴 **mrrymon84** just went live!",
      tw._json && tw._json.content);
    check('preview embed title/description are the sample values',
      tw._json && tw._json.embed.title === '🔴 mrrymon84 is live on Twitch!'
      && tw._json.embed.description === '**Test stream — preview only**');
    check('preview embed has sample Category/Viewers fields + clip field',
      tw._json && Array.isArray(tw._json.embed.fields)
      && tw._json.embed.fields.some((f) => f.name === 'Category' && f.value === 'Just Chatting' && f.inline)
      && tw._json.embed.fields.some((f) => f.name === 'Viewers' && f.value === '123' && f.inline)
      && tw._json.embed.fields.some((f) => f.name === '🎬 Latest clip' && /Sample clip — preview only/.test(f.value)));
    check('preview embed color is the Twitch color + has image + timestamp',
      tw._json && tw._json.embed.color === 0x9146ff
      && tw._json.embed.image && /\/img\/stream-preview-thumbnail\.svg$/.test(tw._json.embed.image.url)
      && !Number.isNaN(Date.parse(tw._json.embed.timestamp || '')));
    check('preview embed title links to the streamer channel',
      tw._json && tw._json.embed.url === 'https://twitch.tv/mrrymon84');

    const yt = await runPreview({ streamerId: '8' });
    check('preview youtube row, no ping role: content has no @mention',
      yt._code === 200 && yt._json && yt._json.content === '🔴 **UCxxxxxxxxxxxxxxxxxxxx** just went live!');
    check('preview youtube row, clips off: no clip field',
      yt._json && !yt._json.embed.fields.some((f) => /clip|video/.test(f.name)));
    check('preview youtube embed color is the YouTube color',
      yt._json && yt._json.embed.color === 0xff0000);

    const kick = await runPreview({ streamerId: '9' });
    check('preview kick row, clips on: still no clip field (notifier never adds one for Kick)',
      kick._code === 200 && kick._json && !kick._json.embed.fields.some((f) => /clip|video/.test(f.name)));

    const miss = await runPreview({ streamerId: '999' });
    check('preview unknown id: 404 Streamer not found',
      miss._code === 404 && miss._json && miss._json.error === 'Streamer not found.');
    const otherGuild = await runPreview({ guildId: '0000000000000000001', streamerId: '7' });
    check("preview another guild's row: 404 (row is scoped to this guild)",
      otherGuild._code === 404 && otherGuild._json && otherGuild._json.error === 'Streamer not found.');
    const down = await runPreview({ dbEnabled: false });
    check('preview with DB down: 503 Database unavailable',
      down._code === 503 && down._json && /Database unavailable/.test(down._json.error));

    // === (b) the route output IS the shared builder's output ================
    const { liveEmbed, addClipField } = require(NOTIFIER);
    const routeEmbed = tw._json.embed;
    const expected = liveEmbed('twitch', 'mrrymon84', {
      title: 'Test stream — preview only', game: 'Just Chatting', viewers: 123,
      url: 'https://twitch.tv/mrrymon84', thumbnail: routeEmbed.image.url,
    });
    addClipField(expected, { title: 'Sample clip — preview only', url: 'https://twitch.tv/mrrymon84', type: 'clip' });
    const expectedJson = expected.toJSON();
    const a = { ...routeEmbed }; const b = { ...expectedJson };
    check('preview embed timestamp is present and parseable', Boolean(a.timestamp) && !Number.isNaN(Date.parse(a.timestamp)));
    delete a.timestamp; delete b.timestamp;
    check('preview embed JSON is identical to the shared builder output (same inputs)',
      JSON.stringify(a) === JSON.stringify(b),
      `route=${JSON.stringify(a)} expected=${JSON.stringify(b)}`);
  }

  // === (c) the preview path cannot send anything ==============================
  if (handlerSrc) {
    check('preview handler never sends to Discord (no .send / notifier send / discordApi write)',
      !/\.send\(/.test(handlerSrc) && !/checkAllStreams|checkOneStreamer/.test(handlerSrc)
      && !/discordApi\.(post|patch|delete|put)/.test(handlerSrc) && !/\bfetch\(/.test(handlerSrc));
    check('preview handler never fetches live data (no checker call)',
      !/CHECKERS|checkTwitch|checkYouTube|checkKick|fetchLatestClip/.test(handlerSrc));
    check('preview sample data is clearly fake',
      /title: 'Test stream — preview only'/.test(handlerSrc)
      && /game: 'Just Chatting'/.test(handlerSrc) && /viewers: 123/.test(handlerSrc)
      && /title: 'Sample clip — preview only'/.test(handlerSrc));
  }
  check('sample thumbnail file exists and is served from the dashboard public dir',
    fs.existsSync(THUMB) && /LIVE PREVIEW/.test(fs.readFileSync(THUMB, 'utf8')));

  // === (d) Streams table markup ==============================================
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

  check('streams table keeps 1.15.23 classes + colgroup',
    /<table class="streams-table"><colgroup>/.test(html) && /<col class="c-actions">/.test(html));
  check('streams table wrapped in .table-scroll',
    /<div class="table-scroll">\s*<table class="streams-table">/.test(html));
  check('Preview button present on every streamer row',
    /data-preview-streamer="7"/.test(html) && /data-preview-streamer="8"/.test(html) && /data-preview-streamer="9"/.test(html));
  check('preview panel container exists below the streamers list',
    /<div id="stream-preview" class="discord-preview" style="display:none" aria-live="polite"><\/div>/.test(html));
  check('platform badges + ellipsis cells intact',
    /<span class="badge platform-twitch">twitch<\/span>/.test(html)
    && /<td class="s-name" title="a_very_long_streamer_name_that_should_ellipsize">/.test(html));
  check('add/edit/delete/refresh/clip controls intact',
    /data-refresh-streamer="7"/.test(html) && /data-edit-streamer="7"/.test(html)
    && /data-remove-streamer="7"/.test(html) && /data-clip-toggle="7"/.test(html));
  check('add-streamer form intact', /id="add-streamer-form"/.test(html) && /id="streamer-result"/.test(html));

  // === (e) Staff Errors unchanged =============================================
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
  check('staff/errors: level badges + purge hooks intact',
    /<span class="badge level-error">error<\/span>/.test(staffHtml)
    && /id="purge-selected-errors" disabled/.test(staffHtml) && /id="select-all-errors"/.test(staffHtml));

  // === frontend + CSS ==========================================================
  const settingsJs = fs.readFileSync(SETTINGS_JS, 'utf8');
  check('settings.js: Preview button calls GET /streamers/:id/preview',
    /AceBot\.getJSON\(api\(`\/streamers\/\$\{pvStreamer\.dataset\.previewStreamer\}\/preview`\)\);/.test(settingsJs));
  check('settings.js: renderStreamPreview renders content + embed + close',
    /function renderStreamPreview\(data\)/.test(settingsJs)
    && /data-close-stream-preview/.test(settingsJs)
    && /Preview — nothing was sent to Discord/.test(settingsJs));
  check('settings.js: preview renderer escapes server text (AceBot.esc)',
    /const esc = AceBot\.esc;/.test(settingsJs) && /esc\(f\.name\)/.test(settingsJs) && /esc\(e\.title/.test(settingsJs));
  check('settings.js: remove/refresh/edit/clip handlers untouched',
    /data-remove-streamer/.test(settingsJs) && /data-refresh-streamer/.test(settingsJs)
    && /data-edit-streamer/.test(settingsJs) && /data-clip-toggle/.test(settingsJs));

  const css = fs.readFileSync(CSS, 'utf8');
  check('CSS: discord-preview panel + embed styles present',
    /\.discord-preview\{margin:16px 0;padding:14px;background:#313338/.test(css)
    && /\.discord-preview \.dp-embed\{background:#2b2d31;border-left:4px solid #5865f2/.test(css)
    && /\.discord-preview \.dp-title a\{color:#00a8fc/.test(css)
    && /\.discord-preview \.dp-image\{display:block;max-width:100%/.test(css));
  check('CSS: streams-table + errors-table rules untouched',
    /\.streams-table\{table-layout:fixed;width:100%\}/.test(css)
    && /\.streams-table col\.c-actions\{width:190px\}/.test(css)
    && /\.errors-table\{table-layout:fixed;width:100%\}/.test(css)
    && /\.errors-table col\.c-when\{width:132px\}/.test(css));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('VERIFY CRASH:', e); process.exit(1); });

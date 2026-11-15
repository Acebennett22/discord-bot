// Verification for 1.15.9 — dashboard template-locals fixes.
// Renders the touched templates with ejs.renderFile using realistic locals
// and asserts the 1.15.9 behaviors. Run: node tmp/verify-1.15.9.js
// Exits non-zero on any failure.
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'dashboard', 'views');
const DASH = path.join(__dirname, '..', 'src', 'dashboard.js');

let failures = 0;
function check(name, ok, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

async function render(view, locals) {
  return ejs.renderFile(path.join(VIEWS, view), locals, { async: false });
}

(async () => {
  // --- home.ejs -------------------------------------------------------------
  // (a) REGRESSION: authExpired entirely absent from locals must NOT throw.
  // This is the exact 1.15.9 bug: a render that forgets the variable.
  let html;
  try {
    html = await render('home.ejs', { user: { username: 'Ace', id: '1' }, guilds: [{ id: '1', name: 'Guild One', icon: null }], inviteUrl: 'https://example.invalid/invite', isStaff: false });
    check('home: renders with authExpired absent from locals', true);
    check('home: no expired notice when authExpired absent', !html.includes('connection expired'));
    check('home: guild card shown', html.includes('Guild One'));
  } catch (e) { check(`home: renders with authExpired absent from locals (${e.message})`, false); }

  // (b) authExpired: true shows the notice (1.15.4 behavior preserved).
  try {
    html = await render('home.ejs', { user: { username: 'Ace', id: '1' }, guilds: [{ id: '2', name: 'Guild Two', icon: 'abc' }], inviteUrl: 'https://example.invalid/invite', isStaff: false, authExpired: true });
    check('home: expired notice shown when authExpired true', html.includes('Your Discord connection expired'));
    check('home: still logged in, guild shown', html.includes('Guild Two'));
  } catch (e) { check(`home: authExpired true render (${e.message})`, false); }

  // (c) empty guilds list.
  try {
    html = await render('home.ejs', { user: { username: 'Ace', id: '1' }, guilds: [], inviteUrl: 'https://example.invalid/invite', isStaff: false });
    check('home: empty guilds shows empty state', html.includes('No manageable servers'));
  } catch (e) { check(`home: empty guilds render (${e.message})`, false); }

  // (d) logged-out hero.
  try {
    html = await render('home.ejs', { user: null, guilds: [], inviteUrl: 'https://example.invalid/invite', isStaff: false });
    check('home: logged-out hero renders', html.includes('Run your Discord server'));
  } catch (e) { check(`home: logged-out render (${e.message})`, false); }

  // --- setup.ejs (botUsername latent gap, 1.15.9 typeof guard) --------------
  const steps = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, title: `Step ${i + 1}`, optional: false }));
  const setupBase = { user: null, isStaff: false, inviteUrl: 'https://example.invalid/invite', step: { n: 8, id: 'review', title: 'Review & finish' }, steps, data: {}, error: null, links: {}, saved: true, finish: true, isHttp: false, publicUrl: '' };
  try {
    html = await render('setup.ejs', { ...setupBase }); // no botUsername key at all
    check('setup: renders with saved=true and botUsername absent', true);
    check('setup: saved page shown', html.includes('Setup complete'));
  } catch (e) { check(`setup: botUsername absent render (${e.message})`, false); }
  try {
    html = await render('setup.ejs', { ...setupBase, botUsername: 'TestBot' });
    check('setup: bot name shown when provided', html.includes('TestBot'));
  } catch (e) { check(`setup: botUsername present render (${e.message})`, false); }

  // --- settings.ejs (the four 1.15.9 fetches) -------------------------------
  const settingsFixture = (module) => ({
    user: { username: 'Ace', id: '1' }, guild: { id: '123', name: 'Test Guild', icon: null }, module, settings: {},
    channels: [], roles: [], streamers: [], tickets: [], gameServers: [], applicationForms: [], pendingApplications: [],
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
  for (const [mod, marker] of [['threads', 'Per-channel overrides'], ['confessions', 'Pending queue'], ['roles', 'Temporary roles']]) {
    try {
      html = await render('settings.ejs', settingsFixture(mod));
      check(`settings/${mod}: renders with the 1.15.9 locals`, html.includes(marker));
    } catch (e) { check(`settings/${mod}: renders (${e.message})`, false); }
  }
  // The four locals must also be present in the dashboard.js render call.
  const dashSrc = fs.readFileSync(DASH, 'utf8');
  for (const name of ['threadOverrides', 'pendingConfessions', 'tempRoles', 'xpShopItems']) {
    check(`dashboard.js: settings render passes ${name}`, dashSrc.includes(name) && /res\.render\('settings'[\s\S]*?threadOverrides, pendingConfessions, tempRoles, xpShopItems/.test(dashSrc));
  }

  // --- res.locals middleware (static check: present, before all routes) -----
  const mwIdx = dashSrc.indexOf('res.locals.authExpired = false');
  const firstRoute = Math.min(...['app.get(', 'app.post('].map((s) => dashSrc.indexOf(s)));
  check('dashboard.js: res.locals.authExpired default exists', mwIdx !== -1);
  check('dashboard.js: middleware runs before routes', mwIdx !== -1 && mwIdx < firstRoute);
  check('dashboard.js: expired branch still passes authExpired: true explicitly', dashSrc.includes('authExpired: true'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL 1.15.9 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAIL harness error:', e); process.exit(1); });

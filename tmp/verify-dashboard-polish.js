// Verify dashboard visual polish: whole-dashboard CSS refresh (cards, buttons,
// inputs, sidebar/header, type, tables, micro-polish) + minimal class hooks.
// Renders the main views, checks style.css carries the new rules and parses,
// boots the dashboard in wizard mode and checks / + /style.css serve.
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// ---- 1. CSS parse check (balanced delimiters, no empty rules, no double semicolons) ----
const css = fs.readFileSync(path.join(ROOT, 'dashboard', 'public', 'style.css'), 'utf8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("[^"]*"\)/g, 'url(X)');
let depth = 0, paren = 0, bracket = 0, inStr = null, cssOk = true;
for (let i = 0; i < stripped.length; i++) {
  const c = stripped[i];
  if (inStr) { if (c === inStr) inStr = null; continue; }
  if (c === '"' || c === "'") { inStr = c; continue; }
  if (c === '{') depth++;
  if (c === '}') { depth--; if (depth < 0) cssOk = false; }
  if (c === '(') paren++;
  if (c === ')') { paren--; if (paren < 0) cssOk = false; }
  if (c === '[') bracket++;
  if (c === ']') { bracket--; if (bracket < 0) cssOk = false; }
}
check('CSS balanced braces/parens/brackets', cssOk && depth === 0 && paren === 0 && bracket === 0);
check('CSS no double semicolons or empty rules', !/;;/.test(stripped) && !/\{\s*\}/.test(stripped));
check('CSS original rules intact (panel vars, blurple, errors-table, disabled)', 
  css.includes('--blurple:#5865f2') && css.includes('.errors-table{table-layout:fixed')
  && css.includes('.btn:disabled,.btn:disabled:hover{opacity:.45')
  && css.includes('.badge.level-error'));

// New polish rules present
const newRules = [
  '--radius-sm', '--shadow-sm', '--shadow-lg', '--accent-soft', '--focus-ring',
  '::selection', 'scrollbar-width:thin', '::-webkit-scrollbar-thumb',
  '.settings-content > h2', '.card-block', '.code-block',
  'header a:not(.btn):not(.brand)', '.sidebar nav a.active{',
  'box-shadow:inset 3px 0 0 var(--blurple)',
  '.btn:focus-visible', '.btn:active',
  'input[type=password]', 'input[type=search]', 'input::placeholder',
  'input[type=checkbox]{accent-color:var(--blurple)',
  'select{cursor:pointer;appearance:none',
  '.toast.warn', '.toast.error',
  'tbody tr:hover', '.badge.ok', '.badge.muted',
  '.toggle input:focus-visible + .track',
];
for (const r of newRules) check(`CSS rule present: ${r}`, css.includes(r));
check('CSS still small (no bloat)', css.length < 20000, `${css.length} bytes`);

// ---- 2. Views render (full renders where locals are cheap; compile check for settings/docs) ----
function render(file, locals) {
  const f = path.join(ROOT, 'dashboard', 'views', file);
  return ejs.render(fs.readFileSync(f, 'utf8'), locals, { filename: f });
}

// home: logged out + logged in
const homeOut = render('home.ejs', { user: null, guilds: [], inviteUrl: 'https://example.invalid/invite', isStaff: false });
check('home renders logged-out', /Run your Discord server/.test(homeOut));
const homeIn = render('home.ejs', { user: { username: 'tester' }, guilds: [{ id: '1', name: 'Test Guild', icon: null }], inviteUrl: 'https://example.invalid/invite', isStaff: false, authExpired: false });
check('home renders logged-in with guild card', /Test Guild/.test(homeIn) && /class="card"/.test(homeIn));

// staff: errors + error-detail + overview
const rows = [{ id: 101, level: 'error', shard_id: 0, command_name: 'music play', user_id: '1', message: 'boom', created_at: new Date('2026-11-15T23:31:11Z'), resolved: false }];
const staff = render('staff.ejs', { user: { username: 'tester' }, section: 'errors', data: { errors: rows, filters: { level: '', command: '', shard: '' } }, isStaff: true, inviteUrl: 'https://example.invalid/invite', saved: false });
check('staff errors renders with new hooks intact', /class="errors-table"/.test(staff) && /purge-selected-errors/.test(staff));
const detail = render('staff.ejs', { user: { username: 'tester' }, section: 'error-detail', data: { error: { id: 101, level: 'error', shard_id: 0, guild_id: '1', command_name: 'play', user_id: '1', message: 'boom', stack: 'at x', context: null, created_at: '2026-11-15', resolved: false, resolved_by: null } }, isStaff: true, inviteUrl: 'https://example.invalid/invite', saved: false });
check('staff error-detail uses .code-block (no inline pre style)', /<pre class="code-block">at x<\/pre>/.test(detail) && !/pre style="background:#111214/.test(detail));
const overview = render('staff.ejs', { user: { username: 'tester' }, section: 'overview', data: { shardInfo: 'ok', errors24h: 0, totalGuilds: 1, totalUsers: 2, totalCommands: 3, songs: 4, topCommands: [], topGuilds: [], recent: [], errors: [], presenceState: null, presenceTemplates: [] }, isStaff: true, inviteUrl: 'https://example.invalid/invite', saved: false });
check('staff overview renders', /Bot overview/.test(overview));

// setup: welcome step + finish table
const setup = render('setup.ejs', { steps: [{ n: 1, title: 'Welcome' }], step: { n: 1, id: 'welcome' }, data: {}, saved: false, finish: false, error: null, links: {}, isHttp: false });
check('setup welcome renders', /Welcome to Vikings Hall/.test(setup));

// version: real changelog
const { loadChangelog } = require(path.join(ROOT, 'src', 'utils', 'changelog'));
const { version } = require(path.join(ROOT, 'package.json'));
const ver = render('version.ejs', { user: null, guilds: [], inviteUrl: 'https://example.invalid/invite', isStaff: false, version, entries: loadChangelog() });
check('version renders with card-block entries', /class="card card-block"/.test(ver) && ver.includes(`v${version}`));

// docs: real content + grouped commands
const { getContent, groupedCommands } = require(path.join(ROOT, 'src', 'utils', 'docs'));
const docs = render('docs.ejs', { user: null, inviteUrl: 'https://example.invalid/invite', isStaff: false, content: getContent(), groups: groupedCommands() });
check('docs renders with card-block sections', /class="card card-block"/.test(docs));

// settings: compile check (full render needs heavy locals) + general-module render
try {
  ejs.compile(fs.readFileSync(path.join(ROOT, 'dashboard', 'views', 'settings.ejs'), 'utf8'), { filename: path.join(ROOT, 'dashboard', 'views', 'settings.ejs') });
  check('settings.ejs compiles', true);
} catch (e) { check('settings.ejs compiles', false, e.message); }
const settingsLocals = {
  user: { username: 'tester' }, guild: { id: '1', name: 'Test Guild', icon: null }, channels: [], roles: [],
  settings: {}, module: 'general', saved: false, serverRules: null, milestoneNext: null, milestoneSettings: {},
  translateSettings: {}, threadOverrides: [], pendingConfessions: [], playlists: [], voiceRate: null,
  voiceStats: [], prestigeLeaderboard: [], analyticsData: null, inactiveMembers: [], giveaways: [],
  reactionRoleMappings: [], tempBans: [], slowmodeSchedules: [], streamers: [], tickets: [], ticketPanels: [],
  ticketRatingStats: null, countingSettings: null,
};
try {
  const s = render('settings.ejs', settingsLocals);
  check('settings general module renders', /General settings/.test(s));
} catch (e) { check('settings general module renders', false, e.message); }
const settingsSrc = fs.readFileSync(path.join(ROOT, 'dashboard', 'views', 'settings.ejs'), 'utf8');
check('settings uses card-block for content cards', (settingsSrc.match(/class="card card-block"/g) || []).length >= 7);

// setup toasts use classes, no inline toast styles left
const setupSrc = fs.readFileSync(path.join(ROOT, 'dashboard', 'views', 'setup.ejs'), 'utf8');
check('setup toasts use .toast.warn/.toast.error classes', /class="toast warn"/.test(setupSrc) && /class="toast error"/.test(setupSrc) && !/class="toast" style="background:rgba/.test(setupSrc));

// ---- 3. Dashboard boots in wizard mode and serves / + /style.css ----
function get(port, p) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
  });
}
(async () => {
  // Another agent's boot test may already hold :3010 — reuse it if it answers.
  const probe = await get(3010, '/style.css');
  let child = null;
  let ok = probe.status === 200;
  if (!ok) {
    const env = { ...process.env, ALLOW_PLACEHOLDER_CONFIG: '1' };
    child = spawn('node', ['src/dashboard.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 40 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (out.includes('Running at http://localhost:3010')) ok = true;
    }
    if (!ok) console.log('boot log tail:', out.slice(-300));
  } else {
    console.log('note: reusing already-running dashboard on :3010 for the serve checks');
  }
  check('dashboard boots in wizard mode (or already running)', ok);
  if (ok) {
    const root = await get(3010, '/');
    check('GET / -> 302 (logged-out redirect)', root.status === 302, `got ${root.status}`);
    const cssRes = await get(3010, '/style.css');
    check('GET /style.css -> 200 with new polish rules', cssRes.status === 200 && cssRes.body.includes('.card-block') && cssRes.body.includes('scrollbar-width:thin') && cssRes.body.includes('.toast.warn'), `got ${cssRes.status}`);
  } else {
    check('GET / -> 302 (logged-out redirect)', false, 'dashboard did not boot');
    check('GET /style.css -> 200 with new polish rules', false, 'dashboard did not boot');
  }
  if (child) child.kill('SIGTERM');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

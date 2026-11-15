// Verify header avatar + Add to Server button move (header polish change).
// Renders the shared header partial with a user that has an avatar, a user
// that does not, and logged-out; checks the CDN URL, the initial-letter
// fallback, the compact button beside the brand, style.css rules, and boots
// the dashboard in wizard mode to check / + /style.css serve.
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

const headerTpl = fs.readFileSync(path.join(ROOT, 'dashboard', 'views', 'partials', 'header.ejs'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'dashboard', 'public', 'style.css'), 'utf8');
const renderHeader = (locals) => ejs.render(headerTpl, locals, { filename: path.join(ROOT, 'dashboard', 'views', 'partials', 'header.ejs') });

// ---- 1. User WITH a Discord avatar ----
const withAvatar = renderHeader({ user: { id: '111222333444555666', username: 'Luna', avatar: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' }, isStaff: false });
check('avatar img uses CDN URL from user id + avatar hash',
  withAvatar.includes('src="https://cdn.discordapp.com/avatars/111222333444555666/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.png?size=64"'));
check('avatar img has onerror fallback to the initial-letter span',
  /<img class="user-avatar"[^>]*onerror="this\.style\.display='none';this\.nextElementSibling\.style\.display='inline-flex'"/.test(withAvatar));
check('fallback span present but hidden when a real avatar exists',
  withAvatar.includes('<span class="user-avatar user-avatar-fallback" style="display:none">L</span>'));
check('username still shown next to the avatar', withAvatar.includes('<span class="user">Luna</span>'));
check('no hardcoded real user id/hash in the template source (only EJS expressions)',
  !/avatars\/\d{10,}\//.test(headerTpl) && headerTpl.includes('<%= user.id %>') && headerTpl.includes('<%= user.avatar %>'));

// ---- 2. User WITHOUT a custom avatar ----
const noAvatar = renderHeader({ user: { id: '111222333444555666', username: 'Luna', avatar: null }, isStaff: false });
check('no avatar img when the user has no custom avatar', !noAvatar.includes('<img class="user-avatar"'));
check('initial-letter fallback shown (first letter, uppercased)',
  noAvatar.includes('<span class="user-avatar user-avatar-fallback">L</span>'));
check('username still shown with the fallback', noAvatar.includes('<span class="user">Luna</span>'));

// ---- 3. Logged out ----
const loggedOut = renderHeader({ user: null, isStaff: false });
check('logged-out header has no avatar or username', !loggedOut.includes('user-avatar') && !loggedOut.includes('class="user"'));
check('logged-out header shows Login with Discord', loggedOut.includes('Login with Discord'));

// ---- 4. Add to Server: smaller, beside the brand ----
const brandIdx = withAvatar.indexOf('class="brand-wrap"');
const btnIdx = withAvatar.indexOf('Add to Server');
const rightIdx = withAvatar.indexOf('class="header-right"');
check('Add to Server button sits inside the brand-wrap (beside the dashboard name)',
  brandIdx !== -1 && btnIdx > brandIdx && btnIdx < rightIdx);
check('Add to Server button is compact (btn-sm class, no longer the full-size .btn alone)',
  /<a class="btn btn-sm" href="\/invite"[^>]*>➕ Add to Server<\/a>/.test(withAvatar));
check('Add to Server button no longer in the right-hand nav div',
  !/class="header-right"[\s\S]*Add to Server/.test(withAvatar));
check('Add to Server still opens the invite in a new tab', withAvatar.includes('href="/invite" target="_blank"'));
check('staff link still renders in the header when isStaff', renderHeader({ user: { id: '1', username: 'Ace', avatar: null }, isStaff: true }).includes('<a href="/staff">Staff</a>'));

// ---- 5. CSS rules ----
check('CSS: .user-avatar circular 28px with the blurple ring', css.includes('header .user-avatar{width:28px;height:28px;border-radius:50%') && css.includes('box-shadow:0 0 0 2px rgba(88,101,242,.35)'));
check('CSS: .user-avatar-fallback blurple circle with centered letter', css.includes('header .user-avatar-fallback{display:inline-flex;align-items:center;justify-content:center;background:var(--blurple)'));
check('CSS: .brand-wrap flex row with gap', css.includes('header .brand-wrap{display:flex;align-items:center;gap:12px}'));
check('CSS: .btn-sm compact sizing', css.includes('.btn-sm{padding:5px 10px;font-size:13px;border-radius:8px}'));
check('CSS: .user-chip aligns avatar + username', css.includes('header .user-chip{display:inline-flex;align-items:center;gap:8px}'));
check('CSS balanced braces/parens/brackets', (() => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let d = 0, p = 0, ok = true;
  for (const c of stripped) {
    if (c === '{') d++; if (c === '}') { d--; if (d < 0) ok = false; }
    if (c === '(') p++; if (c === ')') { p--; if (p < 0) ok = false; }
  }
  return ok && d === 0 && p === 0;
})());
check('CSS no double semicolons or empty rules', !/;;/.test(css) && !/\{\s*\}/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));

// ---- 6. Full page render (home, logged in) picks the header up ----
const homeTpl = fs.readFileSync(path.join(ROOT, 'dashboard', 'views', 'home.ejs'), 'utf8');
const homeHtml = ejs.render(homeTpl, { user: { id: '111222333444555666', username: 'Luna', avatar: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' }, guilds: [], inviteUrl: '/invite', isStaff: false, authExpired: false }, { filename: path.join(ROOT, 'dashboard', 'views', 'home.ejs') });
check('home page renders with the avatar img in the header',
  homeHtml.includes('https://cdn.discordapp.com/avatars/111222333444555666/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.png?size=64'));
check('home page header has the compact Add to Server beside the brand',
  /class="brand-wrap"[\s\S]*?btn btn-sm[\s\S]*?Add to Server/.test(homeHtml));

// ---- 7. Dashboard boots in wizard mode and serves / + /style.css ----
function get(port, p) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}
(async () => {
  let child = null;
  let ok = false;
  let out = '';
  // Another agent's boot test may already hold :3010 — reuse it if it answers.
  const probe = await get(3010, '/style.css');
  if (probe.status === 200) {
    ok = true;
    console.log('note: reusing already-running dashboard on :3010 for the serve checks');
  } else {
    const env = { ...process.env, ALLOW_PLACEHOLDER_CONFIG: '1' };
    child = spawn('node', ['src/dashboard.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      const r = await get(3010, '/style.css');
      if (r.status === 200) { ok = true; break; }
    }
    if (!ok) console.log('boot check: dashboard on :3010 did not answer in time');
  }
  check('dashboard boots in wizard mode (or already running)', ok);
  if (ok) {
    const root = await get(3010, '/');
    check('GET / -> 302 (logged-out redirect)', root.status === 302, `got ${root.status}`);
    const cssRes = await get(3010, '/style.css');
    check('GET /style.css -> 200 with the new avatar + btn-sm rules', cssRes.status === 200 && cssRes.body.includes('.user-avatar') && cssRes.body.includes('.btn-sm') && cssRes.body.includes('.brand-wrap'), `got ${cssRes.status}`);
  } else {
    check('GET / -> 302 (logged-out redirect)', false, 'dashboard did not boot');
    check('GET /style.css -> 200 with the new avatar + btn-sm rules', false, 'dashboard did not boot');
  }
  if (child) child.kill('SIGTERM');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

// Verification for 1.15.10: the dashboard /login authorize URL must request
// exactly `identify guilds` — Discord has no `offline` scope, and 1.15.4
// adding it made Discord reject every login with "invalid scope :offline".
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.10.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/dashboard.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// 1. Extract the scope literal from the /login route and rebuild the exact
// authorize URL the route produces (same URLSearchParams construction).
const loginMatch = src.match(/app\.get\('\/login'[\s\S]*?scope:\s*'([^']+)'/);
check('login route has a scope literal', !!loginMatch);
const scope = loginMatch ? loginMatch[1] : '';
check('scope is exactly "identify guilds"', scope === 'identify guilds', `got ${JSON.stringify(scope)}`);

const params = new URLSearchParams({
  client_id: 'TEST_CLIENT_ID',
  redirect_uri: 'https://example.com/callback',
  response_type: 'code',
  scope,
});
const url = `https://discord.com/oauth2/authorize?${params}`;
const parsed = new URL(url);
check('URL scope param decodes to exactly "identify guilds"', parsed.searchParams.get('scope') === 'identify guilds');
check('URL contains no "offline" anywhere', !url.includes('offline'), url);
check('URL scope is URL-encoded (identify+guilds or identify%20guilds)', /scope=identify(\+|%20)guilds(&|$)/.test(url), url);
check('URL response_type=code', parsed.searchParams.get('response_type') === 'code');
check('URL has client_id param', !!parsed.searchParams.get('client_id'));
check('URL has redirect_uri param', !!parsed.searchParams.get('redirect_uri'));

// 2. The fix restores the exact pre-1.15.4 scope: no other scope string exists.
const scopeLiterals = [...src.matchAll(/scope:\s*'([^']+)'/g)].map((m) => m[1]);
check('only one OAuth scope literal in dashboard.js and it is identify guilds',
  scopeLiterals.length === 1 && scopeLiterals[0] === 'identify guilds',
  `found ${JSON.stringify(scopeLiterals)}`);
// (The bot-invite URL at line ~86 uses scope=bot%20applications.commands —
// a different scope for a different flow; confirm it is untouched.)
check('bot invite URL still uses bot + applications.commands scope',
  src.includes('scope=bot%20applications.commands'));

// 3. Refresh-token machinery (1.15.4) is intact — only the scope changed.
check('refreshAccessToken is defined', /async function refreshAccessToken\(req\)/.test(src));
check('refresh uses grant_type refresh_token', /grant_type:\s*'refresh_token'/.test(src));
check('refresh is called when the token is known-expired', /tokenExpiresAt && Date\.now\(\) > req\.session\.tokenExpiresAt[\s\S]{0,200}refreshAccessToken\(req\)/.test(src));
check('refresh is called on 401 and the guilds call is retried', /status === 401 && req\.session\.refreshToken[\s\S]{0,200}refreshAccessToken\(req\)/.test(src));
check('callback stores refreshToken in the session', /req\.session\.refreshToken\s*=\s*tokenRes\.data\.refresh_token/.test(src));
check('callback stores tokenExpiresAt', /req\.session\.tokenExpiresAt\s*=/.test(src));
check('refresh stores a rotated refresh token', /if \(res\.data\.refresh_token\) req\.session\.refreshToken = res\.data\.refresh_token/.test(src));
check('expired-connection notice path still exists (authExpired)', /expired\.authExpired\s*=\s*true/.test(src));

// 4. No stale `offline`-scope references remain in the OAuth flow: any line
// mentioning both "offline" and "scope" must be the 1.15.10 correction note
// (it says there is NO such scope / it was a mistake), never a claim that
// the scope is requested or required.
check('no stale "offline scope is used" claim left in dashboard.js', (() => {
  const bad = src.split('\n').filter((line) => /offline/i.test(line) && /scope/i.test(line)
    && !/NO `offline`|no special scope|by mistake|invalid scope/i.test(line));
  return bad.length === 0;
})());
check('no scope with offline anywhere in src/', (() => {
  const { execSync } = require('child_process');
  const out = execSync(`grep -rn "identify guilds offline" ${path.join(ROOT, 'src')} || true`, { encoding: 'utf8' });
  return out.trim() === '';
})());

console.log(fail === 0 ? `\nALL 1.15.10 CHECKS PASSED (${pass}/${pass})` : `\n${fail} CHECK(S) FAILED (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);

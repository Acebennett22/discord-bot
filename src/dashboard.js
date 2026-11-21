// Web dashboard (Dyno-style): Discord OAuth2 login, per-server settings pages.
// Runs SEPARATELY from the bot:  npm run dashboard   (default http://localhost:3010)
// Reads/writes the same MySQL guild_settings / streamers / tickets tables the
// bot uses — the bot picks up dashboard changes within 60s (guildSettings TTL).
// SECURITY: never put the bot token or DB password in frontend code or any API
// response. Settings are only shown for guilds where the logged-in user has
// Manage Guild AND the bot is a member.
// Setup-wizard mode: the dashboard must start even when config.json still
// has placeholder token/clientId, so the wizard can collect them. The bot
// itself never sets this flag and still refuses placeholders.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const config = require('./utils/config');
const db = require('./utils/database');
const { getGuildSettings, setGuildSettings } = require('./utils/guildSettings');
const staffUtils = require('./utils/staff');
const localAccounts = require('./utils/localAccounts');
const { staffFlag, requireStaff, requireStaffWrite, requireAdmin, requireOwner, actorId, getLocalAccount, canManageAccounts, handleLocalLogin, createAccountApi, setAccountRoleApi, setAccountStatusApi, resetAccountPasswordApi, deleteAccountApi } = require('./utils/dashboardAuth');
const { resolveUserLabels } = require('./utils/userLabels');
const { createSessionStore, SESSION_MAX_AGE_MS } = require('./utils/sessionStore');
const errorLogger = require('./utils/errorLogger');
const { runBackup, retentionDays, BACKUP_DIR } = require('../scripts/backup-db');
const { FEATURES, setToggle } = require('./utils/featureToggles');
const { validateTemplate } = require('./utils/liveChannelTemplate');
const { fetchBotHealth } = require('./utils/botHealth');
const { formatErrorContext } = require('./utils/formatErrorContext');
const { healthPort } = require('./utils/healthServer');

// Command catalog (scanned from src/commands/*/*.js) for the Staff and
// per-guild Commands pages.
const COMMAND_CATALOG = [];
for (const cat of fs.readdirSync(path.join(__dirname, 'commands'))) {
  const dir = path.join(__dirname, 'commands', cat);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    COMMAND_CATALOG.push({ name: file.replace('.js', ''), category: cat });
  }
}
COMMAND_CATALOG.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

const app = express();
const PORT = (config.dashboard && config.dashboard.port) || 3010;
const REDIRECT_URI = (config.dashboard && config.dashboard.redirectUri) || `http://localhost:${PORT}/callback`;

// Behind a reverse proxy (Nginx/Caddy/Cloudflare): trust X-Forwarded-* so
// req.protocol / secure cookies work over HTTPS. See README "Reverse proxy".
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'dashboard', 'views'));
app.use(express.static(path.join(__dirname, '..', 'dashboard', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60_000, limit: 300 }));
app.use(session({
  secret: (config.dashboard && config.dashboard.sessionSecret) || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  // 30-day login cookie, refreshed on activity (rolling). Sessions live in
  // MySQL via createSessionStore() so they survive dashboard restarts;
  // falls back to MemoryStore with a warning when MySQL is unavailable.
  rolling: true,
  store: createSessionStore(),
  cookie: { httpOnly: true, secure: 'auto', maxAge: SESSION_MAX_AGE_MS },
}));
if ((config.dashboard?.sessionSecret || '').includes('CHANGE_ME')) {
  console.warn('[dashboard] WARNING: dashboard.sessionSecret in config.json is still the default — set a long random string before exposing this publicly.');
}

// Template safety net (1.15.9): home.ejs shows an "expired connection"
// notice when authExpired is true. Default it to false for EVERY request so
// a render that forgets to pass it can never throw "authExpired is not
// defined" — the same class of bug as the 1.15.2 translate crash (a template
// referencing a variable a route doesn't provide). Explicit render locals
// still override this default.
app.use((req, res, next) => {
  res.locals.authExpired = false;
  // Local-account identity for templates (1.16.6): the header shows the
  // local username/role when logged in that way, and the staff nav shows
  // the Accounts link only to the Discord owner or a local admin.
  res.locals.localAccount = getLocalAccount(req);
  res.locals.canManageAccounts = canManageAccounts(req);
  next();
});

// --- Discord API helpers -------------------------------------------------------
const discordApi = axios.create({ baseURL: 'https://discord.com/api/v10', timeout: 10_000 });
const botHeaders = () => ({ Authorization: `Bot ${config.token}` });

// Bot-token REST client in the { get, patch } shape the identity util takes
// (src/utils/dashboardIdentity.js) — same calls, same headers as above.
const botRest = () => ({
  get: (url) => discordApi.get(url, { headers: botHeaders() }),
  patch: (url, data) => discordApi.patch(url, data, { headers: botHeaders() }),
});

function inviteUrl() {
  const perms = (config.dashboard && config.dashboard.invitePermissions) || 1099951041558;
  return `https://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=${perms}&scope=bot%20applications.commands`;
}

// Human uptime for the staff overview ("2h 14m", "3d 5h 2m"). Garbage in,
// '—' out — never throws on a weird health payload.
function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// (staffFlag / requireStaff / requireStaffWrite / requireAdmin /
// requireOwner / actorId / getLocalAccount / canManageAccounts /
// handleLocalLogin all come from src/utils/dashboardAuth.js — see the
// require at the top of this file. Local username/password accounts log
// in alongside Discord OAuth; see that module for the session shape.)


// --- First-run setup wizard --------------------------------------------------
const PLACEHOLDER_VALUES = new Set(['', 'YOUR_DISCORD_BOT_TOKEN_HERE', 'YOUR_CLIENT_ID_HERE', 'YOUR_TOKEN_HERE', 'YOUR_CLIENT_ID']);
function isPlaceholder(v) { return typeof v !== 'string' || PLACEHOLDER_VALUES.has(v.trim()); }
function setupNeeded() {
  return !config.setupComplete || isPlaceholder(config.token) || isPlaceholder(config.clientId);
}

function isLocalRequest(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].includes(ip) || req.hostname === 'localhost';
}

// One-time setup token (domain access): on first run the dashboard prints a
// long random token to the console and writes it to setup-token.txt
// (gitignored, never uploaded). The wizard URL is /setup?token=<token>.
// The token is single-use: presenting it starts a setup session and
// invalidates it. After setup completes the wizard is disabled entirely
// (setupComplete in config.json). localhost requests are also allowed
// without a token.
let setupToken = null;
const SETUP_TOKEN_FILE = path.join(__dirname, '..', 'setup-token.txt');
function issueSetupToken() {
  if (!setupNeeded()) return;
  setupToken = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SETUP_TOKEN_FILE, setupToken + '\n', { mode: 0o600 }); } catch {}
  const base = (config.dashboard?.publicUrl || '').replace(/\/$/, '') || `http://localhost:${PORT}`;
  console.log('\n[setup] ============================================================');
  console.log('[setup] FIRST RUN — complete setup at:');
  console.log(`[setup]   ${base}/setup?token=${setupToken}`);
  console.log('[setup] The same token is in setup-token.txt (one-time use).');
  console.log('[setup] ============================================================\n');
}

function requireSetupAccess(req, res, next) {
  if (!setupNeeded()) {
    // Re-runs after setup: owner session only.
    if (req.session.user?.id === config.ownerId) return next();
    return res.redirect('/login');
  }
  if (req.session.setupAuthorized) return next();
  if (req.query.token && setupToken && req.query.token === setupToken) {
    req.session.setupAuthorized = true;
    setupToken = null;
    try { fs.unlinkSync(SETUP_TOKEN_FILE); } catch {}
    return next();
  }
  if (isLocalRequest(req)) { req.session.setupAuthorized = true; return next(); }
  return res.status(404).send('Not found.');
}

const SETUP_STEPS = [
  { n: 1, id: 'welcome', title: 'Welcome', optional: false },
  { n: 2, id: 'discord', title: 'Discord', optional: false },
  { n: 3, id: 'database', title: 'Database (MySQL)', optional: false },
  { n: 4, id: 'dashboard', title: 'Dashboard', optional: false },
  { n: 5, id: 'streaming', title: 'Streaming APIs', optional: true },
  { n: 6, id: 'steam', title: 'Steam API', optional: true },
  { n: 7, id: 'misc', title: 'Backups & misc', optional: false },
  { n: 8, id: 'review', title: 'Review & finish', optional: false },
];

function setupData(req) { return req.session.setupData || {}; }
function maskSecret(v) {
  if (!v) return '—';
  const s = String(v);
  return s.length <= 4 ? '••••' : '••••' + s.slice(-4);
}

// Redirect everything to the wizard while first-run setup is incomplete.
app.use((req, res, next) => {
  if (!setupNeeded()) return next();
  if (req.path.startsWith('/setup') || req.path === '/style.css' || req.path === '/favicon.svg' || req.path === '/version' || req.path === '/docs' || req.path.startsWith('/js/') || req.path === '/app.js') return next();
  return res.redirect('/setup');
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    // API calls (fetch) follow a redirect to /login as a GET and read the
    // 200 HTML login page as success — a delete "worked" while nothing was
    // deleted. Answer 401 JSON for /api/* so the client reports the failure.
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in — log in again.' });
    return res.redirect('/login');
  }
  next();
}

async function refreshAccessToken(req) {
  // Discord access tokens last ~7 days. Discord's authorization-code
  // exchange returns a refresh token with no special scope needed (there is
  // NO `offline` scope in Discord OAuth2 — 1.15.4 added it by mistake and
  // Discord rejected the login outright with "invalid scope"). Use the
  // refresh token to get a fresh access token without making the user log
  // in again. Refresh tokens rotate: store the new one whenever Discord
  // returns one.
  if (!req.session.refreshToken) return false;
  try {
    const res = await axios.post('https://discord.com/api/v10/oauth2/token', new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.dashboard.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: req.session.refreshToken,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    req.session.accessToken = res.data.access_token;
    if (res.data.refresh_token) req.session.refreshToken = res.data.refresh_token;
    if (res.data.expires_in) req.session.tokenExpiresAt = Date.now() + res.data.expires_in * 1000;
    return true;
  } catch (err) {
    console.warn('[dashboard] Discord token refresh failed:', err.response?.data || err.message);
    return false;
  }
}

async function userGuilds(req) {
  // Cached in session for the login; refreshed on each server-picker visit.
  // Refresh proactively when we know the token expired.
  if (req.session.tokenExpiresAt && Date.now() > req.session.tokenExpiresAt && req.session.refreshToken) {
    await refreshAccessToken(req);
  }
  try {
    const res = await discordApi.get('/users/@me/guilds', {
      headers: { Authorization: `Bearer ${req.session.accessToken}` },
    });
    return res.data;
  } catch (err) {
    if (err.response?.status === 401 && req.session.refreshToken) {
      // Token expired mid-flight — refresh once and retry.
      if (await refreshAccessToken(req)) {
        const res = await discordApi.get('/users/@me/guilds', {
          headers: { Authorization: `Bearer ${req.session.accessToken}` },
        });
        return res.data;
      }
    }
    if (err.response?.status === 401) {
      // Refresh failed (or no refresh token — e.g. a session from before
      // 1.15.4). Keep the login itself: req.session.user stays, so pages
      // gated on being logged in keep working — only the Discord connection
      // is dead, and the caller shows a "log in again" notice.
      delete req.session.accessToken;
      delete req.session.refreshToken;
      delete req.session.tokenExpiresAt;
      const expired = new Error('Discord connection expired — log in again to refresh it.');
      expired.authExpired = true;
      throw expired;
    }
    throw err;
  }
}

function canManage(guild) {
  // Manage Guild permission bit (0x20).
  return (BigInt(guild.permissions) & 0x20n) === 0x20n;
}

async function botInGuild(guildId) {
  try {
    await discordApi.get(`/guilds/${guildId}`, { headers: botHeaders() });
    return true;
  } catch { return false; }
}

async function requireGuildAccess(req, res, next) {
  const guildId = req.params.id;
  try {
    const guilds = await userGuilds(req);
    const guild = guilds.find((g) => g.id === guildId);
    if (!guild || !canManage(guild)) return res.status(403).send('You do not have Manage Guild permission for this server.');
    if (!(await botInGuild(guildId))) return res.status(403).send('The bot is not a member of this server. Use "Add to Server" first.');
    req.guildMeta = guild;
    next();
  } catch (err) {
    if (err.authExpired) return res.redirect('/servers');
    console.error('[dashboard] guild access check failed:', err.message);
    res.status(500).send('Could not verify server access — try logging in again.');
  }
}

async function guildChannelsRoles(guildId) {
  const [channels, roles] = await Promise.all([
    discordApi.get(`/guilds/${guildId}/channels`, { headers: botHeaders() }),
    discordApi.get(`/guilds/${guildId}/roles`, { headers: botHeaders() }),
  ]);
  return { channels: channels.data, roles: roles.data };
}


// --- First-run setup wizard routes -------------------------------------------
app.get('/setup', requireSetupAccess, (req, res) => res.redirect('/setup/1'));

app.get('/setup/finish', requireSetupAccess, (req, res) => {
  res.render('setup', {
    user: req.session.user || null, isStaff: false, inviteUrl: inviteUrl(),
    step: { n: 8, id: 'review', title: 'Review & finish' }, steps: SETUP_STEPS,
    data: setupData(req), error: null, links: config._whereToGetKeys || {}, saved: false, finish: true,
    isHttp: req.protocol === 'http' && !isLocalRequest(req), publicUrl: (config.dashboard?.publicUrl || '').replace(/\/$/, ''),
  });
});

app.post('/setup/finish', requireSetupAccess, async (req, res) => {
  const d = setupData(req);
  if (isPlaceholder(d.token) || isPlaceholder(d.clientId)) return res.redirect('/setup/2?error=' + encodeURIComponent('Bot token and client ID are required — go back to step 2.'));
  const configPath = path.join(__dirname, '..', 'config.json');
  const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const next = { ...current };
  next.token = (d.token || '').trim();
  next.clientId = (d.clientId || '').trim();
  next.ownerId = (d.ownerId || '').trim();
  const publicBase = (current.dashboard?.publicUrl || '').replace(/\/$/, '');
  next.dashboard = { ...(current.dashboard || {}), clientSecret: (d.clientSecret || '').trim(), sessionSecret: d.sessionSecret || crypto.randomBytes(32).toString('hex'), port: parseInt(d.port, 10) || 3010, redirectUri: d.redirectUri || (publicBase ? `${publicBase}/callback` : `http://localhost:${parseInt(d.port, 10) || 3010}/callback`) };
  next.database = { ...(current.database || {}), host: d.dbHost || 'localhost', port: parseInt(d.dbPort, 10) || 3306, user: d.dbUser || 'discord_bot', password: d.dbPassword || '', database: d.dbName || 'discord_bot' };
  next.streams = { ...(current.streams || {}), twitch: { ...(current.streams?.twitch || {}), clientId: d.twitchClientId || '', clientSecret: d.twitchClientSecret || '' }, youtube: { ...(current.streams?.youtube || {}), apiKey: d.youtubeApiKey || '' } };
  next.steam = { ...(current.steam || {}), apiKey: d.steamApiKey || '' };
  next.backups = { ...(current.backups || {}), time: d.backupTime || '03:00', retentionDays: parseInt(d.retentionDays, 10) || 30 };
  if (d.embedColor) next.embedColor = d.embedColor;
  if (d.maxQueueSize) next.music = { ...(current.music || {}), maxQueueSize: parseInt(d.maxQueueSize, 10) || 25 };
  if (d.shardingMode) next.sharding = { ...(current.sharding || {}), mode: d.shardingMode };
  next.setupComplete = true;
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  Object.assign(config, next); // update the live in-memory config
  req.session.setupData = null;
  res.render('setup', {
    user: req.session.user || null, isStaff: false, inviteUrl: inviteUrl(),
    step: { n: 8, id: 'review', title: 'Review & finish' }, steps: SETUP_STEPS,
    data: {}, error: null, links: config._whereToGetKeys || {}, saved: true, finish: true,
    botUsername: d.botUsername || null, isHttp: false, publicUrl: (config.dashboard?.publicUrl || '').replace(/\/$/, ''),
  });
});

app.get('/setup/:step', requireSetupAccess, (req, res) => {
  const n = parseInt(req.params.step, 10);
  if (Number.isNaN(n) || n < 1 || n > SETUP_STEPS.length) return res.redirect('/setup/1');
  // Step 8 is "Review & finish", but the template only renders the review
  // table + Save button when `finish` is true (GET /setup/finish). Without
  // this redirect, /setup/8 rendered an empty page with no finish button.
  if (n === 8) return res.redirect('/setup/finish');
  const step = SETUP_STEPS[n - 1];
  res.render('setup', {
    user: req.session.user || null, isStaff: false, inviteUrl: inviteUrl(),
    step, steps: SETUP_STEPS, data: setupData(req), error: req.query.error || null,
    links: config._whereToGetKeys || {}, saved: false, finish: false, botUsername: null,
    isHttp: req.protocol === 'http' && !isLocalRequest(req), publicUrl: (config.dashboard?.publicUrl || '').replace(/\/$/, ''),
  });
});

app.post('/setup/:step', requireSetupAccess, async (req, res) => {
  const n = parseInt(req.params.step, 10);
  const body = req.body || {};
  req.session.setupData = { ...setupData(req), ...body };
  const fail = (msg) => res.redirect(`/setup/${n}?error=${encodeURIComponent(msg)}`);
  if (n === 2) {
    // Discord step: the token MUST test successfully — never save an invalid token.
    const token = (body.token || '').trim();
    if (isPlaceholder(token) || isPlaceholder(body.clientId)) return fail('Bot token and client ID are required.');
    try {
      const r = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${token}` }, timeout: 10_000 });
      if (!r.data?.username) return fail('Discord rejected the token (no username returned).');
      req.session.setupData.botUsername = r.data.username;
    } catch (e) {
      return fail(`Discord test failed: ${e.response?.data?.message || e.message}. Check the token and try again.`);
    }
  }
  if (n === 3) {
    // Database step: test the connection; optionally auto-run sql/schema.sql.
    const mysql = require('mysql2/promise');
    let conn;
    try {
      conn = await mysql.createConnection({
        host: body.dbHost || 'localhost', port: parseInt(body.dbPort, 10) || 3306,
        user: body.dbUser, password: body.dbPassword, database: body.dbName, connectTimeout: 8000,
      });
      await conn.query('SELECT 1');
      if (body.autoRunSchema === 'on' || body.autoRunSchema === true) {
        for (const schemaFile of ['schema.sql', 'premium.sql']) {
          const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', schemaFile), 'utf8');
          // Split on ';', then strip full-line comments from each chunk
          // (a chunk starting with '--' may still contain a CREATE TABLE
          // after the header comment — the old filter dropped those).
          const statements = schema.split(';')
            .map((s) => s.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
            .filter(Boolean);
          for (const stmt of statements) { await conn.query(stmt).catch(() => {}); }
        }
      }
    } catch (e) {
      return fail(`MySQL connection failed: ${e.message}`);
    } finally { if (conn) await conn.end().catch(() => {}); }
  }
  if (n === 8) return res.redirect('/setup/finish');
  return res.redirect(`/setup/${Math.min(n + 1, SETUP_STEPS.length)}`);
});

// Test-connection endpoints used by the wizard (local-only, never log secrets).
app.post('/setup/api/test-discord', requireSetupAccess, async (req, res) => {
  const token = (req.body?.token || '').trim();
  if (!token) return res.status(400).json({ ok: false, error: 'No token provided.' });
  try {
    const r = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${token}` }, timeout: 10_000 });
    res.json({ ok: true, username: r.data.username, id: r.data.id });
  } catch (e) {
    res.json({ ok: false, error: e.response?.data?.message || e.message });
  }
});

app.post('/setup/api/test-db', requireSetupAccess, async (req, res) => {
  const { host, port, user, password, database } = req.body || {};
  const mysql = require('mysql2/promise');
  let conn;
  try {
    conn = await mysql.createConnection({ host: host || 'localhost', port: parseInt(port, 10) || 3306, user, password, database, connectTimeout: 8000 });
    await conn.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally { if (conn) await conn.end().catch(() => {}); }
});

// --- Auth routes ---------------------------------------------------------------
// Public version/changelog page: header version from package.json, entries
// parsed from CHANGELOG.md (see src/utils/changelog.js). Never shows a
// version that isn't in CHANGELOG.md — entries come only from that file.
app.get('/version', (req, res) => {
  const { loadChangelog } = require('./utils/changelog');
  const { version } = require('../package.json');
  // Process start time (1.15.38): the version above comes from package.json
  // on disk, so it cannot prove the running process is fresh — the start
  // time can. If it predates the last restart, the process is stale.
  const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  res.render('version', { user: req.session.user || null, guilds: [], inviteUrl: inviteUrl(), isStaff: false, version, entries: loadChangelog(), startedAt });
});

// Public wiki/docs page: static content from docs/content.json + the command
// reference generated live from src/commands (see src/utils/docs.js).
app.get('/docs', (req, res) => {
  const { getContent, groupedCommands } = require('./utils/docs');
  res.render('docs', { user: req.session.user || null, inviteUrl: inviteUrl(), isStaff: false, content: getContent(), groups: groupedCommands() });
});

app.get('/', (req, res) => {
  if (!req.session.user) return res.render('home', { user: null, guilds: [], inviteUrl: inviteUrl(), isStaff: false });
  res.redirect('/servers');
});

// Login page (1.16.6): Discord OAuth as before, plus a username +
// password form for local dashboard accounts.
app.get('/login', (req, res) => {
  res.render('login', { error: null, username: '' });
});

app.get('/login/discord', (req, res) => {
  const secret = config.dashboard?.clientSecret || '';
  if (!secret || secret.includes('YOUR_')) {
    return res.send('Dashboard OAuth is not configured yet — fill in dashboard.clientSecret in config.json (Discord Developer Portal → OAuth2 → Client Secret), then restart the dashboard.');
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.post('/login/local', handleLocalLogin);

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/');
  try {
    const tokenRes = await axios.post('https://discord.com/api/v10/oauth2/token', new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.dashboard.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    req.session.accessToken = tokenRes.data.access_token;
    // Discord returns a refresh token on the authorization-code exchange
    // with no special scope needed, so the access token (~7 days) can be
    // renewed without another login. Stored in the session alongside the
    // user — see refreshAccessToken().
    if (tokenRes.data.refresh_token) req.session.refreshToken = tokenRes.data.refresh_token;
    if (tokenRes.data.expires_in) req.session.tokenExpiresAt = Date.now() + tokenRes.data.expires_in * 1000;
    const userRes = await discordApi.get('/users/@me', { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
    req.session.user = userRes.data;
    req.session.authType = 'discord';
    delete req.session.localAccount;
    res.redirect('/servers');
  } catch (err) {
    console.error('[dashboard] OAuth callback failed:', err.response?.data || err.message);
    res.send('Login failed — check the dashboard clientSecret / redirectUri in config.json, then try again.');
  }
});

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

// Invite flow: prominent button links here (opens in a new tab); after Discord,
// the user lands on /added.
app.get('/invite', (req, res) => res.redirect(inviteUrl()));
app.get('/added', async (req, res) => res.render('added', { user: req.session.user || null, inviteUrl: inviteUrl(), isStaff: await staffFlag(req) }));

// --- Server picker -------------------------------------------------------------
app.get('/servers', requireAuth, async (req, res) => {
  try {
    const guilds = (await userGuilds(req)).filter(canManage);
    const withBot = [];
    for (const g of guilds) {
      withBot.push({ ...g, botPresent: await botInGuild(g.id) });
    }
    res.render('home', { user: req.session.user, guilds: withBot.filter((g) => g.botPresent), inviteUrl: inviteUrl(), isStaff: await staffFlag(req) });
  } catch (err) {
    console.error('[dashboard] /servers failed:', err.message);
    if (err.authExpired) {
      // Discord connection is dead but the login isn't: show the picker with
      // a "log in again" notice instead of forcing a fresh login.
      return res.render('home', { user: req.session.user, guilds: [], inviteUrl: inviteUrl(), isStaff: await staffFlag(req), authExpired: true });
    }
    res.redirect('/login');
  }
});

// --- Per-server settings pages (one per module) --------------------------------
const MODULES = ['general', 'identity', 'moderation', 'tickets', 'serverstats', 'streams', 'music', 'leveling', 'reactionroles', 'gameservers', 'commands', 'applications', 'invites', 'welcome', 'automod', 'suggestions', 'economy', 'starboard', 'customcommands', 'faq', 'scheduled', 'roles', 'verification', 'counting', 'tempvc', 'birthdays', 'analytics', 'giveaways', 'ai', 'modmail', 'games', 'emojis', 'media', 'threads', 'confessions', 'events', 'embeds', 'embed-creator', 'polls', 'announcements'];

app.get('/guilds/:id', requireAuth, requireGuildAccess, (req, res) => res.redirect(`/guilds/${req.params.id}/general`));

app.get('/guilds/:id/:module', requireAuth, requireGuildAccess, async (req, res) => {
  const { id, module } = req.params;
  if (!MODULES.includes(module)) return res.status(404).send('Unknown settings module.');
  const settings = await getGuildSettings(id);
  const { channels, roles } = await guildChannelsRoles(id).catch(() => ({ channels: [], roles: [] }));
  let streamers = [];
  let tickets = [];
  let gameServers = [];
  let applicationForms = [];
  let pendingApplications = [];
  let inviteLeaderboard = [];
  let inviteStats = [];
  let automodSettings = null;
  let automodActions = [];
  let suggestions = [];
  let premiumSettings = null;
  let shopItems = [];
  let customCommands = [];
  let faqs = [];
  let scheduledMessages = [];
  let countingSettings = null;
  let birthdays = [];
  let reactionRoleMappings = [];
  let analyticsData = null;
  let giveaways = [];
  let aiUsage = null;
  let aiConfigured = false;
  let mcWidgets = [];
  let voiceStats = [];
  let voiceRate = null;
  let colorRoles = [];
  let modmailThreads = [];
  let modmailBlocks = [];
  let workJobs = [];
  let recentRobs = [];
  let tempRoles = [];
  let serverBackups = [];
  let threadOverrides = [];
  let xpShopItems = [];
  let streakStats = [];
  let pendingConfessions = [];
  let ticketPanels = [];
  let inviteRoleRules = [];
  let prestigeLeaderboard = [];
  let countdowns = [];
  let emojis = [];
  let tempBans = [];
  let lotteryStatus = null;
  let lotteryDraws = [];
  let serverRules = null;
  let playlists = [];
  let triviaSettings = null;
  let triviaLeaderboard = [];
  let roleMenus = [];
  let milestoneSettings = null;
  let milestoneNext = null;
  let translateSettings = null;
  let identity = null;
  // 1.7.x / 1.8.x tabs.
  let scheduledEventsList = [];
  let wordleLeaderboard = [];
  let wordleToday = null;
  let slowmodeSchedules = [];
  let statusRoleRules = [];
  let builtEmbeds = [];
  let pastPolls = [];
  let ticketRatingStats = null;
  let inviteRewardList = [];
  let inactiveMembers = null;
  if (db.isEnabled()) {
    streamers = await db.query('SELECT * FROM streamers WHERE guild_id = ?', [id]) || [];
    tickets = await db.query('SELECT * FROM tickets WHERE guild_id = ? ORDER BY id DESC LIMIT 20', [id]) || [];
    gameServers = await db.query('SELECT * FROM game_servers WHERE guild_id = ?', [id]) || [];
    applicationForms = await db.query(`SELECT f.*, (SELECT COUNT(*) FROM applications a WHERE a.form_id = f.id AND a.status = 'pending') AS pending_count, (SELECT COUNT(*) FROM applications a WHERE a.form_id = f.id) AS total_count FROM application_forms f WHERE f.guild_id = ? ORDER BY f.id`, [id]) || [];
    pendingApplications = await db.query(`SELECT a.*, f.name AS form_name FROM applications a JOIN application_forms f ON f.id = a.form_id WHERE a.guild_id = ? AND a.status = 'pending' ORDER BY a.id DESC LIMIT 50`, [id]) || [];
    inviteLeaderboard = await db.query('SELECT user_id, total_invites, valid_invites, leaves, fake_invites FROM user_invites WHERE guild_id = ? ORDER BY valid_invites DESC, total_invites DESC LIMIT 10', [id]) || [];
    inviteStats = await db.query('SELECT user_id, total_invites, valid_invites, leaves, fake_invites, updated_at FROM user_invites WHERE guild_id = ? ORDER BY valid_invites DESC LIMIT 50', [id]) || [];
    const automodRows = await db.query('SELECT * FROM automod_settings WHERE guild_id = ?', [id]) || [];
    automodSettings = automodRows[0] || null;
    automodActions = await db.query('SELECT * FROM automod_actions WHERE guild_id = ? ORDER BY id DESC LIMIT 50', [id]) || [];
    suggestions = await db.query('SELECT * FROM suggestions WHERE guild_id = ? ORDER BY id DESC LIMIT 50', [id]) || [];
    // Premium features (own table, see src/utils/premiumSettings.js).
    const { getPremiumSettings } = require('./utils/premiumSettings');
    premiumSettings = await getPremiumSettings(id);
    shopItems = await db.query('SELECT * FROM shop_items WHERE guild_id = ? ORDER BY price ASC', [id]) || [];
    customCommands = await db.query('SELECT trigger_word, response, use_count FROM custom_commands WHERE guild_id = ? ORDER BY trigger_word', [id]) || [];
    faqs = await db.query('SELECT id, trigger_phrase, response, match_type, use_count FROM faq_responses WHERE guild_id = ? ORDER BY created_at ASC', [id]) || [];
    scheduledMessages = await db.query('SELECT * FROM scheduled_messages WHERE guild_id = ? AND sent = 0 ORDER BY send_at LIMIT 20', [id]) || [];
    const countingRows = await db.query('SELECT * FROM counting_settings WHERE guild_id = ?', [id]) || [];
    countingSettings = countingRows[0] || null;
    birthdays = await db.query('SELECT user_id, month, day, year FROM birthdays WHERE guild_id = ? ORDER BY month, day LIMIT 50', [id]) || [];
    reactionRoleMappings = await db.query('SELECT id, message_id, channel_id, emoji, role_id, required_role_id, min_days_in_server, min_level FROM reaction_roles WHERE guild_id = ? ORDER BY message_id', [id]) || [];
    // Analytics (1.3.4) + giveaways (1.3.1) — only queried for their tabs.
    if (module === 'analytics') {
      const analytics = require('./utils/analytics');
      const { getActiveBoost } = require('./utils/leveling');
      analyticsData = {
        daily: await analytics.getDailyStats(id, 30),
        topXp: await analytics.getTopUsersByXp(id, 10),
        topChannels: await analytics.getTopChannelsByCommands(id, 10),
        topCommandUsers: await analytics.getTopUsersByCommands(id, 10),
        activeBoost: await getActiveBoost(id).catch(() => null),
      };
      // Show names next to IDs in the two user leaderboards (same
      // "Name (id)" labels as the staff list). One resolve call covers
      // both lists; IDs are de-duplicated inside resolveUserLabels, and
      // unresolvable IDs fall back to the raw ID with an "unknown user"
      // note — never crash the page.
      const labels = await resolveUserLabels([
        ...analyticsData.topXp.map((u) => u.user_id),
        ...analyticsData.topCommandUsers.map((u) => u.user_id),
      ]);
      for (const u of [...analyticsData.topXp, ...analyticsData.topCommandUsers]) {
        u.user_label = labels.get(String(u.user_id));
      }
    }
    if (module === 'giveaways') {
      giveaways = await db.query("SELECT * FROM giveaways WHERE guild_id = ? ORDER BY ends_at DESC LIMIT 20", [id]) || [];
    }
    if (module === 'ai') {
      const ai = require('./utils/ai');
      aiUsage = await ai.getDailyUsage(id);
      aiConfigured = ai.isAiConfigured();
    }
    if (module === 'gameservers') {
      mcWidgets = await db.query('SELECT w.*, s.name AS server_name FROM mc_widgets w LEFT JOIN game_servers s ON s.id = w.server_id WHERE w.guild_id = ?', [id]) || [];
    }
    if (module === 'leveling') {
      const { getVoiceLeaderboard } = require('./utils/voiceXp');
      voiceStats = await getVoiceLeaderboard(id, 10);
      voiceRate = settings.voiceXpPerMinute ?? null;
    }
    if (module === 'roles') {
      const { getColorRoles } = require('./utils/colorRoles');
      colorRoles = await getColorRoles(id);
    }
    if (module === 'modmail') {
      modmailThreads = await db.query("SELECT * FROM modmail_threads WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50", [id]) || [];
      modmailBlocks = await db.query('SELECT * FROM modmail_blocks WHERE guild_id = ?', [id]) || [];
    }
    if (module === 'economy') {
      // Work jobs (1.12.3) + recent robberies (1.12.6).
      const { listJobs } = require('./utils/workJobs');
      const { recentRobs: getRecentRobs } = require('./utils/robbery');
      workJobs = await listJobs(id).catch(() => []);
      recentRobs = await getRecentRobs(id, 20).catch(() => []);
    }
    // 1.11.x tabs: ticket panels (tickets), invite role rules (invites),
    if (module === 'moderation') {
      const { getActiveTempbans } = require('./utils/tempban');
      tempBans = await getActiveTempbans(id).catch(() => []) || [];
    }
    if (module === 'economy') {
      const lottery = require('./utils/lottery');
      const weekStart = lottery.formatWeekStart(new Date());
      const sold = await db.query('SELECT COUNT(*) AS n FROM lottery_tickets WHERE guild_id = ? AND week_start = ?', [id, weekStart]) || [];
      lotteryDraws = await db.query('SELECT * FROM lottery_draws WHERE guild_id = ? ORDER BY drawn_at DESC LIMIT 10', [id]) || [];
      lotteryStatus = {
        weekStart,
        ticketsSold: sold[0]?.n || 0,
        jackpot: await lottery.jackpotForWeek(id, weekStart).catch(() => 0),
        nextDraw: lottery.nextDrawDate(new Date()).toISOString(),
      };
    }
    if (module === 'general') {
      const { getRules } = require('./utils/serverRules');
      serverRules = await getRules(id).catch(() => null);
    }
    // prestige leaderboard (leveling), countdowns (scheduled), emojis.
    if (module === 'tickets') {
      ticketPanels = await db.query('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id', [id]).catch(() => []) || [];
    }
    if (module === 'invites') {
      inviteRoleRules = await db.query('SELECT * FROM invite_role_rules WHERE guild_id = ? ORDER BY invite_code', [id]).catch(() => []) || [];
    }
    if (module === 'leveling') {
      const { getPrestigeLeaderboard } = require('./utils/leveling');
      prestigeLeaderboard = await getPrestigeLeaderboard(id, 10);
    }
    if (module === 'scheduled') {
      countdowns = await db.query('SELECT * FROM countdowns WHERE guild_id = ? ORDER BY ends_at', [id]).catch(() => []) || [];
    }
    if (module === 'emojis' || module === 'reactionroles') {
      const res = await discordApi.get(`/guilds/${id}/emojis`, { headers: botHeaders() }).catch(() => null);
      emojis = res?.data || [];
    }
    // 1.10.x tabs: playlists (music), daily trivia (games), role menus (roles),
    // milestones + translate (general).
    if (module === 'music') {
      playlists = await db.query('SELECT * FROM music_playlists WHERE guild_id = ? ORDER BY updated_at DESC LIMIT 100', [id]) || [];
    }
    if (module === 'games') {
      const dailyTrivia = require('./utils/dailyTrivia');
      triviaSettings = await dailyTrivia.getTriviaSettings(id);
      triviaLeaderboard = await dailyTrivia.getTriviaLeaderboard(id, 10);
    }
    if (module === 'roles') {
      roleMenus = await db.query('SELECT m.*, (SELECT COUNT(*) FROM role_menu_items i WHERE i.menu_id = m.id) AS item_count FROM role_menus m WHERE m.guild_id = ? ORDER BY m.id DESC', [id]) || [];
    }
    // 1.15.9: these four were declared above and referenced by settings.ejs
    // but never fetched or passed to the render — opening the Threads,
    // Confessions, or Roles tab threw "X is not defined".
    if (module === 'threads') {
      threadOverrides = await db.query('SELECT channel_id, archive_minutes FROM thread_archive_settings WHERE guild_id = ?', [id]) || [];
    }
    if (module === 'confessions') {
      pendingConfessions = await db.query("SELECT * FROM confessions WHERE guild_id = ? AND status = 'pending' ORDER BY created_at", [id]) || [];
    }
    if (module === 'roles') {
      const { getActiveTempRoles } = require('./utils/tempRoles');
      tempRoles = await getActiveTempRoles(id).catch(() => []) || [];
      const { getShopItems } = require('./utils/xpShop');
      xpShopItems = await getShopItems(id).catch(() => []) || [];
    }
    if (module === 'general') {
      const milestones = require('./utils/milestones');
      const translate = require('./utils/translate');
      milestoneSettings = await milestones.getMilestoneSettings(id);
      const memberCount = req.guildMeta?.approximate_member_count ?? null;
      milestoneNext = memberCount !== null ? (await milestones.nextMilestone(id, memberCount)).next : null;
      translateSettings = await translate.getTranslateSettings(id);
    }
    // Bot identity (1.16.8): stored row + live member state + prefix for
    // the tab. A failed live fetch leaves identity null instead of
    // breaking the page — the tab still renders its forms.
    if (module === 'identity') {
      const { getIdentityView } = require('./utils/dashboardIdentity');
      identity = await getIdentityView(id, { rest: botRest() }).catch(() => null);
    }
    // 1.7.x / 1.8.x tabs: events, wordle (games), slowmode (moderation),
    // status roles (roles), built embeds, past polls, ticket ratings,
    // invite rewards, inactive members (analytics).
    if (module === 'events') {
      const events = require('./utils/scheduledEvents');
      scheduledEventsList = await events.listUpcomingEvents(id, 20);
      for (const ev of scheduledEventsList) ev.rsvpCounts = await events.getRsvpCounts(ev.id);
    }
    if (module === 'games') {
      const wordle = require('./utils/wordle');
      wordleLeaderboard = await wordle.getWordleLeaderboard(id, 10);
      wordleToday = wordle.dailyWord(id, new Date());
    }
    if (module === 'moderation') {
      const { listSchedules } = require('./utils/slowmode');
      slowmodeSchedules = await listSchedules(id).catch(() => []);
    }
    if (module === 'roles') {
      const { getStatusRoles } = require('./utils/statusRoles');
      statusRoleRules = await getStatusRoles(id);
    }
    if (module === 'embeds') {
      const { listEmbeds } = require('./utils/customEmbeds');
      builtEmbeds = await listEmbeds(id, 50);
    }
    if (module === 'polls') {
      pastPolls = await db.query('SELECT * FROM polls WHERE guild_id = ? ORDER BY created_at DESC LIMIT 20', [id]) || [];
      for (const p of pastPolls) {
        try { p.options = JSON.parse(p.options); p.votes = JSON.parse(p.votes || '{}'); } catch { p.options = []; p.votes = {}; }
        try { p.finalCounts = p.final_counts ? JSON.parse(p.final_counts) : null; } catch { p.finalCounts = null; }
      }
    }
    if (module === 'tickets') {
      const { getRatingStats } = require('./utils/ticketRatings');
      ticketRatingStats = await getRatingStats(id);
    }
    if (module === 'invites') {
      const { getInviteRewards } = require('./utils/inviteRewards');
      inviteRewardList = await getInviteRewards(id);
    }
    if (module === 'analytics') {
      // Inactive members (1.8.8): full count via the REST member list
      // (first 1,000 members — the API page size). Best effort; a missing
      // bot token or a huge server leaves it null instead of breaking
      // the page.
      try {
        const { findInactiveMembers } = require('./utils/reengage');
        const res = await discordApi.get(`/guilds/${id}/members?limit=1000`, { headers: botHeaders() }).catch(() => null);
        const list = res?.data || [];
        const map = new Map();
        for (const m of list) map.set(m.user.id, { id: m.user.id, user: { bot: !!m.user.bot }, joinedAt: m.joined_at ? new Date(m.joined_at) : null });
        inactiveMembers = await findInactiveMembers({ id, members: { fetch: async () => map, cache: map } }, settings.reengageDays || 30);
      } catch { inactiveMembers = null; }
    }
  }
  res.render('settings', {
    user: req.session.user, guild: req.guildMeta, module, settings,
    channels, roles, streamers, tickets, gameServers, applicationForms, pendingApplications, inviteLeaderboard, inviteStats, automodSettings, automodActions, suggestions, premiumSettings, shopItems, customCommands, faqs, scheduledMessages, countingSettings, birthdays, reactionRoleMappings, analyticsData, giveaways, aiUsage, aiConfigured, mcWidgets, voiceStats, voiceRate, colorRoles, modmailThreads, modmailBlocks, playlists, triviaSettings, triviaLeaderboard, roleMenus, milestoneSettings, milestoneNext, translateSettings, ticketPanels, inviteRoleRules, prestigeLeaderboard, countdowns, emojis, workJobs, recentRobs, tempBans, lotteryStatus, lotteryDraws, serverRules, identity, inviteUrl: inviteUrl(),
    saved: req.query.saved === '1', isStaff: await staffFlag(req),
    commandCatalog: COMMAND_CATALOG,
    scheduledEventsList, wordleLeaderboard, wordleToday, slowmodeSchedules, statusRoleRules, builtEmbeds, pastPolls, ticketRatingStats, inviteRewardList, inactiveMembers,
    threadOverrides, pendingConfessions, tempRoles, xpShopItems,
    commandToggles: db.isEnabled() ? (await db.query('SELECT command_name, enabled FROM command_toggles WHERE guild_id = ?', [id]) || []) : [],
  });
});

// --- JSON API (same auth + per-guild checks) ------------------------------------
app.get('/api/guilds/:id/settings', requireAuth, requireGuildAccess, async (req, res) => {
  res.json(await getGuildSettings(req.params.id));
});

app.post('/api/guilds/:id/settings', requireAuth, requireGuildAccess, async (req, res) => {
  const body = req.body || {};
  // No-JS fallback: a plain form POST sends urlencoded data — checkboxes
  // arrive as 'on' instead of JSON true. Normalize, and redirect back to
  // the settings page with ?saved=1 instead of returning JSON.
  const isFormPost = req.is('application/x-www-form-urlencoded');
  for (const k of ['serverStatsEnabled', 'levelUpMessages', 'welcomeEnabled', 'goodbyeEnabled', 'verificationEnabled', 'welcomeImageEnabled', 'welcomeImageOnly', 'aiEnabled', 'modmailEnabled', 'djEnabled', 'djOnlySkip', 'music247Enabled', 'robberyEnabled', 'newMemberLinkEnabled', 'welcomeDmEnabled', 'antinukeEnabled', 'afkVoiceEnabled', 'afkAutocreateEnabled', 'reengageEnabled']) if (body[k] === 'on') body[k] = 'true';
  const { channels, roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  const channelIds = new Set(channels.map((c) => c.id));
  const roleIds = new Set(roles.map((r) => r.id));
  const patch = {};
  const setChannel = (key, value) => { if (value === '' || channelIds.has(value)) patch[key] = value || ''; };
  const setRole = (key, value) => { if (value === '' || roleIds.has(value)) patch[key] = value || ''; };
  if ('welcomeChannelId' in body) setChannel('welcomeChannelId', body.welcomeChannelId);
  if ('logChannelId' in body) setChannel('logChannelId', body.logChannelId);
  if ('ticketCategoryId' in body) setChannel('ticketCategoryId', body.ticketCategoryId);
  if ('ticketLogChannelId' in body) setChannel('ticketLogChannelId', body.ticketLogChannelId);
  if ('ticketSupportRoleId' in body) setRole('ticketSupportRoleId', body.ticketSupportRoleId);
  if ('ticketButtonLabel' in body) {
    const { validateTicketButtonLabel } = require('./utils/tickets');
    const err = validateTicketButtonLabel(body.ticketButtonLabel);
    if (err) return res.status(400).json({ error: err });
    patch.ticketButtonLabel = String(body.ticketButtonLabel ?? '').trim();
  }
  if ('djRoleId' in body) setRole('djRoleId', body.djRoleId);
  // DJ mode (1.11.1): on/off + whether only the control commands are gated.
  if ('djEnabled' in body) {
    const want = body.djEnabled === true || body.djEnabled === 'true';
    if (want) {
      const current = await getGuildSettings(req.params.id);
      const roleId = ('djRoleId' in body) ? (body.djRoleId || '') : current.djRoleId;
      if (!roleId) return res.status(400).json({ error: 'Set a DJ role before enabling DJ mode.' });
    }
    patch.djEnabled = want;
  }
  if ('djOnlySkip' in body) patch.djOnlySkip = body.djOnlySkip === true || body.djOnlySkip === 'true';
  // Prestige role (1.11.4): granted when a member prestiges.
  if ('prestigeRoleId' in body) setRole('prestigeRoleId', body.prestigeRoleId);
  if ('warnThreshold' in body) {
    const n = parseInt(body.warnThreshold, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 100) patch.warnThreshold = n || null;
  }
  if ('warnAction' in body && ['timeout', 'kick', 'ban', ''].includes(body.warnAction)) patch.warnAction = body.warnAction || null;
  if ('embedColor' in body && (/^#[0-9a-fA-F]{6}$/.test(body.embedColor) || body.embedColor === '')) patch.embedColor = body.embedColor;
  if ('serverStatsEnabled' in body) patch.serverStatsEnabled = Boolean(body.serverStatsEnabled);
  if ('levelUpMessages' in body) patch.levelUpMessages = body.levelUpMessages === true || body.levelUpMessages === 'true';
  if ('applicationReviewerRoleId' in body) setRole('applicationReviewerRoleId', body.applicationReviewerRoleId);
  if ('inviteLogChannelId' in body) setChannel('inviteLogChannelId', body.inviteLogChannelId);
  if ('inviteMinAccountAgeDays' in body) {
    const n = parseInt(body.inviteMinAccountAgeDays, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 365) patch.inviteMinAccountAgeDays = n;
  }
  if ('liveChannelNameTemplate' in body) {
    const err = validateTemplate(body.liveChannelNameTemplate);
    if (err) return res.status(400).json({ error: err });
    patch.liveChannelNameTemplate = body.liveChannelNameTemplate;
  }
  // Thread archive (1.6.1) + confessions (1.6.4) + birthday role (1.6.5) + streaks (1.6.3).
  if ('threadArchiveMinutes' in body) {
    const n = parseInt(body.threadArchiveMinutes, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 10080) patch.threadArchiveMinutes = n;
  }
  if ('confessionsEnabled' in body) patch.confessionsEnabled = body.confessionsEnabled === true || body.confessionsEnabled === 'true';
  if ('confessionsChannelId' in body) setChannel('confessionsChannelId', body.confessionsChannelId);
  if ('confessionsRequireApproval' in body) patch.confessionsRequireApproval = body.confessionsRequireApproval === true || body.confessionsRequireApproval === 'true';
  if ('birthdayRoleId' in body) setRole('birthdayRoleId', body.birthdayRoleId);
  if ('streakBonusPerDay' in body) {
    const n = parseInt(body.streakBonusPerDay, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 500) patch.streakBonusPerDay = n;
  }
  if ('streakMilestoneBonuses' in body && typeof body.streakMilestoneBonuses === 'string') {
    try { const parsed = JSON.parse(body.streakMilestoneBonuses); if (parsed && typeof parsed === 'object') patch.streakMilestoneBonuses = parsed; } catch {}
  }
  // Anti-ghost-ping (1.5.3).
  if ('ghostpingEnabled' in body) patch.ghostpingEnabled = body.ghostpingEnabled === true || body.ghostpingEnabled === 'true';
  if ('ghostpingChannelId' in body) setChannel('ghostpingChannelId', body.ghostpingChannelId);
  // AI chat (1.4.1) + modmail (1.4.6).
  if ('aiEnabled' in body) patch.aiEnabled = body.aiEnabled === true || body.aiEnabled === 'true';
  if ('aiChannelId' in body) setChannel('aiChannelId', body.aiChannelId);
  if ('modmailEnabled' in body) patch.modmailEnabled = body.modmailEnabled === true || body.modmailEnabled === 'true';
  if ('modmailCategoryId' in body) {
    const v = body.modmailCategoryId;
    if (v === '' || channels.some((c) => c.id === v && c.type === 4)) patch.modmailCategoryId = v || '';
  }
  if ('voiceXpPerMinute' in body) {
    const n = parseInt(body.voiceXpPerMinute, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 100) patch.voiceXpPerMinute = n;
  }
  // Welcome / goodbye (channel must exist in this server; message ≤2000 chars).
  if ('welcomeChannelId' in body) setChannel('welcomeChannelId', body.welcomeChannelId);
  if ('welcomeMessage' in body && typeof body.welcomeMessage === 'string' && body.welcomeMessage.length <= 2000) patch.welcomeMessage = body.welcomeMessage;
  if ('welcomeEnabled' in body) patch.welcomeEnabled = body.welcomeEnabled === true || body.welcomeEnabled === 'true';
  // Welcome images (1.3.6): card image alongside (or instead of) the embed.
  if ('welcomeImageEnabled' in body) patch.welcomeImageEnabled = body.welcomeImageEnabled === true || body.welcomeImageEnabled === 'true';
  if ('welcomeImageOnly' in body) patch.welcomeImageOnly = body.welcomeImageOnly === true || body.welcomeImageOnly === 'true';
  if ('goodbyeChannelId' in body) setChannel('goodbyeChannelId', body.goodbyeChannelId);
  if ('goodbyeMessage' in body && typeof body.goodbyeMessage === 'string' && body.goodbyeMessage.length <= 2000) patch.goodbyeMessage = body.goodbyeMessage;
  if ('goodbyeEnabled' in body) patch.goodbyeEnabled = body.goodbyeEnabled === true || body.goodbyeEnabled === 'true';
  if ('suggestionChannelId' in body) setChannel('suggestionChannelId', body.suggestionChannelId);
  // Verification gate (1.2.1).
  if ('verificationEnabled' in body) patch.verificationEnabled = body.verificationEnabled === true || body.verificationEnabled === 'true';
  if ('verificationChannelId' in body) setChannel('verificationChannelId', body.verificationChannelId);
  if ('verificationRoleId' in body) setRole('verificationRoleId', body.verificationRoleId);
  if ('verificationMode' in body && ['button', 'captcha'].includes(body.verificationMode)) patch.verificationMode = body.verificationMode;
  // Temporary voice channels (1.4.0).
  if ('tempvcCreateChannelId' in body) {
    const v = body.tempvcCreateChannelId;
    if (v === '' || channels.some((c) => c.id === v && c.type === 2)) patch.tempvcCreateChannelId = v || '';
  }
  if ('tempvcCategoryId' in body) {
    const v = body.tempvcCategoryId;
    if (v === '' || channels.some((c) => c.id === v && c.type === 4)) patch.tempvcCategoryId = v || '';
  }
  // 24/7 music mode (1.12.1), booster role (1.12.2), robbery toggle
  // (1.12.6), new-member link block (1.12.5).
  if ('music247Enabled' in body) patch.music247Enabled = body.music247Enabled === true || body.music247Enabled === 'true';
  if ('music247ChannelId' in body) {
    const v = body.music247ChannelId;
    if (v === '' || channels.some((c) => c.id === v && c.type === 2)) patch.music247ChannelId = v || '';
  }
  if ('boosterRoleId' in body) setRole('boosterRoleId', body.boosterRoleId);
  if ('robberyEnabled' in body) patch.robberyEnabled = body.robberyEnabled === true || body.robberyEnabled === 'true';
  if ('newMemberLinkEnabled' in body) patch.newMemberLinkEnabled = body.newMemberLinkEnabled === true || body.newMemberLinkEnabled === 'true';
  if ('newMemberLinkDays' in body) {
    const n = parseInt(body.newMemberLinkDays, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 90) patch.newMemberLinkDays = n;
  }
  // Birthdays (1.6.0) + bump reminders (1.3.0).
  // Welcome DM (1.9.3) + lottery (1.9.4) + anti-nuke (1.9.6).
  if ('welcomeDmEnabled' in body) patch.welcomeDmEnabled = body.welcomeDmEnabled === true || body.welcomeDmEnabled === 'true';
  if ('welcomeDmMessage' in body && typeof body.welcomeDmMessage === 'string' && body.welcomeDmMessage.length <= 2000) patch.welcomeDmMessage = body.welcomeDmMessage;
  if ('lotteryTicketPrice' in body) {
    const n = parseInt(body.lotteryTicketPrice, 10);
    if (!Number.isNaN(n) && n >= 10 && n <= 10000) patch.lotteryTicketPrice = n;
  }
  if ('lotteryChannelId' in body) setChannel('lotteryChannelId', body.lotteryChannelId);
  if ('antinukeEnabled' in body) patch.antinukeEnabled = body.antinukeEnabled === true || body.antinukeEnabled === 'true';
  if ('antinukeAction' in body && ['kick', 'ban', 'lockdown'].includes(body.antinukeAction)) patch.antinukeAction = body.antinukeAction;
  if ('antinukeThreshold' in body) {
    const n = parseInt(body.antinukeThreshold, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 20) patch.antinukeThreshold = n;
  }
  if ('antinukeLogChannelId' in body) setChannel('antinukeLogChannelId', body.antinukeLogChannelId);
  if ('antinukeWhitelistRoles' in body && Array.isArray(body.antinukeWhitelistRoles)) patch.antinukeWhitelistRoles = body.antinukeWhitelistRoles.filter((r) => roleIds.has(r));
  if ('birthdayChannelId' in body) setChannel('birthdayChannelId', body.birthdayChannelId);
  if ('birthdayAnnounceHour' in body) {
    const n = parseInt(body.birthdayAnnounceHour, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 23) patch.birthdayAnnounceHour = n;
  }
  if ('bumpChannelId' in body) setChannel('bumpChannelId', body.bumpChannelId);
  // 1.7.x / 1.8.x settings: level-up announcement channel (1.8.3), AFK
  // voice (1.7.4), image starboard (1.7.5), AFK auto-create (1.8.5),
  // auto-publish (1.8.7), re-engagement (1.8.8).
  if ('levelupChannelId' in body) setChannel('levelupChannelId', body.levelupChannelId);
  if ('afkVoiceEnabled' in body) patch.afkVoiceEnabled = body.afkVoiceEnabled === true || body.afkVoiceEnabled === 'true';
  if ('afkVoiceMinutes' in body) {
    const n = parseInt(body.afkVoiceMinutes, 10);
    if (!Number.isNaN(n) && n >= 5 && n <= 1440) patch.afkVoiceMinutes = n;
  }
  if ('afkVoiceChannelId' in body) {
    const v = body.afkVoiceChannelId;
    if (v === '' || channels.some((c) => c.id === v && c.type === 2)) patch.afkVoiceChannelId = v || '';
  }
  if ('afkVoiceExemptRoleId' in body) setRole('afkVoiceExemptRoleId', body.afkVoiceExemptRoleId);
  if ('imageStarboardChannelId' in body) setChannel('imageStarboardChannelId', body.imageStarboardChannelId);
  if ('imageStarboardThreshold' in body) {
    const n = parseInt(body.imageStarboardThreshold, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 25) patch.imageStarboardThreshold = n;
  }
  if ('afkAutocreateEnabled' in body) patch.afkAutocreateEnabled = body.afkAutocreateEnabled === true || body.afkAutocreateEnabled === 'true';
  if ('afkChannelId' in body) {
    const v = body.afkChannelId;
    if (v === '' || channels.some((c) => c.id === v && c.type === 2)) patch.afkChannelId = v || '';
  }
  if ('afkMaxUsers' in body) {
    const n = parseInt(body.afkMaxUsers, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 99) patch.afkMaxUsers = n;
  }
  if ('autopublishChannels' in body && Array.isArray(body.autopublishChannels)) {
    patch.autopublishChannels = body.autopublishChannels.filter((c) => channelIds.has(c) && channels.some((ch) => ch.id === c && ch.type === 5));
  }
  if ('reengageEnabled' in body) patch.reengageEnabled = body.reengageEnabled === true || body.reengageEnabled === 'true';
  if ('reengageDays' in body) {
    const n = parseInt(body.reengageDays, 10);
    if (!Number.isNaN(n) && n >= 7 && n <= 180) patch.reengageDays = n;
  }
  if ('reengageChannelId' in body) setChannel('reengageChannelId', body.reengageChannelId);
  if ('levelRoles' in body && typeof body.levelRoles === 'object') {
    const clean = {};
    for (const [lvl, roleId] of Object.entries(body.levelRoles)) {
      const n = parseInt(lvl, 10);
      if (!Number.isNaN(n) && n > 0 && roleIds.has(roleId)) clean[n] = roleId;
    }
    patch.levelRoles = clean;
  }
  const { saved, settings } = await setGuildSettings(req.params.id, patch);
  if (!saved) return res.status(503).json({ error: 'Settings saved in memory only — MySQL is not connected.' });
  if (isFormPost) {
    const back = (req.get('Referer') || `/guilds/${req.params.id}`).split('?')[0];
    return res.redirect(`${back}?saved=1`);
  }
  res.json({ ok: true, settings });
});

// --- Bot identity (1.16.8): per-server nickname/avatar/prefix --------------
// Same auth as every other per-server route: a Discord login with Manage
// Guild in this server (requireGuildAccess). Local dashboard accounts never
// get guild access (1.16.6), so they cannot reach these routes either.
// The avatar picture and the prefix are dashboard-only; the nickname can
// also be changed with /botidentity in Discord.
app.post('/api/guilds/:id/identity', requireAuth, requireGuildAccess, async (req, res) => {
  try {
    const { setIdentity } = require('./utils/dashboardIdentity');
    const result = await setIdentity(req.params.id, req.body || {}, { rest: botRest() });
    if (req.is('application/x-www-form-urlencoded')) return res.redirect(`/guilds/${req.params.id}/identity?saved=1`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[dashboard] identity save failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Avatar upload: the browser POSTs the raw image bytes (Content-Type is
// the file's MIME type) — no multipart dependency. express.raw parses it;
// the global json/urlencoded parsers skip non-JSON/form bodies, so the
// bytes arrive untouched.
app.post('/api/guilds/:id/identity/avatar', requireAuth, requireGuildAccess, express.raw({ type: 'image/*', limit: '8mb' }), async (req, res) => {
  try {
    const { uploadAvatar } = require('./utils/dashboardIdentity');
    const result = await uploadAvatar(req.params.id, req.body, { rest: botRest() });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[dashboard] identity avatar upload failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/guilds/:id/identity/avatar/reset', requireAuth, requireGuildAccess, async (req, res) => {
  try {
    const { resetAvatar } = require('./utils/dashboardIdentity');
    const result = await resetAvatar(req.params.id, { rest: botRest() });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[dashboard] identity avatar reset failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// --- Welcome image preview (1.3.6) ---------------------------------------------
// Generates a sample card (sample avatar/name) so admins can see the look
// before enabling it. Returns a PNG.
app.get('/api/guilds/:id/welcome-preview', requireAuth, requireGuildAccess, async (req, res) => {
  const { generateWelcomeCard, canvasAvailable } = require('./utils/welcomeCard');
  if (!canvasAvailable) return res.status(503).json({ error: 'Canvas is not installed on the host — welcome images are unavailable.' });
  const guild = await discordApi.get(`/guilds/${req.params.id}`, { headers: botHeaders() }).catch(() => null);
  const buf = await generateWelcomeCard({
    username: 'Ace',
    avatarUrl: null,
    serverName: guild?.data?.name || 'Your Server',
    memberCount: 42,
  }).catch(() => null);
  if (!buf) return res.status(500).json({ error: 'Card generation failed.' });
  res.setHeader('Content-Type', 'image/png');
  res.send(buf);
});

// --- Rank card preview (1.8.9) -------------------------------------------------
// Generates a sample rank card (sample avatar/name/stats) so admins can see
// the look. Returns a PNG.
app.get('/api/guilds/:id/rankcard-preview', requireAuth, requireGuildAccess, async (req, res) => {
  const { generateRankCard, canvasAvailable } = require('./utils/rankCard');
  if (!canvasAvailable) return res.status(503).json({ error: 'Canvas is not installed on the host — rank card images are unavailable.' });
  const buf = await generateRankCard({
    avatarUrl: null,
    username: 'Ace',
    level: 12,
    xp: 340,
    xpToNext: 500,
    rank: 3,
    totalMessages: 1284,
  }).catch(() => null);
  if (!buf) return res.status(500).json({ error: 'Card generation failed.' });
  res.setHeader('Content-Type', 'image/png');
  res.send(buf);
});

// --- Event scheduler API (1.7.2) ------------------------------------------------
// Create an event from the dashboard (posts the embed + RSVP buttons via
// the REST API, same as /event create) and cancel one.
app.post('/api/guilds/:id/events', requireAuth, requireGuildAccess, async (req, res) => {
  const { title, description, channelId, startsAt } = req.body || {};
  if (!title || typeof title !== 'string' || title.length > 256) return res.status(400).json({ error: 'A title (max 256 chars) is required.' });
  if (!channelId || !startsAt || Number.isNaN(new Date(startsAt).getTime())) return res.status(400).json({ error: 'A channel and a valid start time are required.' });
  if (new Date(startsAt) <= new Date()) return res.status(400).json({ error: 'The start time must be in the future.' });
  const events = require('./utils/scheduledEvents');
  const eventId = await events.createEvent(req.params.id, channelId, title, description || null, new Date(startsAt), req.session.user?.id || null);
  const event = await events.getEvent(eventId);
  const msgRes = await discordApi.post(`/channels/${channelId}/messages`, {
    embeds: [events.eventEmbed(event, { going: 0, maybe: 0, not_going: 0 }).toJSON()],
    components: [events.eventRow(eventId).toJSON()],
  }, { headers: botHeaders() }).catch(() => null);
  if (!msgRes?.data?.id) return res.status(502).json({ error: 'Event saved but the message could not be posted — check the bot can send in that channel.' });
  await db.query('UPDATE scheduled_events SET message_id = ? WHERE id = ?', [msgRes.data.id, eventId]);
  res.json({ ok: true, id: eventId });
});

app.post('/api/guilds/:id/events/:eventId/cancel', requireAuth, requireGuildAccess, async (req, res) => {
  const events = require('./utils/scheduledEvents');
  const event = await events.getEvent(Number(req.params.eventId));
  if (!event || event.guild_id !== req.params.id) return res.status(404).json({ error: 'Event not found in this server.' });
  await events.cancelEvent(event.id);
  if (event.message_id) {
    await discordApi.delete(`/channels/${event.channel_id}/messages/${event.message_id}`, { headers: botHeaders() }).catch(() => {});
  }
  res.json({ ok: true });
});

// --- Slowmode schedules API (1.7.3) ----------------------------------------------
app.post('/api/guilds/:id/slowmode-schedules', requireAuth, requireGuildAccess, async (req, res) => {
  const { channelId, daySeconds, nightSeconds, nightStart, nightEnd } = req.body || {};
  const day = parseInt(daySeconds, 10);
  const night = parseInt(nightSeconds, 10);
  const start = parseInt(nightStart, 10);
  const end = parseInt(nightEnd, 10);
  if (!channelId || [day, night, start, end].some((n) => Number.isNaN(n))) return res.status(400).json({ error: 'Channel, day/night seconds and night start/end hours are required.' });
  if (day < 0 || day > 21600 || night < 0 || night > 21600) return res.status(400).json({ error: 'Slowmode seconds must be 0–21600.' });
  if (start < 0 || start > 23 || end < 0 || end > 23) return res.status(400).json({ error: 'Night hours must be 0–23.' });
  const { setSchedule } = require('./utils/slowmode');
  await setSchedule(req.params.id, channelId, { name: 'default', daySeconds: day, nightSeconds: night, nightStart: start, nightEnd: end });
  res.json({ ok: true });
});

app.post('/api/guilds/:id/slowmode-schedules/:channelId/remove', requireAuth, requireGuildAccess, async (req, res) => {
  const { removeSchedule } = require('./utils/slowmode');
  await removeSchedule(req.params.id, req.params.channelId);
  res.json({ ok: true });
});

// --- Status roles API (1.7.6) ----------------------------------------------------
app.post('/api/guilds/:id/statusroles', requireAuth, requireGuildAccess, async (req, res) => {
  const { triggerText, roleId } = req.body || {};
  if (!triggerText || typeof triggerText !== 'string' || triggerText.length > 128) return res.status(400).json({ error: 'Trigger text (max 128 chars) is required.' });
  if (!roleId) return res.status(400).json({ error: 'A role is required.' });
  const { addStatusRole } = require('./utils/statusRoles');
  await addStatusRole(req.params.id, triggerText, roleId, req.session.user?.id || null);
  res.json({ ok: true });
});

app.post('/api/guilds/:id/statusroles/:trigger/remove', requireAuth, requireGuildAccess, async (req, res) => {
  const triggerText = decodeURIComponent(req.params.trigger || '');
  if (!triggerText) return res.status(400).json({ error: 'Trigger text is required.' });
  const { removeStatusRole } = require('./utils/statusRoles');
  await removeStatusRole(req.params.id, triggerText);
  res.json({ ok: true });
});

// --- Invite rewards API (1.8.4) --------------------------------------------------
app.post('/api/guilds/:id/inviterewards', requireAuth, requireGuildAccess, async (req, res) => {
  const { invites, type, roleId, coins } = req.body || {};
  const n = parseInt(invites, 10);
  if (Number.isNaN(n) || n < 1 || n > 10000) return res.status(400).json({ error: 'Invites must be 1–10000.' });
  if (type !== 'role' && type !== 'coins') return res.status(400).json({ error: 'Type must be role or coins.' });
  if (type === 'role' && !roleId) return res.status(400).json({ error: 'A role is required for role rewards.' });
  if (type === 'coins' && (!coins || parseInt(coins, 10) < 1)) return res.status(400).json({ error: 'A coin amount is required for coin rewards.' });
  const { addInviteReward } = require('./utils/inviteRewards');
  await addInviteReward(req.params.id, n, type, roleId || null, parseInt(coins, 10) || null, req.session.user?.id || null);
  res.json({ ok: true });
});

app.post('/api/guilds/:id/inviterewards/:invites/remove', requireAuth, requireGuildAccess, async (req, res) => {
  const { removeInviteReward } = require('./utils/inviteRewards');
  await removeInviteReward(req.params.id, parseInt(req.params.invites, 10));
  res.json({ ok: true });
});

// --- Built embeds API (1.7.8) ----------------------------------------------------
// Edit (form) or delete a built embed — updates the stored JSON and the
// live Discord message via the REST API.
app.post('/api/guilds/:id/embeds/:messageId/edit', requireAuth, requireGuildAccess, async (req, res) => {
  const { title, description, color } = req.body || {};
  const { getEmbedByMessage, updateEmbed, buildEmbedFromData } = require('./utils/customEmbeds');
  const row = await getEmbedByMessage(req.params.id, req.params.messageId);
  if (!row) return res.status(404).json({ error: 'Embed not found in this server.' });
  let data;
  try { data = JSON.parse(row.embed_json); } catch { data = {}; }
  if (title !== undefined) data.title = String(title).slice(0, 256);
  if (description !== undefined) data.description = String(description).slice(0, 4096);
  if (color !== undefined && (/^#[0-9a-fA-F]{6}$/.test(color) || color === '')) data.color = color || data.color;
  await updateEmbed(row.id, req.params.id, data);
  await discordApi.patch(`/channels/${row.channel_id}/messages/${row.message_id}`, {
    embeds: [buildEmbedFromData(data).toJSON()],
  }, { headers: botHeaders() }).catch(() => {});
  res.json({ ok: true });
});

app.post('/api/guilds/:id/embeds/:messageId/delete', requireAuth, requireGuildAccess, async (req, res) => {
  const { getEmbedByMessage, deleteEmbed } = require('./utils/customEmbeds');
  const row = await getEmbedByMessage(req.params.id, req.params.messageId);
  if (!row) return res.status(404).json({ error: 'Embed not found in this server.' });
  await deleteEmbed(row.id, req.params.id);
  await discordApi.delete(`/channels/${row.channel_id}/messages/${row.message_id}`, { headers: botHeaders() }).catch(() => {});
  res.json({ ok: true });
});

// Embed Creator for regular users (1.15.31): the same composer as the
// staff version (same form, same live preview, same shared buildEmbed()
// validation, same send path, same audit log with the sending user's
// id) — but per-server under requireAuth + requireGuildAccess instead
// of requireStaff. requireGuildAccess means: the user is a member of
// the guild AND has Manage Server permission there, and the bot is in
// the guild. So this is usable by server managers/admins, NOT by
// every member — a regular member without Manage Server gets 403.
// The guild comes from the URL (:id); a guildId in the body is ignored.
app.post('/api/guilds/:id/embed-creator', requireAuth, requireGuildAccess, async (req, res) => {
  const guildId = req.params.id;
  const { channelId } = req.body || {};
  if (!channelId || !/^\d{17,20}$/.test(String(channelId))) return res.status(400).json({ error: 'Pick a text channel.' });
  let payload;
  try {
    payload = require('./utils/embedBuilder').buildEmbed(req.body || {});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  // The channel must be a real text channel in this guild — the picker
  // only offers those, but the id comes from the client, so verify.
  const { channels } = await guildChannelsRoles(guildId).catch(() => ({ channels: [] }));
  const channel = channels.find((c) => c.id === channelId && c.type === 0);
  if (!channel) return res.status(400).json({ error: 'That channel does not exist in this server (or is not a text channel).' });
  try {
    const msg = await discordApi.post(`/channels/${channelId}/messages`, payload, { headers: botHeaders() });
    await staffUtils.audit(req.session.user.id, 'embed.send', channelId, `guild=${guildId} msg=${msg.data.id} title=${payload.embeds[0].title || '(no title)'}`);
    res.json({ ok: true, messageId: msg.data.id, channelId, channelName: channel.name });
  } catch (e) {
    const detail = e.response?.data?.message || e.message;
    const status = e.response?.status === 403 ? 403 : 400;
    res.status(status).json({ error: `Discord refused the send: ${detail}` });
  }
});

// Discord REST adapter for the reaction-roles routes (the dashboard has no
// bot client, so routes go through discordApi with the bot token).
function reactionRolesDiscord() {
  return {
    getMessage: async (chId, msgId) => (await discordApi.get(`/channels/${chId}/messages/${msgId}`, { headers: botHeaders() }).catch(() => null))?.data || null,
    listGuildEmojis: async (gId) => (await discordApi.get(`/guilds/${gId}/emojis`, { headers: botHeaders() }).catch(() => null))?.data || [],
    listGuildRoles: async (gId) => (await discordApi.get(`/guilds/${gId}/roles`, { headers: botHeaders() }).catch(() => null))?.data || [],
    patchMessage: async (chId, msgId, body) => { await discordApi.patch(`/channels/${chId}/messages/${msgId}`, body, { headers: botHeaders() }); },
  };
}

// --- Reaction roles API (1.15.32, bulk add 1.15.33) ---------------------------
// Add reaction-role mapping(s) from the dashboard, in the exact shape
// /reactionroles-add writes. Same gating as the rest of the settings page
// (requireAuth + requireGuildAccess = guild member with Manage Server).
// The bot reads mappings from the DB per button click, so no bot restart
// is needed — and the message's buttons are refreshed here via REST using
// the same buildRows() the bot command uses.
// Accepts either one mapping ({channelId, messageId, roleId, emojiCustom,
// emojiUnicode}) — same response shape as 1.15.32 — or a batch
// ({mappings: [...]}, at most 25 rows), which returns per-row results:
// { ok: true, results: [{index, ok, error?, ...}], saved, failed }.
// A bad row never blocks the others.
app.post('/api/guilds/:id/reaction-roles', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const guildId = req.params.id;
  const body = req.body || {};
  const isBatch = Array.isArray(body.mappings);
  const rawRows = isBatch ? body.mappings : [body];
  if (!rawRows.length) return res.status(400).json({ error: 'Add at least one reaction role.' });
  if (rawRows.length > 25) return res.status(400).json({ error: 'Add at most 25 reaction roles at once.' });
  const { resolveEmojiInput, addMapping, addMappingsBatch } = require('./utils/reactionRoles');
  // Route-level checks, per row (same as the 1.15.32 single checks): id
  // shapes, emoji resolution, and the channel/role must be real in this
  // guild — the pickers only offer those, but the ids come from the client.
  const { channels, roles } = await guildChannelsRoles(guildId).catch(() => ({ channels: [], roles: [] }));
  const rows = rawRows.map((raw) => {
    const { channelId, messageId, roleId, emojiCustom, emojiUnicode } = raw || {};
    if (!channelId || !/^\d{17,20}$/.test(String(channelId))) return { error: 'Pick a text channel.' };
    if (!messageId || !/^\d{17,20}$/.test(String(messageId))) return { error: 'Enter a message ID (17–20 digits).' };
    if (!roleId || !/^\d{17,20}$/.test(String(roleId))) return { error: 'Pick a role.' };
    let emoji;
    try {
      emoji = resolveEmojiInput(emojiCustom, emojiUnicode);
    } catch (e) {
      return { error: e.message };
    }
    const channel = channels.find((c) => c.id === channelId && c.type === 0);
    if (!channel) return { error: 'That channel does not exist in this server (or is not a text channel).' };
    const role = roles.find((r) => r.id === roleId);
    if (!role) return { error: 'That role does not exist in this server.' };
    if (role.id === guildId) return { error: 'The @everyone role cannot be a reaction role.' };
    return { channelId, messageId, roleId, emoji, channelName: channel.name, roleName: role.name };
  });
  const discord = reactionRolesDiscord();
  if (!isBatch) {
    // Single: identical behavior to 1.15.32.
    const row = rows[0];
    if (row.error) return res.status(400).json({ error: row.error });
    try {
      await addMapping({ guildId, channelId: row.channelId, messageId: row.messageId, emoji: row.emoji, roleId: row.roleId, botUserId: config.clientId }, discord);
    } catch (e) {
      // 1.15.39: a failed save is recorded in the error log (Staff Errors
      // page) as well as the dashboard console — before this, the live
      // "could not be saved" failures left no row there at all.
      if (/could not be saved/.test(e.message || '')) {
        await errorLogger.log({ level: 'error', guildId, commandName: 'reactionroles-add', message: `Dashboard reaction-role add failed: ${e.message}`, context: { guildId, channelId: row.channelId, messageId: row.messageId, emoji: row.emoji, roleId: row.roleId } }).catch(() => {});
      }
      return res.status(e.status || 400).json({ error: e.message });
    }
    await staffUtils.audit(req.session.user.id, 'reaction-role.add', row.messageId, `guild=${guildId} channel=${row.channelId} emoji=${row.emoji} role=${row.roleId}`).catch(() => {});
    return res.json({ ok: true, messageId: row.messageId, channelId: row.channelId, channelName: row.channelName, roleName: row.roleName, emoji: row.emoji });
  }
  const validIdx = new Map();
  const helperRows = [];
  rows.forEach((row, i) => { if (!row.error) { validIdx.set(i, helperRows.length); helperRows.push(row); } });
  const helperResults = await addMappingsBatch({ guildId, botUserId: config.clientId, rows: helperRows }, discord);
  const results = rows.map((row, i) => {
    if (row.error) return { index: i, ok: false, error: row.error };
    const hr = helperResults[validIdx.get(i)];
    if (!hr || !hr.ok) return { index: i, ok: false, error: hr?.error || 'Failed.' };
    return { index: i, ok: true, messageId: row.messageId, channelId: row.channelId, channelName: row.channelName, roleName: row.roleName, roleId: row.roleId, emoji: row.emoji };
  });
  for (const r of results) {
    if (r.ok) await staffUtils.audit(req.session.user.id, 'reaction-role.add', r.messageId, `guild=${guildId} channel=${r.channelId} emoji=${r.emoji} role=${r.roleId}`).catch(() => {});
  }
  // 1.15.39: failed saves are recorded in the error log (Staff Errors
  // page) — the live "could not be saved" failures previously left no row
  // there at all. Validation failures are not logged (they are user input,
  // not server errors).
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.ok && /could not be saved/.test(r.error || '')) {
      const row = rows[i];
      await errorLogger.log({ level: 'error', guildId, commandName: 'reactionroles-add', message: `Dashboard reaction-role add failed: ${r.error}`, context: { guildId, channelId: row?.channelId, messageId: row?.messageId, emoji: row?.emoji, roleId: row?.roleId } }).catch(() => {});
    }
  }
  const saved = results.filter((r) => r.ok).length;
  res.json({ ok: true, results, saved, failed: results.length - saved });
});

// Remove one reaction-role mapping (1.15.33). Deletes the row, then refreshes
// that message's buttons via REST using the same buildRows() path, so the
// removed button disappears from the message. If the message itself is
// already gone from Discord, the mapping is still deleted and the removal
// reports success.
app.delete('/api/guilds/:id/reaction-roles/:mappingId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const guildId = req.params.id;
  const mappingId = req.params.mappingId;
  if (!/^\d+$/.test(String(mappingId))) return res.status(400).json({ error: 'Unknown mapping.' });
  const found = await db.query('SELECT * FROM reaction_roles WHERE id = ? AND guild_id = ?', [mappingId, guildId]);
  const mapping = found?.[0];
  if (!mapping) return res.status(404).json({ error: 'That mapping no longer exists.' });
  const { removeMapping } = require('./utils/reactionRoles');
  const result = await removeMapping({ guildId, channelId: mapping.channel_id, messageId: mapping.message_id, emoji: mapping.emoji }, reactionRolesDiscord());
  await staffUtils.audit(req.session.user.id, 'reaction-role.remove', mapping.message_id, `guild=${guildId} mapping=${mappingId} emoji=${mapping.emoji} role=${mapping.role_id}`).catch(() => {});
  res.json({ ok: true, messageId: mapping.message_id, messageGone: result.messageGone, warning: result.warning });
});

// Remove several reaction-role mappings at once (1.15.33). Accepts
// { ids: [...] }; deletes every listed mapping, refreshes each affected
// message's buttons once (grouped by message, same buildRows() path), and
// returns per-id results: { id, ok: true, ... } or { id, ok: false, error:
// 'not-found' }. A mapping whose message is already gone from Discord is
// still deleted and reported removed.
app.post('/api/guilds/:id/reaction-roles/bulk-delete', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const guildId = req.params.id;
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String))].filter((id) => /^\d+$/.test(id));
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one mapping to remove.' });
  if (ids.length > 100) return res.status(400).json({ error: 'Remove at most 100 mappings at once.' });
  const placeholders = ids.map(() => '?').join(',');
  const found = await db.query(`SELECT * FROM reaction_roles WHERE guild_id = ? AND id IN (${placeholders})`, [guildId, ...ids]);
  const rowsById = new Map((found || []).map((row) => [String(row.id), row]));
  const helperRows = ids.filter((id) => rowsById.has(id)).map((id) => rowsById.get(id));
  const { removeMappingsBatch } = require('./utils/reactionRoles');
  const helperResults = await removeMappingsBatch({ guildId, rows: helperRows }, reactionRolesDiscord());
  const resultById = new Map();
  helperRows.forEach((row, i) => resultById.set(String(row.id), helperResults[i]));
  const results = ids.map((id) => {
    if (!rowsById.has(id)) return { id, ok: false, error: 'not-found' };
    const hr = resultById.get(id) || {};
    return { id, ok: true, messageId: rowsById.get(id).message_id, messageGone: !!hr.messageGone, warning: hr.warning };
  });
  for (const r of results) {
    if (r.ok) await staffUtils.audit(req.session.user.id, 'reaction-role.remove', r.messageId, `guild=${guildId} mapping=${r.id}`).catch(() => {});
  }
  const removed = results.filter((r) => r.ok).length;
  res.json({ ok: true, results, removed, notFound: results.length - removed });
});

// Re-apply a message's reaction-role buttons from the current DB mappings
// (1.15.36). Same buildRows() path as add/remove, so the buttons come back
// in the new emoji + role-name style. Works even when nothing changed — it
// just re-patches. A message that no longer exists in Discord is reported
// clearly (404) instead of failing silently; the mappings stay saved.
app.post('/api/guilds/:id/reaction-roles/refresh', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const guildId = req.params.id;
  const { channelId, messageId } = req.body || {};
  if (!channelId || !/^\d{17,20}$/.test(String(channelId))) return res.status(400).json({ error: 'Pick a text channel.' });
  if (!messageId || !/^\d{17,20}$/.test(String(messageId))) return res.status(400).json({ error: 'Enter a message ID (17–20 digits).' });
  const mappings = await db.query('SELECT id FROM reaction_roles WHERE guild_id = ? AND channel_id = ? AND message_id = ?', [guildId, channelId, messageId]);
  if (!mappings?.length) return res.status(404).json({ error: 'No reaction-role mappings for that message in this server.' });
  const { refreshMessageButtons } = require('./utils/reactionRoles');
  try {
    await refreshMessageButtons(channelId, messageId, reactionRolesDiscord(), guildId);
  } catch (err) {
    const status = err.response?.status;
    const code = err.response?.data?.code;
    if (status === 404 || code === 10008) return res.status(404).json({ error: 'That message no longer exists in Discord — the mappings are still saved.' });
    const detail = err.response?.data?.message || err.message || 'unknown error';
    return res.status(502).json({ error: `Discord refused the button update (${detail}).` });
  }
  await staffUtils.audit(req.session.user.id, 'reaction-role.refresh', messageId, `guild=${guildId} channel=${channelId} count=${mappings.length}`).catch(() => {});
  res.json({ ok: true, count: mappings.length, messageId });
});

// --- Color roles API (1.4.4) ---------------------------------------------------
app.post('/api/guilds/:id/colorroles', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { roleId } = req.body || {};
  const { roles } = await guildChannelsRoles(req.params.id).catch(() => ({ roles: [] }));
  const role = roles.find((r) => r.id === roleId);
  if (!role) return res.status(400).json({ error: 'Role does not exist in this server.' });
  if (!role.color) return res.status(400).json({ error: 'That role has the default (no) color — give it a color first.' });
  const { addColorRole } = require('./utils/colorRoles');
  await addColorRole(req.params.id, role.id, `#${role.color.toString(16).padStart(6, '0')}`, role.name);
  res.json({ ok: true });
});

app.delete('/api/guilds/:id/colorroles/:roleId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { removeColorRole } = require('./utils/colorRoles');
  await removeColorRole(req.params.id, req.params.roleId);
  res.json({ ok: true });
});

// --- 1.10.x APIs: playlists, daily trivia, milestones, translate, role menus ---
app.delete('/api/guilds/:id/playlists/:playlistId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM music_playlists WHERE id = ? AND guild_id = ?', [req.params.playlistId, req.params.id]);
  if (!rows?.length) return res.status(404).json({ error: 'Playlist not found.' });
  await db.query('DELETE FROM music_playlists WHERE id = ?', [req.params.playlistId]);
  res.json({ ok: true });
});

app.delete('/api/guilds/:id/rolemenus/:menuId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { deleteMenu, getMenu } = require('./utils/roleMenus');
  const menu = await getMenu(req.params.id, Number(req.params.menuId));
  if (!menu) return res.status(404).json({ error: 'Role menu not found.' });
  await deleteMenu(req.params.id, Number(req.params.menuId));
  res.json({ ok: true });
});

app.post('/api/guilds/:id/trivia-settings', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const body = req.body || {};
  const { channels } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [] }));
  const channelId = body.channelId === '' ? '' : (channels.some((c) => c.id === body.channelId && c.type === 0) ? body.channelId : null);
  if (channelId === null) return res.status(400).json({ error: 'That channel does not exist in this server.' });
  const hour = parseInt(body.hour, 10);
  if (Number.isNaN(hour) || hour < 0 || hour > 23) return res.status(400).json({ error: 'Hour must be 0–23 (UTC).' });
  const { saveTriviaSettings } = require('./utils/dailyTrivia');
  await saveTriviaSettings(req.params.id, { channelId, hour, enabled: body.enabled === true || body.enabled === 'true' });
  if (req.is('application/x-www-form-urlencoded')) return res.redirect(`/guilds/${req.params.id}/games?saved=1`);
  res.json({ ok: true });
});

app.post('/api/guilds/:id/milestone-settings', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const body = req.body || {};
  const { channels } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [] }));
  const channelId = body.channelId === '' ? '' : (channels.some((c) => c.id === body.channelId && c.type === 0) ? body.channelId : null);
  if (channelId === null) return res.status(400).json({ error: 'That channel does not exist in this server.' });
  const { saveMilestoneSettings } = require('./utils/milestones');
  await saveMilestoneSettings(req.params.id, { channelId, enabled: body.enabled === true || body.enabled === 'true' });
  if (req.is('application/x-www-form-urlencoded')) return res.redirect(`/guilds/${req.params.id}/general?saved=1`);
  res.json({ ok: true });
});

app.post('/api/guilds/:id/translate-settings', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const body = req.body || {};
  const { channels } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [] }));
  const channelIds = Array.isArray(body.channels) ? body.channels : (body.channelId ? [body.channelId] : []);
  const valid = channelIds.filter((id) => channels.some((c) => c.id === id && c.type === 0));
  const targetLang = (body.targetLang || 'en').toLowerCase();
  const { SUPPORTED, saveTranslateSettings } = require('./utils/translate');
  if (!SUPPORTED[targetLang]) return res.status(400).json({ error: 'Unsupported target language.' });
  await saveTranslateSettings(req.params.id, {
    enabled: body.enabled === true || body.enabled === 'true',
    channels: valid,
    targetLang,
  });
  if (req.is('application/x-www-form-urlencoded')) return res.redirect(`/guilds/${req.params.id}/general?saved=1`);
  res.json({ ok: true });
});

// --- Stream clip toggle API (1.4.5) --------------------------------------------
app.post('/api/guilds/:id/streamers/:streamerId/clip', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const enabled = req.body?.enabled === true || req.body?.enabled === 'true';
  const rows = await db.query('SELECT * FROM streamers WHERE id = ? AND guild_id = ?', [req.params.streamerId, req.params.id]);
  if (!rows?.length) return res.status(404).json({ error: 'Streamer not found.' });
  await db.query('UPDATE streamers SET include_clip = ? WHERE id = ?', [enabled ? 1 : 0, req.params.streamerId]);
  res.json({ ok: true, include_clip: enabled });
});

// --- Minecraft widget API (1.4.2) ----------------------------------------------
app.delete('/api/guilds/:id/mcwidgets/:widgetId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('DELETE FROM mc_widgets WHERE id = ? AND guild_id = ?', [req.params.widgetId, req.params.id]);
  res.json({ ok: true });
});

// --- Modmail API (1.4.6) --------------------------------------------------------
// Close a thread: mark closed in DB, DM the user, delete the channel.
app.post('/api/guilds/:id/modmail/:threadId/close', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const rows = await db.query("SELECT * FROM modmail_threads WHERE id = ? AND guild_id = ? AND status = 'open'", [req.params.threadId, req.params.id]);
  const thread = rows?.[0];
  if (!thread) return res.status(404).json({ error: 'Open thread not found.' });
  await db.query("UPDATE modmail_threads SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE id = ?", [req.session.user.id, thread.id]);
  // DM the user via the bot token.
  try {
    const dm = await discordApi.post('/users/@me/channels', { recipient_id: thread.user_id }, { headers: botHeaders() });
    if (dm?.data?.id) {
      await discordApi.post(`/channels/${dm.data.id}/messages`, { embeds: [{ title: '📬 Modmail closed', description: 'Your modmail thread has been closed by staff. DM the bot again if you need anything else.', color: 0x5865f2 }] }, { headers: botHeaders() });
    }
  } catch {}
  try { await discordApi.delete(`/channels/${thread.channel_id}`, { headers: botHeaders() }); } catch {}
  res.json({ ok: true });
});

app.delete('/api/guilds/:id/modmail-blocks/:userId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('DELETE FROM modmail_blocks WHERE guild_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
  res.json({ ok: true });
});

// --- Thread archive API (1.6.1) -----------------------------------------------
app.post('/api/guilds/:id/thread-archive', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { channels } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [] }));
  const { channelId, minutes } = req.body || {};
  if (!channels.some((c) => c.id === channelId)) return res.status(400).json({ error: 'Channel does not exist in this server.' });
  const mins = parseInt(minutes, 10);
  if (Number.isNaN(mins) || mins < 0 || mins > 10080) return res.status(400).json({ error: 'Minutes must be 0–10080.' });
  await db.query(
    'INSERT INTO thread_archive_settings (guild_id, channel_id, archive_minutes) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE archive_minutes = VALUES(archive_minutes)',
    [req.params.id, channelId, mins],
  );
  res.json({ ok: true });
});

app.delete('/api/guilds/:id/thread-archive/:channelId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('DELETE FROM thread_archive_settings WHERE guild_id = ? AND channel_id = ?', [req.params.id, req.params.channelId]);
  res.json({ ok: true });
});

// --- XP shop API (1.6.2) -------------------------------------------------------
app.post('/api/guilds/:id/xpshop', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { roles } = await guildChannelsRoles(req.params.id).catch(() => ({ roles: [] }));
  const role = roles.find((r) => r.id === req.body?.roleId);
  if (!role) return res.status(400).json({ error: 'Role does not exist in this server.' });
  const price = parseInt(req.body?.xpPrice, 10);
  if (Number.isNaN(price) || price < 1 || price > 1000000) return res.status(400).json({ error: 'Price must be 1–1,000,000 XP.' });
  const { addShopItem } = require('./utils/xpShop');
  await addShopItem(req.params.id, role.id, price, req.session.user.id);
  res.json({ ok: true });
});

app.delete('/api/guilds/:id/xpshop/:roleId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { removeShopItem } = require('./utils/xpShop');
  await removeShopItem(req.params.id, req.params.roleId);
  res.json({ ok: true });
});

// --- Confessions review API (1.6.4) --------------------------------------------
app.post('/api/guilds/:id/confessions/:confessionId/review', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { decision } = req.body || {};
  if (!['approved', 'denied'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or denied.' });
  const rows = await db.query('SELECT * FROM confessions WHERE id = ? AND guild_id = ? AND status = \'pending\'', [req.params.confessionId, req.params.id]);
  const confession = rows?.[0];
  if (!confession) return res.status(404).json({ error: 'Pending confession not found.' });
  await db.query('UPDATE confessions SET status = ?, reviewed_by = ? WHERE id = ?', [decision, req.session.user.id, confession.id]);
  if (decision === 'approved') {
    // Post via REST (dashboard has no live client).
    const { getGuildSettings } = require('./utils/guildSettings');
    const settings = await getGuildSettings(req.params.id);
    if (settings.confessionsChannelId) {
      const embed = { title: `🤫 Anonymous Confession #${confession.id}`, description: confession.content, color: 0x9b59b6, footer: { text: 'Posted anonymously' }, timestamp: new Date(confession.created_at).toISOString() };
      await discordApi.post(`/channels/${settings.confessionsChannelId}/messages`, { embeds: [embed] }, { headers: botHeaders() }).catch(() => {});
    }
  }
  res.json({ ok: true, decision });
});

// --- Media auto-threads API (1.5.1) --------------------------------------------
app.post('/api/guilds/:id/media', requireAuth, requireGuildAccess, async (req, res) => {
  const { channels } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [] }));
  const channelId = req.body?.channelId;
  if (!channels.some((c) => c.id === channelId && c.type === 0)) return res.status(400).json({ error: 'Channel does not exist in this server.' });
  const settings = await getGuildSettings(req.params.id);
  const list = settings.mediaChannels || [];
  if (!list.includes(channelId)) await setGuildSettings(req.params.id, { mediaChannels: [...list, channelId] });
  res.json({ ok: true });
});

app.delete('/api/guilds/:id/media/:channelId', requireAuth, requireGuildAccess, async (req, res) => {
  const settings = await getGuildSettings(req.params.id);
  await setGuildSettings(req.params.id, { mediaChannels: (settings.mediaChannels || []).filter((id) => id !== req.params.channelId) });
  res.json({ ok: true });
});

// --- Temp role early removal API (1.5.2) -----------------------------------------
app.post('/api/guilds/:id/temproles/:tempId/remove', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM temp_roles WHERE id = ? AND guild_id = ? AND removed = 0', [req.params.tempId, req.params.id]);
  if (!rows?.length) return res.status(404).json({ error: 'Active temp role not found.' });
  const row = rows[0];
  // Remove the role via REST, then mark removed.
  await discordApi.delete(`/guilds/${req.params.id}/members/${row.user_id}/roles/${row.role_id}`, { headers: botHeaders() }).catch(() => {});
  await db.query('UPDATE temp_roles SET removed = 1 WHERE id = ?', [row.id]);
  res.json({ ok: true });
});

// --- Server backups API (1.5.4, staff) -------------------------------------------
// List is rendered on /staff/backups (serverBackups in data). Create snapshots
// via REST; restore via REST with role/channel mapping by name.
app.post('/api/staff/serverbackups', requireStaffWrite, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { guildId, name } = req.body || {};
  if (!guildId) return res.status(400).json({ error: 'guildId required.' });
  const { snapshotData } = require('./utils/serverBackup');
  try {
    const [guildRes, rolesRes, channelsRes] = await Promise.all([
      discordApi.get(`/guilds/${guildId}`, { headers: botHeaders() }),
      discordApi.get(`/guilds/${guildId}/roles`, { headers: botHeaders() }),
      discordApi.get(`/guilds/${guildId}/channels`, { headers: botHeaders() }),
    ]);
    const roles = (rolesRes.data || []).filter((r) => r.id !== guildId)
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((r) => ({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: String(r.permissions), position: r.position }));
    const channels = (channelsRes.data || [])
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((c) => ({
        name: c.name, type: c.type, topic: c.topic || null, position: c.position,
        parent: (channelsRes.data || []).find((p) => p.id === c.parent_id)?.name || null,
        permissionOverwrites: (c.permission_overwrites || []).map((o) => ({ id: o.id, type: o.type, allow: String(o.allow), deny: String(o.deny) })),
      }));
    const settings = await getGuildSettings(guildId);
    const result = await snapshotData(guildId, guildRes.data?.name || guildId, req.session.user, name || 'backup', roles, channels, settings);
    await staffUtils.audit(actorId(req), 'serverbackup.create', String(result.id || ''), `${result.roles} roles, ${result.channels} channels`);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ error: `Snapshot failed: ${err.message}` });
  }
});

app.post('/api/staff/serverbackups/:backupId/restore', requireStaffWrite, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM server_backups WHERE id = ?', [req.params.backupId]);
  const backup = rows?.[0];
  if (!backup) return res.status(404).json({ error: 'Backup not found.' });
  const { restoreBackupViaApi } = require('./utils/serverBackup');
  const replace = req.body?.replace === true || req.body?.replace === 'true';
  const api = {
    get: (url) => discordApi.get(url, { headers: botHeaders() }),
    post: (url, data) => discordApi.post(url, data, { headers: botHeaders() }),
    patch: (url, data) => discordApi.patch(url, data, { headers: botHeaders() }),
    del: (url) => discordApi.delete(url, { headers: botHeaders() }),
  };
  try {
    const summary = await restoreBackupViaApi(backup.guild_id, backup, { replace, api });
    await staffUtils.audit(actorId(req), 'serverbackup.restore', String(backup.id), `${summary.rolesCreated} roles created, ${summary.channelsCreated} channels created${replace ? ', replace mode' : ''}`);
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(502).json({ error: `Restore failed: ${err.message}` });
  }
});

app.delete('/api/staff/serverbackups/:backupId', requireStaffWrite, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM server_backups WHERE id = ?', [req.params.backupId]);
  if (!rows?.length) return res.status(404).json({ error: 'Backup not found.' });
  try { require('fs').unlinkSync(rows[0].file_path); } catch {}
  await db.query('DELETE FROM server_backups WHERE id = ?', [req.params.backupId]);
  res.json({ ok: true });
});

app.get('/staff/serverbackups/download/:backupId', requireStaff, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).send('Database unavailable.');
  const rows = await db.query('SELECT * FROM server_backups WHERE id = ?', [req.params.backupId]);
  const backup = rows?.[0];
  if (!backup || !require('fs').existsSync(backup.file_path)) return res.status(404).send('Backup not found.');
  res.download(backup.file_path, require('path').basename(backup.file_path));
});

// --- XP boost API (1.3.3) -----------------------------------------------------
app.post('/api/guilds/:id/xpboost', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { startBoost, stopBoost, getActiveBoost } = require('./utils/leveling');
  const body = req.body || {};
  if (body.action === 'stop') {
    const stopped = await stopBoost(req.params.id);
    return res.json({ ok: true, stopped });
  }
  const multiplier = parseFloat(body.multiplier);
  const durationMs = parseInt(body.durationMs, 10);
  if (![2, 3].includes(multiplier) || !durationMs || durationMs < 60_000 || durationMs > 7 * 86_400_000) {
    return res.status(400).json({ error: 'Multiplier must be 2 or 3, duration between 1 minute and 7 days.' });
  }
  const boost = await startBoost(req.params.id, multiplier, durationMs, req.session.user.id);
  return res.json({ ok: true, boost });
});

app.get('/api/guilds/:id/streamers', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  res.json(await db.query('SELECT * FROM streamers WHERE guild_id = ?', [req.params.id]) || []);
});

app.post('/api/guilds/:id/streamers', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { platform, channel, notifyChannelId, pingRoleId, liveChannelId } = req.body || {};
  if (!['youtube', 'twitch', 'kick', 'facebook', 'tiktok'].includes(platform) || !channel) {
    return res.status(400).json({ error: 'Valid platform + channel name required.' });
  }
  const { channels, roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  const channelIds = new Set(channels.map((c) => c.id));
  const roleIds = new Set(roles.map((r) => r.id));
  if (notifyChannelId && !channelIds.has(notifyChannelId)) return res.status(400).json({ error: 'Notify channel does not exist in this server.' });
  if (pingRoleId && !roleIds.has(pingRoleId)) return res.status(400).json({ error: 'Ping role does not exist in this server.' });
  if (liveChannelId && !channelIds.has(liveChannelId)) return res.status(400).json({ error: 'Live channel does not exist in this server.' });
  if (liveChannelId) {
    const clash = await db.query('SELECT channel_id_or_name FROM streamers WHERE guild_id = ? AND live_channel_id = ? AND NOT (platform = ? AND channel_id_or_name = ?)',
      [req.params.id, liveChannelId, platform, channel]);
    if (clash?.length) return res.status(400).json({ error: `That live channel is already used by ${clash[0].channel_id_or_name}. One streamer per live channel.` });
  }
  await db.query(
    'INSERT INTO streamers (guild_id, platform, channel_id_or_name, notify_channel_id, ping_role_id, live_channel_id) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE notify_channel_id = VALUES(notify_channel_id), ping_role_id = VALUES(ping_role_id), live_channel_id = VALUES(live_channel_id)',
    [req.params.id, platform, channel, notifyChannelId || null, pingRoleId || null, liveChannelId || null],
  );
  res.json({ ok: true });
});

// Edit an existing streamer: notify channel / ping role / live channel.
app.patch('/api/guilds/:id/streamers/:streamerId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { notifyChannelId, pingRoleId, liveChannelId } = req.body || {};
  const rows = await db.query('SELECT * FROM streamers WHERE id = ? AND guild_id = ?', [req.params.streamerId, req.params.id]);
  if (!rows?.length) return res.status(404).json({ error: 'Streamer not found.' });
  const { channels, roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  const channelIds = new Set(channels.map((c) => c.id));
  const roleIds = new Set(roles.map((r) => r.id));
  if (notifyChannelId !== undefined && notifyChannelId !== '' && !channelIds.has(notifyChannelId)) return res.status(400).json({ error: 'Notify channel does not exist in this server.' });
  if (pingRoleId !== undefined && pingRoleId !== '' && !roleIds.has(pingRoleId)) return res.status(400).json({ error: 'Ping role does not exist in this server.' });
  if (liveChannelId !== undefined && liveChannelId !== '' && !channelIds.has(liveChannelId)) return res.status(400).json({ error: 'Live channel does not exist in this server.' });
  if (liveChannelId) {
    const clash = await db.query('SELECT channel_id_or_name FROM streamers WHERE guild_id = ? AND live_channel_id = ? AND id != ?',
      [req.params.id, liveChannelId, req.params.streamerId]);
    if (clash?.length) return res.status(400).json({ error: `That live channel is already used by ${clash[0].channel_id_or_name}. One streamer per live channel.` });
  }
  await db.query('UPDATE streamers SET notify_channel_id = ?, ping_role_id = ?, live_channel_id = ? WHERE id = ? AND guild_id = ?',
    [notifyChannelId || null, pingRoleId || null, liveChannelId || null, req.params.streamerId, req.params.id]);
  res.json({ ok: true });
});

// Re-check one streamer now (live-status refresh button).
app.post('/api/guilds/:id/streamers/:streamerId/refresh', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM streamers WHERE id = ? AND guild_id = ?', [req.params.streamerId, req.params.id]);
  if (!rows?.length) return res.status(404).json({ error: 'Streamer not found.' });
  const row = rows[0];
  const { CHECKERS } = require('./utils/streamNotifier');
  const checker = CHECKERS[row.platform];
  if (!checker) return res.json({ live: Boolean(row.is_live), manual: true, note: 'Facebook/TikTok have no live API — use /stream-announce.' });
  let status;
  try { status = await checker(row.channel_id_or_name); } catch (e) { return res.status(502).json({ error: `Check failed: ${e.message}` }); }
  if (!status) return res.status(503).json({ error: 'That platform is not configured (missing API key) — see README.' });
  const wasLive = Boolean(row.is_live);
  await db.query('UPDATE streamers SET is_live = ?, last_live_id = ? WHERE id = ?',
    [status.live ? 1 : 0, status.live ? status.id : row.last_live_id, row.id]);
  // Rename the live channel on a transition (same logic as the bot checker).
  if (status.live !== wasLive && row.live_channel_id) {
    try {
      const { getTemplate, renderTemplate } = require('./utils/liveChannelTemplate');
      let name;
      if (status.live) {
        if (!row.live_channel_original_name) {
          const ch = await discordApi.get(`/channels/${row.live_channel_id}`, { headers: botHeaders() });
          await db.query('UPDATE streamers SET live_channel_original_name = ? WHERE id = ?', [ch.data.name, row.id]);
          row.live_channel_original_name = ch.data.name;
        }
        name = renderTemplate(await getTemplate(row.guild_id), { name: row.channel_id_or_name, game: status.game, title: status.title });
      } else {
        name = row.live_channel_original_name;
      }
      if (name) await discordApi.patch(`/channels/${row.live_channel_id}`, { name }, { headers: botHeaders() });
    } catch (e) { console.warn('[dashboard] live channel rename failed:', e.message); }
  }
  res.json({ live: status.live, title: status.title || null, game: status.game || null, viewers: status.viewers ?? null, url: status.url || null });
});

// Preview a streamer's live announcement (1.15.24): returns the exact
// message content + embed JSON the notifier would send, built by the same
// liveEmbed/addClipField code path, with clearly-marked SAMPLE data.
// Preview only — it never posts to Discord or touches the notify channel.
app.get('/api/guilds/:id/streamers/:streamerId/preview', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM streamers WHERE id = ? AND guild_id = ?', [req.params.streamerId, req.params.id]);
  if (!rows?.length) return res.status(404).json({ error: 'Streamer not found.' });
  const row = rows[0];
  const { liveEmbed, addClipField } = require('./utils/streamNotifier');
  const channelUrl = row.platform === 'twitch' ? `https://twitch.tv/${row.channel_id_or_name}`
    : row.platform === 'kick' ? `https://kick.com/${row.channel_id_or_name}`
    : row.platform === 'youtube' ? `https://www.youtube.com/channel/${row.channel_id_or_name}` : null;
  // Sample thumbnail served by this dashboard (trust proxy is on, so the
  // protocol is right behind nginx/Cloudflare). A data: URI is not an
  // option — discord.js only accepts http(s)/attachment image URLs.
  const sampleThumbnail = `${req.protocol}://${req.get('host')}/img/stream-preview-thumbnail.svg`;
  const sample = {
    title: 'Test stream — preview only',
    game: 'Just Chatting',
    viewers: 123,
    url: channelUrl,
    thumbnail: sampleThumbnail,
  };
  const embed = liveEmbed(row.platform, row.channel_id_or_name, sample);
  // Same clip field the live notifier attaches: only Twitch (latest clip)
  // and YouTube (latest video) ever get one — Kick/Facebook/TikTok never do.
  if (row.include_clip !== 0 && (row.platform === 'twitch' || row.platform === 'youtube')) {
    addClipField(embed, { title: 'Sample clip — preview only', url: channelUrl || 'https://example.invalid/', type: row.platform === 'youtube' ? 'latest video' : 'clip' });
  }
  // Ping role rendered as its name, on the notifier's content line.
  let pingName = null;
  if (row.ping_role_id) {
    const { roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
    pingName = roles.find((r) => r.id === row.ping_role_id)?.name || row.ping_role_id;
  }
  const content = `${pingName ? `@${pingName} ` : ''}🔴 **${row.channel_id_or_name}** just went live!`;
  res.json({ ok: true, content, embed: embed.toJSON(), platform: row.platform, streamer: row.channel_id_or_name });
});

app.delete('/api/guilds/:id/streamers/:streamerId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const result = await db.query('DELETE FROM streamers WHERE id = ? AND guild_id = ?', [req.params.streamerId, req.params.id]);
  if (!result) return res.status(503).json({ error: 'Database unavailable.' });
  if (!result.affectedRows) return res.status(404).json({ error: 'Streamer not found.' });
  res.json({ ok: true });
});

// --- Ticket panels (1.11.5) ---------------------------------------------------
// Create a panel (posts the panel message to Discord) or delete one.
app.post('/api/guilds/:id/ticket-panels', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { title, description, channelId, categoryId, staffRoleId } = req.body || {};
  if (!title || typeof title !== 'string' || title.length > 256) return res.status(400).json({ error: 'A panel title (max 256 chars) is required.' });
  const { channels, roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  const channelIds = new Set(channels.map((c) => c.id));
  const roleIds = new Set(roles.map((r) => r.id));
  if (!channelId || !channelIds.has(channelId)) return res.status(400).json({ error: 'Pick a text channel for the panel.' });
  if (categoryId && !channels.some((c) => c.id === categoryId && c.type === 4)) return res.status(400).json({ error: 'Category does not exist in this server.' });
  if (staffRoleId && !roleIds.has(staffRoleId)) return res.status(400).json({ error: 'Staff role does not exist in this server.' });
  const { createPanel, ticketPanelEmbed, ticketPanelRow, resolveTicketButtonLabel } = require('./utils/tickets');
  const panel = await createPanel(req.params.id, { channelId, categoryId: categoryId || null, staffRoleId: staffRoleId || null, title, description: description || null, createdBy: req.session.user.id });
  if (!panel) return res.status(503).json({ error: 'Could not create the panel.' });
  try {
    const buttonLabel = resolveTicketButtonLabel(await getGuildSettings(req.params.id));
    const msg = await discordApi.post(`/channels/${channelId}/messages`, {
      embeds: [ticketPanelEmbed(title, description, buttonLabel).toJSON()],
      components: [ticketPanelRow(panel.id, buttonLabel).toJSON()],
    }, { headers: botHeaders() });
    await db.query('UPDATE ticket_panels SET message_id = ? WHERE id = ?', [msg.data.id, panel.id]).catch(() => {});
  } catch (e) { console.warn('[dashboard] ticket panel post failed:', e.message); }
  res.json({ ok: true, id: panel.id });
});

// Repost a panel (1.15.28): deletes the old panel message and posts a fresh
// one in the same channel, built with the current settings (button label,
// description). This is how already-posted panels pick up a renamed button
// label from 1.15.27 — there was no refresh path before.
app.post('/api/guilds/:id/ticket-panels/:panelId/repost', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { getPanel, ticketPanelEmbed, ticketPanelRow, resolveTicketButtonLabel } = require('./utils/tickets');
  const panel = await getPanel(req.params.id, req.params.panelId);
  if (!panel) return res.status(404).json({ error: 'Panel not found.' });
  const label = resolveTicketButtonLabel(await getGuildSettings(req.params.id));
  // Delete the old panel message (best effort — it may already be gone).
  if (panel.message_id) {
    await discordApi.delete(`/channels/${panel.channel_id}/messages/${panel.message_id}`, { headers: botHeaders() }).catch(() => {});
  }
  try {
    const msg = await discordApi.post(`/channels/${panel.channel_id}/messages`, {
      embeds: [ticketPanelEmbed(panel.title, panel.description, label).toJSON()],
      components: [ticketPanelRow(panel.id, label).toJSON()],
    }, { headers: botHeaders() });
    await db.query('UPDATE ticket_panels SET message_id = ? WHERE id = ?', [msg.data.id, panel.id]).catch(() => {});
    await staffUtils.audit(req.session.user.id, 'ticket.repost', String(panel.id), `panel #${panel.id} "${panel.title}" reposted in #${panel.channel_id}, msg=${msg.data.id}`).catch(() => {});
    res.json({ ok: true, id: panel.id, messageId: msg.data.id });
  } catch (e) {
    console.warn('[dashboard] ticket panel repost failed:', e.message);
    return res.status(502).json({ error: 'Could not post the new panel message — check the bot can see and send in that channel.' });
  }
});

app.delete('/api/guilds/:id/ticket-panels/:panelId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { deletePanel } = require('./utils/tickets');
  const panel = await deletePanel(req.params.id, req.params.panelId);
  if (!panel) return res.status(404).json({ error: 'Panel not found.' });
  res.json({ ok: true });
});

// --- Invite role rules (1.11.6) ------------------------------------------------
app.post('/api/guilds/:id/invite-roles', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { code, roleId } = req.body || {};
  const clean = String(code || '').trim().replace(/^https?:\/\/(www\.)?discord\.gg\//i, '').replace(/^discord\.gg\//i, '').split(/[/?#]/)[0];
  if (!clean) return res.status(400).json({ error: 'An invite code is required.' });
  const { roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  if (!roles.some((r) => r.id === roleId)) return res.status(400).json({ error: 'Role does not exist in this server.' });
  const invites = await discordApi.get(`/guilds/${req.params.id}/invites`, { headers: botHeaders() }).catch(() => null);
  if (!invites?.data?.some((i) => i.code === clean)) return res.status(400).json({ error: `discord.gg/${clean} is not an active invite in this server.` });
  const { addRule } = require('./utils/inviteRoles');
  await addRule(req.params.id, clean, roleId, req.session.user.id);
  res.json({ ok: true });
});

app.delete('/api/guilds/:id/invite-roles/:code', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { removeRule } = require('./utils/inviteRoles');
  const removed = await removeRule(req.params.id, req.params.code);
  if (!removed) return res.status(404).json({ error: 'Rule not found.' });
  res.json({ ok: true });
});

// --- Countdowns (1.11.3) --------------------------------------------------------
app.post('/api/guilds/:id/countdowns', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { title, when, channelId } = req.body || {};
  if (!title || typeof title !== 'string' || title.length > 256) return res.status(400).json({ error: 'A title (max 256 chars) is required.' });
  const { parseWhen, countdownEmbed, createCountdown } = require('./utils/countdowns');
  const endsAt = parseWhen(when);
  if (!endsAt || endsAt.getTime() <= Date.now()) return res.status(400).json({ error: 'Use a future time like "in 2h30m", "in 3d", or "2026-12-25 18:00".' });
  const { channels } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  if (!channels.some((c) => c.id === channelId && c.type === 0)) return res.status(400).json({ error: 'Pick a text channel for the countdown.' });
  const row = await createCountdown(req.params.id, channelId, title, endsAt, req.session.user.id);
  if (!row) return res.status(503).json({ error: 'Could not create the countdown.' });
  try {
    const msg = await discordApi.post(`/channels/${channelId}/messages`, { embeds: [countdownEmbed(row, endsAt.getTime() - Date.now()).toJSON()] }, { headers: botHeaders() });
    await db.query('UPDATE countdowns SET message_id = ? WHERE id = ?', [msg.data.id, row.id]).catch(() => {});
  } catch (e) { console.warn('[dashboard] countdown post failed:', e.message); }
  res.json({ ok: true, id: row.id });
});

app.delete('/api/guilds/:id/countdowns/:countdownId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { cancelCountdown } = require('./utils/countdowns');
  const row = await cancelCountdown(req.params.id, req.params.countdownId);
  if (!row) return res.status(404).json({ error: 'Countdown not found.' });
  res.json({ ok: true });
});

// --- Emojis (1.11.2) -------------------------------------------------------------
app.post('/api/guilds/:id/emojis', requireAuth, requireGuildAccess, async (req, res) => {
  const { name, imageUrl } = req.body || {};
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(name || '')) return res.status(400).json({ error: 'Emoji names must be 2–32 letters, numbers, or underscores.' });
  if (!imageUrl || typeof imageUrl !== 'string') return res.status(400).json({ error: 'An image URL is required.' });
  try {
    const img = await discordApi.get(imageUrl, { responseType: 'arraybuffer', timeout: 15_000 }).catch(() => null);
    if (!img?.data) return res.status(400).json({ error: 'Could not fetch that image URL.' });
    const buf = Buffer.from(img.data);
    if (buf.length > 256 * 1024) return res.status(400).json({ error: `Image is ${Math.round(buf.length / 1024)}KB — Discord emoji must be under 256KB.` });
    const contentType = img.headers['content-type'] || '';
    if (!/^image\/(png|jpe?g|gif|webp)/.test(contentType)) return res.status(400).json({ error: 'That URL is not an image.' });
    const dataUri = `data:${contentType};base64,${buf.toString('base64')}`;
    const created = await discordApi.post(`/guilds/${req.params.id}/emojis`, { name, image: dataUri }, { headers: botHeaders() });
    if (db.isEnabled()) await db.query('INSERT INTO emoji_logs (guild_id, user_id, action, emoji_name) VALUES (?, ?, ?, ?)', [req.params.id, req.session.user.id, 'add', name]).catch(() => {});
    res.json({ ok: true, id: created.data.id });
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    res.status(400).json({ error: `Upload failed: ${msg}` });
  }
});

app.delete('/api/guilds/:id/emojis/:emojiId', requireAuth, requireGuildAccess, async (req, res) => {
  try {
    const existing = await discordApi.get(`/guilds/${req.params.id}/emojis`, { headers: botHeaders() }).catch(() => null);
    const emoji = existing?.data?.find((e) => e.id === req.params.emojiId);
    if (!emoji) return res.status(404).json({ error: 'Emoji not found.' });
    await discordApi.delete(`/guilds/${req.params.id}/emojis/${req.params.emojiId}`, { headers: botHeaders() });
    if (db.isEnabled()) await db.query('INSERT INTO emoji_logs (guild_id, user_id, action, emoji_name) VALUES (?, ?, ?, ?)', [req.params.id, req.session.user.id, 'remove', emoji.name]).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: `Delete failed: ${e.response?.data?.message || e.message}` });
  }
});

app.get('/api/guilds/:id/commands', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const globalOff = new Set(((await db.query("SELECT command_name FROM command_toggles WHERE guild_id = '' AND enabled = 0")) || []).map((r) => r.command_name));
  const guildRows = (await db.query('SELECT command_name, enabled FROM command_toggles WHERE guild_id = ?', [req.params.id])) || [];
  const guildMap = Object.fromEntries(guildRows.map((r) => [r.command_name, r.enabled === 1]));
  res.json(COMMAND_CATALOG.map((c) => ({ ...c, enabled: globalOff.has(c.name) ? false : (c.name in guildMap ? guildMap[c.name] : true), globallyDisabled: globalOff.has(c.name) })));
});

app.post('/api/guilds/:id/commands', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { commandName, enabled } = req.body || {};
  if (!COMMAND_CATALOG.some((c) => c.name === commandName)) return res.status(400).json({ error: 'Unknown command.' });
  await setToggle('command_toggles', commandName, req.params.id, Boolean(enabled), req.session.user.id);
  res.json({ ok: true });
});

// --- Applications API (same auth + per-guild checks) ---
app.get('/api/guilds/:id/applications/forms', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM application_forms WHERE guild_id = ? ORDER BY id', [req.params.id]) || [];
  res.json(rows.map((f) => { try { f.questions = JSON.parse(f.questions); } catch { f.questions = []; } return f; }));
});

app.post('/api/guilds/:id/applications/forms', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { name, description, questions, roleToGrant, reviewChannelId } = req.body || {};
  if (!name || !reviewChannelId) return res.status(400).json({ error: 'Name and review channel are required.' });
  const qs = Array.isArray(questions) ? questions.map((q) => String(q).trim()).filter(Boolean).slice(0, 5) : [];
  if (!qs.length) return res.status(400).json({ error: 'Add at least one question (max 5).' });
  const { channels, roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  if (!channels.some((c) => c.id === reviewChannelId)) return res.status(400).json({ error: 'Review channel does not exist in this server.' });
  if (roleToGrant && !roles.some((r) => r.id === roleToGrant)) return res.status(400).json({ error: 'Role does not exist in this server.' });
  const result = await db.query(
    'INSERT INTO application_forms (guild_id, name, description, questions, role_to_grant, review_channel_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.params.id, name.slice(0, 128), description || null, JSON.stringify(qs), roleToGrant || null, reviewChannelId, req.session.user.id],
  );
  res.json({ ok: true, id: result.insertId });
});

app.patch('/api/guilds/:id/applications/forms/:formId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { isOpen } = req.body || {};
  await db.query('UPDATE application_forms SET is_open = ? WHERE id = ? AND guild_id = ?', [isOpen ? 1 : 0, req.params.formId, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/guilds/:id/applications', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const status = ['pending', 'accepted', 'denied'].includes(req.query.status) ? req.query.status : 'pending';
  const rows = await db.query(
    `SELECT a.*, f.name AS form_name FROM applications a JOIN application_forms f ON f.id = a.form_id WHERE a.guild_id = ? AND a.status = ? ORDER BY a.id DESC LIMIT 50`,
    [req.params.id, status]) || [];
  res.json(rows.map((r) => { try { r.answers = JSON.parse(r.answers); } catch { r.answers = []; } return r; }));
});

// Review from the dashboard: update DB, grant the role + DM via Discord REST.
app.post('/api/guilds/:id/applications/:appId/review', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { decision, note } = req.body || {};
  if (!['accepted', 'denied'].includes(decision)) return res.status(400).json({ error: 'decision must be accepted or denied.' });
  const apps = await db.query('SELECT * FROM applications WHERE id = ? AND guild_id = ?', [req.params.appId, req.params.id]);
  const app = apps?.[0];
  if (!app) return res.status(404).json({ error: 'Application not found.' });
  if (app.status !== 'pending') return res.status(400).json({ error: `Already ${app.status}.` });
  const forms = await db.query('SELECT * FROM application_forms WHERE id = ?', [app.form_id]);
  const form = forms?.[0];
  await db.query("UPDATE applications SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = NOW() WHERE id = ?",
    [decision, req.session.user.id, note || null, app.id]);
  let roleGranted = false;
  if (decision === 'accepted' && form?.role_to_grant) {
    try { await discordApi.put(`/guilds/${req.params.id}/members/${app.user_id}/roles/${form.role_to_grant}`, {}, { headers: botHeaders() }); roleGranted = true; }
    catch (e) { console.warn('[dashboard] application role grant failed:', e.response?.data?.message || e.message); }
  }
  try {
    const dm = await discordApi.post('/users/@me/channels', { recipient_id: app.user_id }, { headers: botHeaders() });
    const msg = decision === 'accepted'
      ? `✅ Your application for **${form?.name || 'the server'}** was **accepted**!${roleGranted ? ' Your role has been granted.' : ''}${note ? `\nNote from staff: ${note}` : ''}`
      : `❌ Your application for **${form?.name || 'the server'}** was **denied**.${note ? `\nReason: ${note}` : ''}`;
    await discordApi.post(`/channels/${dm.data.id}/messages`, { content: msg }, { headers: botHeaders() });
  } catch { /* DMs closed — not fatal */ }
  res.json({ ok: true, roleGranted });
});

app.get('/api/guilds/:id/tickets', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  res.json(await db.query('SELECT * FROM tickets WHERE guild_id = ? ORDER BY id DESC LIMIT 50', [req.params.id]) || []);
});

// --- Automod API ---
const automodUtils = require('./utils/automod');
app.get('/api/guilds/:id/automod', requireAuth, requireGuildAccess, async (req, res) => {
  res.json(await automodUtils.getSettings(req.params.id));
});
app.post('/api/guilds/:id/automod', requireAuth, requireGuildAccess, async (req, res) => {
  const body = req.body || {};
  const { channels, roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  const channelIds = new Set(channels.map((c) => c.id));
  const roleIds = new Set(roles.map((r) => r.id));
  const patch = {};
  if ('enabled' in body) patch.enabled = Boolean(body.enabled);
  if ('spamMaxMessages' in body) { const n = parseInt(body.spamMaxMessages, 10); if (!Number.isNaN(n) && n >= 2 && n <= 50) patch.spamMaxMessages = n; }
  if ('spamWindowSeconds' in body) { const n = parseInt(body.spamWindowSeconds, 10); if (!Number.isNaN(n) && n >= 2 && n <= 120) patch.spamWindowSeconds = n; }
  if ('spamAction' in body && ['delete', 'warn', 'timeout', 'delete_warn', 'delete_timeout'].includes(body.spamAction)) patch.spamAction = body.spamAction;
  if ('spamTimeoutMinutes' in body) { const n = parseInt(body.spamTimeoutMinutes, 10); if (!Number.isNaN(n) && n >= 1 && n <= 40320) patch.spamTimeoutMinutes = n; }
  if ('blockLinks' in body) patch.blockLinks = Boolean(body.blockLinks);
  if ('blockInvites' in body) patch.blockInvites = Boolean(body.blockInvites);
  if ('logChannelId' in body && (body.logChannelId === '' || channelIds.has(body.logChannelId))) patch.logChannelId = body.logChannelId || '';
  if ('bannedWords' in body && Array.isArray(body.bannedWords)) {
    patch.bannedWords = body.bannedWords.map((w) => String(w).trim().toLowerCase()).filter(Boolean).slice(0, 200);
  }
  if ('exemptRoles' in body && Array.isArray(body.exemptRoles)) patch.exemptRoles = body.exemptRoles.filter((r) => roleIds.has(r));
  if ('exemptChannels' in body && Array.isArray(body.exemptChannels)) patch.exemptChannels = body.exemptChannels.filter((c) => channelIds.has(c));
  const { saved, settings } = await automodUtils.setSettings(req.params.id, patch);
  if (!saved) return res.status(503).json({ error: 'Settings saved in memory only — MySQL is not connected.' });
  res.json({ ok: true, settings });
});

// --- Suggestions API ---
const suggUtils = require('./utils/suggestions');
app.get('/api/guilds/:id/suggestions', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const status = ['pending', 'approved', 'denied', 'implemented'].includes(req.query.status) ? req.query.status : null;
  const rows = await db.query(
    `SELECT * FROM suggestions WHERE guild_id = ? ${status ? 'AND status = ?' : ''} ORDER BY id DESC LIMIT 50`,
    status ? [req.params.id, status] : [req.params.id]) || [];
  res.json(rows);
});
app.post('/api/guilds/:id/suggestions/:suggId/review', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { decision } = req.body || {};
  if (!['approved', 'denied', 'implemented'].includes(decision)) return res.status(400).json({ error: 'decision must be approved, denied or implemented.' });
  const suggestion = await suggUtils.getSuggestion(parseInt(req.params.suggId, 10), req.params.id);
  if (!suggestion) return res.status(404).json({ error: 'Suggestion not found.' });
  // Review from the dashboard: update the DB, edit the suggestion embed
  // and DM the suggester via the Discord REST API (the dashboard has no
  // live discord.js client — the bot process does).
  const guildRes = await discordApi.get(`/guilds/${req.params.id}`, { headers: botHeaders() }).catch(() => null);
  if (!guildRes) return res.status(503).json({ error: 'Bot cannot reach this server right now.' });
  if (suggestion.status !== 'pending') return res.status(400).json({ error: `Already ${suggestion.status}.` });
  await db.query("UPDATE suggestions SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
    [decision, req.session.user.id, suggestion.id]);
  const updated = { ...suggestion, status: decision };
  // Edit the embed via REST (best effort).
  if (suggestion.message_id) {
    try {
      const { EmbedBuilder } = require('discord.js');
      const embed = suggUtils.suggestionEmbed(updated);
      await discordApi.patch(`/channels/${suggestion.suggestion_channel_id}/messages/${suggestion.message_id}`,
        { embeds: [embed.toJSON()], components: [] }, { headers: botHeaders() });
    } catch (e) { console.warn('[dashboard] suggestion embed update failed:', e.response?.data?.message || e.message); }
  }
  try {
    const dm = await discordApi.post('/users/@me/channels', { recipient_id: suggestion.user_id }, { headers: botHeaders() });
    await discordApi.post(`/channels/${dm.data.id}/messages`,
      { content: `Your suggestion **"${suggestion.title}"** (#${suggestion.id}) was **${decision}**.` }, { headers: botHeaders() });
  } catch { /* DMs closed — not fatal */ }
  res.json({ ok: true });
});


// --- Premium API (economy, starboard, custom commands, FAQ, scheduled) ---
const premiumUtils = require('./utils/premiumSettings');
const { sanitizeResponse } = require('./utils/customCommands');
const { getCommandNames } = require('./utils/commandNames');

app.get('/api/guilds/:id/premium', requireAuth, requireGuildAccess, async (req, res) => {
  res.json(await premiumUtils.getPremiumSettings(req.params.id));
});

app.post('/api/guilds/:id/premium', requireAuth, requireGuildAccess, async (req, res) => {
  const body = req.body || {};
  // No-JS fallback (see the settings endpoint above).
  const isFormPost = req.is('application/x-www-form-urlencoded');
  if (body.stickyRolesEnabled === 'on') body.stickyRolesEnabled = 'true';
  const { channels, roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  const channelIds = new Set(channels.map((c) => c.id));
  const roleIds = new Set(roles.map((r) => r.id));
  const patch = {};
  const setChannel = (key, value) => { if (value === '' || channelIds.has(value)) patch[key] = value || ''; };
  const setRole = (key, value) => { if (value === '' || roleIds.has(value)) patch[key] = value || ''; };
  const setInt = (key, value, min, max) => {
    const n = parseInt(value, 10);
    if (!Number.isNaN(n) && n >= min && n <= max) patch[key] = n;
  };
  if ('starboardChannelId' in body) setChannel('starboardChannelId', body.starboardChannelId);
  if ('starboardThreshold' in body) setInt('starboardThreshold', body.starboardThreshold, 1, 25);
  if ('starboardEmoji' in body && typeof body.starboardEmoji === 'string' && body.starboardEmoji.trim()) patch.starboardEmoji = body.starboardEmoji.trim().slice(0, 32);
  if ('modlogChannelId' in body) setChannel('modlogChannelId', body.modlogChannelId);
  if ('autoroleId' in body) setRole('autoroleId', body.autoroleId);
  if ('stickyRolesEnabled' in body) patch.stickyRolesEnabled = body.stickyRolesEnabled === true || body.stickyRolesEnabled === 'true';
  if ('economyStartingBalance' in body) setInt('economyStartingBalance', body.economyStartingBalance, 0, 100000);
  if ('economyDailyMin' in body) setInt('economyDailyMin', body.economyDailyMin, 0, 100000);
  if ('economyDailyMax' in body) setInt('economyDailyMax', body.economyDailyMax, 0, 100000);
  if ('economyWorkMin' in body) setInt('economyWorkMin', body.economyWorkMin, 0, 100000);
  if ('economyWorkMax' in body) setInt('economyWorkMax', body.economyWorkMax, 0, 100000);
  if ('economyCurrencyName' in body && typeof body.economyCurrencyName === 'string' && body.economyCurrencyName.trim()) patch.economyCurrencyName = body.economyCurrencyName.trim().slice(0, 32);
  if ('economyCurrencyEmoji' in body && typeof body.economyCurrencyEmoji === 'string' && body.economyCurrencyEmoji.trim()) patch.economyCurrencyEmoji = body.economyCurrencyEmoji.trim().slice(0, 32);
  const { saved, settings } = await premiumUtils.setPremiumSettings(req.params.id, patch);
  if (!saved) return res.status(503).json({ error: 'Settings saved in memory only — MySQL is not connected.' });
  if (isFormPost) {
    const back = (req.get('Referer') || `/guilds/${req.params.id}`).split('?')[0];
    return res.redirect(`${back}?saved=1`);
  }
  res.json({ ok: true, settings });
});

// Shop items (economy).
app.get('/api/guilds/:id/shop', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  res.json(await db.query('SELECT * FROM shop_items WHERE guild_id = ? ORDER BY price ASC', [req.params.id]) || []);
});

app.post('/api/guilds/:id/shop', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { name, description, price, roleId } = req.body || {};
  const n = parseInt(price, 10);
  if (!name || typeof name !== 'string' || !name.trim() || Number.isNaN(n) || n < 1) {
    return res.status(400).json({ error: 'Name and a price of at least 1 are required.' });
  }
  const { roles } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [], roles: [] }));
  if (roleId && !roles.some((r) => r.id === roleId)) return res.status(400).json({ error: 'Role does not exist in this server.' });
  const result = await db.query(
    'INSERT INTO shop_items (guild_id, name, description, price, role_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, name.trim().slice(0, 128), (description || '').slice(0, 512) || null, n, roleId || null, req.session.user.id],
  );
  res.json({ ok: true, id: result.insertId });
});

app.delete('/api/guilds/:id/shop/:itemId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('DELETE FROM shop_items WHERE id = ? AND guild_id = ?', [req.params.itemId, req.params.id]);
  res.json({ ok: true });
});

// Custom commands.
app.get('/api/guilds/:id/custom-commands', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  res.json(await db.query('SELECT trigger_word, response, use_count FROM custom_commands WHERE guild_id = ? ORDER BY trigger_word', [req.params.id]) || []);
});

app.post('/api/guilds/:id/custom-commands', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const trigger = String(req.body?.trigger || '').trim().toLowerCase();
  const response = sanitizeResponse(String(req.body?.response || ''));
  if (!/^[a-z0-9_-]+$/.test(trigger)) return res.status(400).json({ error: 'Trigger must be a single word (letters, numbers, - or _).' });
  if (getCommandNames().has(trigger)) return res.status(400).json({ error: `"${trigger}" is a built-in command — pick a different trigger.` });
  if (!response.trim()) return res.status(400).json({ error: 'Response is required.' });
  await db.query(
    'INSERT INTO custom_commands (guild_id, trigger_word, response, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE response = VALUES(response), created_by = VALUES(created_by)',
    [req.params.id, trigger, response.slice(0, 2000), req.session.user.id],
  );
  res.json({ ok: true });
});

app.delete('/api/guilds/:id/custom-commands/:trigger', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('DELETE FROM custom_commands WHERE guild_id = ? AND trigger_word = ?', [req.params.id, req.params.trigger.toLowerCase()]);
  res.json({ ok: true });
});

// FAQ responses.
app.get('/api/guilds/:id/faq', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  res.json(await db.query('SELECT id, trigger_phrase, response, match_type, use_count FROM faq_responses WHERE guild_id = ? ORDER BY created_at ASC', [req.params.id]) || []);
});

app.post('/api/guilds/:id/faq', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const trigger = String(req.body?.trigger || '').trim();
  const response = sanitizeResponse(String(req.body?.response || ''));
  const matchType = req.body?.matchType === 'exact' ? 'exact' : 'contains';
  if (!trigger || trigger.length > 100) return res.status(400).json({ error: 'Trigger is required (max 100 chars).' });
  if (!response.trim()) return res.status(400).json({ error: 'Response is required.' });
  const count = await db.query('SELECT COUNT(*) AS c FROM faq_responses WHERE guild_id = ?', [req.params.id]);
  if ((count?.[0]?.c || 0) >= 50) return res.status(400).json({ error: 'This server already has 50 FAQ responses — remove one first.' });
  await db.query(
    'INSERT INTO faq_responses (guild_id, trigger_phrase, response, match_type, created_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE response = VALUES(response), match_type = VALUES(match_type), created_by = VALUES(created_by)',
    [req.params.id, trigger, response.slice(0, 2000), matchType, req.session.user.id],
  );
  const { invalidateFaqs } = require('./utils/faq');
  invalidateFaqs(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/guilds/:id/faq/:faqId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('DELETE FROM faq_responses WHERE id = ? AND guild_id = ?', [req.params.faqId, req.params.id]);
  const { invalidateFaqs } = require('./utils/faq');
  invalidateFaqs(req.params.id);
  res.json({ ok: true });
});

// Scheduled messages (list + cancel).
app.get('/api/guilds/:id/scheduled', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  res.json(await db.query('SELECT * FROM scheduled_messages WHERE guild_id = ? AND sent = 0 ORDER BY send_at', [req.params.id]) || []);
});

app.delete('/api/guilds/:id/scheduled/:msgId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('DELETE FROM scheduled_messages WHERE id = ? AND guild_id = ? AND sent = 0', [req.params.msgId, req.params.id]);
  res.json({ ok: true });
});


// --- Presence (Staff area) ---
// The dashboard runs standalone, so it can't set the bot's presence
// directly: the current activity is read from the presence_state table
// (written by the bot on every rotation), "rotate now" sets a flag the bot
// checks each tick, and template edits are written to config.json — the
// bot re-reads config.json from disk on every rotation tick.
const ACTIVITY_TYPE_NAMES = ['Playing', 'Watching', 'Listening', 'Competing'];

function parsePresenceTemplates(raw) {
  if (typeof raw !== 'string') return null;
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20);
  if (!lines.length) return null;
  const activities = [];
  for (const line of lines) {
    const m = /^(Playing|Watching|Listening|Competing)\s*:\s*(.+)$/i.exec(line);
    if (m) activities.push({ text: m[2].trim().slice(0, 128), type: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() });
    else activities.push(line.slice(0, 128));
  }
  return activities;
}

app.post('/api/staff/presence/rotate', requireStaffWrite, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable — the bot checks the rotate flag in MySQL.' });
  await db.query('INSERT INTO presence_state (id, rotate_requested_at) VALUES (1, NOW()) ON DUPLICATE KEY UPDATE rotate_requested_at = NOW()');
  await staffUtils.audit(actorId(req), 'presence.rotate', '', 'rotate now requested');
  res.json({ ok: true });
});

app.post('/api/staff/presence/templates', requireStaffWrite, async (req, res) => {
  const activities = parsePresenceTemplates(req.body?.templates);
  if (!activities) return res.status(400).json({ error: 'Add at least one template (one per line).' });
  const configPath = path.join(__dirname, '..', 'config.json');
  let current;
  try { current = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { return res.status(500).json({ error: 'Could not read config.json.' }); }
  current.presence = { ...(current.presence || {}), rotateSeconds: current.presence?.rotateSeconds ?? 60, activities };
  try { fs.writeFileSync(configPath, JSON.stringify(current, null, 2) + '\n'); }
  catch (e) { return res.status(500).json({ error: `Could not write config.json: ${e.message}` }); }
  Object.assign(config, current); // update this process's in-memory config too
  await staffUtils.audit(actorId(req), 'presence.templates', '', `${activities.length} templates saved`);
  res.json({ ok: true, activities });
});


// --- Staff area (owner + approved staff only) --------------------------------
app.get('/staff', requireStaff, async (req, res) => {
  const data = { botConnected: false, shardInfo: 'Bot not connected — the dashboard runs standalone (npm run dashboard), separate from the bot process. Shard/live status comes from the bot itself; totals below come from the MySQL logs.' };
  // Bot health (1.16.5): ask the bot's localhost health endpoint whether it
  // is online. fetchBotHealth never throws and aborts after ~2s, so a dead
  // bot just leaves the page on the "not connected" wording above — the page
  // still renders fast and nothing else on it is affected.
  const health = await fetchBotHealth(healthPort(config));
  if (health) {
    const shards = health.shards || [];
    const ready = shards.filter((s) => s.ready).length;
    const uptime = formatUptime(health.uptimeSeconds);
    const version = health.version || '?';
    data.botConnected = true;
    data.botHealth = health;
    data.botHealthUptime = uptime;
    data.shardInfo = health.online
      ? `Bot online — v${version} · uptime ${uptime} · ${ready}/${shards.length} shard${shards.length === 1 ? '' : 's'} ready${typeof health.guilds === 'number' ? ` · ${health.guilds} guild${health.guilds === 1 ? '' : 's'}` : ''}.`
      : `Bot process is running but no shards are ready — v${version} · uptime ${uptime}.`;
  }
  if (db.isEnabled()) {
    const totalCommands = (await db.query('SELECT COUNT(*) AS c FROM command_logs'))?.[0]?.c ?? 0;
    const totalGuilds = (await db.query('SELECT COUNT(DISTINCT guild_id) AS c FROM guild_stats'))?.[0]?.c ?? 0;
    const songs = (await db.query('SELECT COALESCE(SUM(songs_played), 0) AS s FROM guild_stats'))?.[0]?.s ?? 0;
    const totalUsers = (await db.query('SELECT COUNT(*) AS c FROM user_stats'))?.[0]?.c ?? 0;
    const topCommands = await db.query('SELECT command_name, COUNT(*) AS c FROM command_logs GROUP BY command_name ORDER BY c DESC LIMIT 10') || [];
    const topGuilds = await db.query('SELECT guild_id, COUNT(*) AS c FROM command_logs GROUP BY guild_id ORDER BY c DESC LIMIT 10') || [];
    const recent = await db.query('SELECT guild_id, user_id, username, command_name, success, error_message, created_at FROM command_logs ORDER BY id DESC LIMIT 50') || [];
    const errors = recent.filter((r) => !r.success);
    const errors24h = (await db.query("SELECT COUNT(*) AS c FROM error_logs WHERE created_at >= NOW() - INTERVAL 24 HOUR"))?.[0]?.c ?? 0;
    const presenceRows = await db.query('SELECT current_text, current_type, updated_at FROM presence_state WHERE id = 1') || [];
    const presenceState = presenceRows[0] || null;
    Object.assign(data, { totalCommands, totalGuilds, songs, totalUsers, topCommands, topGuilds, recent, errors, errors24h, presenceState, presenceTemplates: (config.presence?.activities || []) });
  }
  res.render('staff', { user: req.session.user, section: 'overview', data, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.get('/staff/errors', requireStaff, async (req, res) => {
  const { level, command, shard } = req.query;
  let rows = [];
  if (db.isEnabled()) {
    const where = [];
    const params = [];
    if (level && ['error', 'warn', 'info'].includes(level)) { where.push('level = ?'); params.push(level); }
    if (command) { where.push('command_name = ?'); params.push(command); }
    if (shard !== undefined && shard !== '') { where.push('shard_id = ?'); params.push(parseInt(shard, 10)); }
    rows = await db.query(
      `SELECT id, level, shard_id, guild_id, command_name, user_id, message, created_at, resolved FROM error_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 100`,
      params) || [];
  }
  res.render('staff', { user: req.session.user, section: 'errors', data: { errors: rows, filters: { level: level || '', command: command || '', shard: shard || '' } }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.get('/staff/errors/:id', requireStaff, async (req, res) => {
  let row = null;
  if (db.isEnabled()) {
    const rows = await db.query('SELECT * FROM error_logs WHERE id = ?', [req.params.id]);
    row = rows?.[0] || null;
  }
  if (!row) return res.status(404).send('Error log not found.');
  // The context column comes back from MySQL as a parsed object, which
  // EJS would print as "[object Object]" — normalise it to a display
  // string first (pretty JSON for objects, raw text otherwise, null hides
  // the Context section).
  row.context = formatErrorContext(row.context);
  res.render('staff', { user: req.session.user, section: 'error-detail', data: { error: row }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.post('/api/staff/errors/purge', requireStaffWrite, async (req, res) => {
  const ids = req.body?.ids;
  if (ids !== undefined && (!Array.isArray(ids) || !ids.length || !ids.every((v) => Number.isInteger(Number(v)) && Number(v) > 0))) {
    return res.status(400).json({ error: 'ids must be a non-empty array of error log ids, or omitted to purge all.' });
  }
  try {
    const result = await errorLogger.purgeErrorLogs(ids);
    await staffUtils.audit(actorId(req), 'errors.purge', null,
      result.mode === 'all'
        ? `deleted=${result.deleted} fileCleared=${result.fileCleared} dbAvailable=${result.dbAvailable}`
        : `ids=${ids.join(',')} deleted=${result.deleted}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Purge failed.' });
  }
});

app.post('/api/staff/errors/:id/resolve', requireStaffWrite, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('UPDATE error_logs SET resolved = 1, resolved_by = ? WHERE id = ?', [actorId(req), req.params.id]);
  await staffUtils.audit(actorId(req), 'error.resolve', req.params.id, null);
  res.json({ ok: true });
});

app.get('/staff/commands', requireStaff, async (req, res) => {
  const rows = db.isEnabled() ? (await db.query("SELECT command_name, guild_id, enabled FROM command_toggles WHERE guild_id = ''") || []) : [];
  const map = Object.fromEntries(rows.map((r) => [r.command_name, r.enabled === 1]));
  res.render('staff', { user: req.session.user, section: 'commands', data: { catalog: COMMAND_CATALOG, toggles: map }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.get('/staff/features', requireStaff, async (req, res) => {
  const rows = db.isEnabled() ? (await db.query("SELECT feature, enabled FROM feature_toggles WHERE guild_id = ''") || []) : [];
  const map = Object.fromEntries(rows.map((r) => [r.feature, r.enabled === 1]));
  res.render('staff', { user: req.session.user, section: 'features', data: { features: FEATURES, toggles: map }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.get('/staff/manage', requireOwner, async (req, res) => {
  const list = await staffUtils.listStaff();
  const auditRows = db.isEnabled() ? (await db.query('SELECT * FROM staff_audit ORDER BY id DESC LIMIT 50') || []) : [];
  // Show names next to IDs: resolve each staff member and each adder once
  // per render (de-duplicated inside resolveUserLabels). Unresolvable IDs
  // fall back to the raw ID with an "unknown user" note — never crash.
  const labels = await resolveUserLabels(list.flatMap((s) => [s.user_id, s.added_by]));
  const staff = list.map((s) => ({
    ...s,
    user_label: labels.get(String(s.user_id)),
    // added_by is NULL for rows added outside the dashboard (manual SQL /
    // old data): the dashboard's only add path always records the adder.
    added_by_label: s.added_by ? labels.get(String(s.added_by)) : 'System / config',
  }));
  res.render('staff', { user: req.session.user, section: 'manage', data: { staff, audit: auditRows, ownerId: config.ownerId, bootstrap: config.staffUserIds || [] }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

// --- Local dashboard accounts (1.16.6) ------------------------------------
// Username + password accounts with Admin / Staff / Viewer roles, managed
// here by the Discord owner or a local admin. Discord login is untouched
// and still works alongside these. Bootstrap: the owner logs in with
// Discord once and creates the first local admin here.
app.get('/staff/accounts', requireAdmin, async (req, res) => {
  const accounts = await localAccounts.listAccounts();
  res.render('staff', { user: req.session.user, section: 'accounts', data: { accounts, selfId: getLocalAccount(req)?.id || null }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.post('/api/staff/accounts', requireAdmin, createAccountApi);
app.post('/api/staff/accounts/:id/role', requireAdmin, setAccountRoleApi);
app.post('/api/staff/accounts/:id/status', requireAdmin, setAccountStatusApi);
app.post('/api/staff/accounts/:id/reset-password', requireAdmin, resetAccountPasswordApi);
app.delete('/api/staff/accounts/:id', requireAdmin, deleteAccountApi);

app.get('/staff/backups', requireStaff, async (req, res) => {
  const logs = db.isEnabled() ? (await db.query('SELECT * FROM backup_logs ORDER BY id DESC LIMIT 30') || []) : [];
  let files = [];
  try {
    files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sql.gz')).map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, mtime: st.mtime };
    }).sort((a, b) => b.mtime - a.mtime);
  } catch {}
  const serverBackups = db.isEnabled() ? (await db.query('SELECT * FROM server_backups ORDER BY created_at DESC LIMIT 20') || []) : [];
  const guilds = await botGuilds();
  res.render('staff', { user: req.session.user, section: 'backups', data: { logs, files, serverBackups, guilds, retentionDays: retentionDays(), scheduleTime: (config.backups?.time || '03:00') }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.get('/staff/backups/download/:filename', requireStaff, async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename.endsWith('.sql.gz')) return res.status(400).send('Invalid backup file.');
  const full = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(full)) return res.status(404).send('Backup not found.');
  res.download(full, filename);
});

app.post('/api/staff/backup-now', requireStaffWrite, async (req, res) => {
  const result = await runBackup();
  if (!result.ok) return res.status(500).json({ error: result.error });
  await staffUtils.audit(actorId(req), 'backup.manual', result.filename, `${result.sizeBytes} bytes`);
  res.json({ ok: true, filename: result.filename, sizeBytes: result.sizeBytes });
});

// --- Ticket transcripts (staff) ------------------------------------------------
// Transcripts are HTML files in transcripts/ (written on ticket close);
// ticket_transcripts indexes them. The list page backfills the index from
// any files on disk that aren't indexed yet, so old transcripts show up too.
// Viewing/downloading is staff-only (requireStaff), like the rest of Staff.
const { backfillTranscripts } = require('./utils/transcripts');

app.get('/staff/transcripts', requireStaff, async (req, res) => {
  const guilds = await botGuilds();
  const guildId = req.query.guild || '';
  const q = (req.query.q || '').trim();
  let rows = [];
  if (db.isEnabled()) {
    await backfillTranscripts().catch(() => {});
    const where = [];
    const params = [];
    if (guildId) { where.push('guild_id = ?'); params.push(guildId); }
    if (q) {
      if (/^\d+$/.test(q)) { where.push('(ticket_id = ? OR user_id = ? OR closed_by = ?)'); params.push(q, q, q); }
      else { where.push('user_id LIKE ?'); params.push(`%${q}%`); }
    }
    rows = await db.query(
      `SELECT * FROM ticket_transcripts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY closed_at DESC LIMIT 100`,
      params) || [];
  }
  res.render('staff', { user: req.session.user, section: 'transcripts', data: { transcripts: rows, guilds, guildId, q }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.get('/staff/transcripts/:id', requireStaff, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).send('Database unavailable.');
  const rows = await db.query('SELECT * FROM ticket_transcripts WHERE id = ?', [req.params.id]);
  const row = rows?.[0];
  if (!row) return res.status(404).send('Transcript not found.');
  const fsLocal = require('fs');
  if (!fsLocal.existsSync(row.file_path)) return res.status(404).send('Transcript file is gone from disk.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(fsLocal.readFileSync(row.file_path, 'utf8'));
});

app.get('/staff/transcripts/:id/download', requireStaff, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).send('Database unavailable.');
  const rows = await db.query('SELECT * FROM ticket_transcripts WHERE id = ?', [req.params.id]);
  const row = rows?.[0];
  if (!row) return res.status(404).send('Transcript not found.');
  const full = require('path').basename(row.file_path);
  if (!require('fs').existsSync(row.file_path)) return res.status(404).send('Transcript file is gone from disk.');
  res.download(row.file_path, full);
});

// --- Bot tracking (staff) ------------------------------------------------------
// Settings are per-guild (guild_settings.bot_*); the page lists the guilds
// the bot is in and lets staff review flags for one guild at a time.
const botTracker = require('./utils/botTracker');

async function botGuilds() {
  try {
    const r = await discordApi.get('/users/@me/guilds', { headers: botHeaders() });
    return r.data || [];
  } catch { return []; }
}

app.get('/staff/bottracking', requireStaff, async (req, res) => {
  const guilds = await botGuilds();
  const guildId = req.query.guild || guilds[0]?.id || '';
  let flags = [];
  let stats = [];
  let botSettings = null;
  if (db.isEnabled() && guildId) {
    flags = await botTracker.getRecentFlags(guildId, 50) || [];
    stats = await botTracker.getJoinStats(guildId, 7) || [];
    botSettings = await getGuildSettings(guildId);
  }
  const raid = guildId ? botTracker.raidWatchStatus(guildId) : null;
  res.render('staff', { user: req.session.user, section: 'bottracking', data: { guilds, guildId, flags, stats, botSettings, raid, defaults: botTracker.botTrackingConfig() }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.get('/api/staff/botflags', requireStaff, async (req, res) => {
  const guildId = req.query.guild || '';
  const status = ['open', 'reviewed', 'cleared'].includes(req.query.status) ? req.query.status : null;
  if (!guildId) return res.json({ flags: [], stats: [] });
  const flags = await botTracker.getRecentFlags(guildId, 50, status) || [];
  const stats = await botTracker.getJoinStats(guildId, 7) || [];
  res.json({ flags, stats, raid: botTracker.raidWatchStatus(guildId) });
});

app.post('/api/staff/botflags/:id/clear', requireStaffWrite, async (req, res) => {
  if (!db.isEnabled()) return res.status(500).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM bot_flags WHERE id = ?', [req.params.id]) || [];
  const flag = rows[0];
  if (!flag) return res.status(404).json({ error: 'Flag not found.' });
  await db.query("UPDATE bot_flags SET status = 'reviewed', reviewed_by = ? WHERE id = ?", [actorId(req), flag.id]);
  await staffUtils.audit(actorId(req), 'botflag.clear', String(flag.user_id), `flag #${flag.id} score ${flag.score}`);
  res.json({ ok: true });
});

async function botFlagAction(req, res, action) {
  if (!db.isEnabled()) return res.status(500).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM bot_flags WHERE id = ?', [req.params.id]) || [];
  const flag = rows[0];
  if (!flag) return res.status(404).json({ error: 'Flag not found.' });
  try {
    if (action === 'kick') await discordApi.delete(`/guilds/${flag.guild_id}/members/${flag.user_id}`, { headers: botHeaders() });
    else await discordApi.put(`/guilds/${flag.guild_id}/bans/${flag.user_id}`, { delete_message_days: 0, reason: `Bot tracking: suspicion score ${flag.score}` }, { headers: botHeaders() });
  } catch (err) {
    return res.status(500).json({ error: `Discord ${action} failed: ${err.response?.data?.message || err.message}` });
  }
  await db.query("UPDATE bot_flags SET status = 'reviewed', action_taken = ?, reviewed_by = ? WHERE id = ?", [action, actorId(req), flag.id]);
  await staffUtils.audit(actorId(req), `botflag.${action}`, String(flag.user_id), `flag #${flag.id} score ${flag.score}`);
  res.json({ ok: true });
}
app.post('/api/staff/botflags/:id/kick', requireStaffWrite, (req, res) => botFlagAction(req, res, 'kick'));
app.post('/api/staff/botflags/:id/ban', requireStaffWrite, (req, res) => botFlagAction(req, res, 'ban'));

app.post('/api/staff/bottracking/settings', requireStaffWrite, async (req, res) => {
  const { guildId, threshold, autoAction, suspectRoleId } = req.body || {};
  if (!guildId) return res.status(400).json({ error: 'guildId is required.' });
  if (threshold != null && (threshold < 0 || threshold > 100)) return res.status(400).json({ error: 'Threshold must be 0–100.' });
  if (autoAction && !['flag', 'kick', 'ban'].includes(autoAction)) return res.status(400).json({ error: 'autoAction must be flag, kick, or ban.' });
  const saved = await setGuildSettings(guildId, {
    botThreshold: threshold == null || threshold === '' ? null : parseInt(threshold, 10),
    botAutoAction: autoAction || 'flag',
    botSuspectRoleId: suspectRoleId || '',
  });
  if (!saved.saved) return res.status(500).json({ error: 'Database unavailable — settings kept in memory only.' });
  await staffUtils.audit(actorId(req), 'bottracking.settings', guildId, `threshold=${threshold} action=${autoAction}`);
  res.json({ ok: true });
});

// Plain-POST fallback for the bot-tracking settings form (no-JS browsers):
// same save as the API above, then back to the page with ?saved=1.
app.post('/staff/bottracking/settings', requireStaffWrite, async (req, res) => {
  const { guildId, threshold, autoAction, suspectRoleId } = req.body || {};
  if (!guildId) return res.redirect('/staff/bottracking?saved=0');
  await setGuildSettings(guildId, {
    botThreshold: threshold == null || threshold === '' ? null : parseInt(threshold, 10),
    botAutoAction: ['flag', 'kick', 'ban'].includes(autoAction) ? autoAction : 'flag',
    botSuspectRoleId: suspectRoleId || '',
  });
  await staffUtils.audit(actorId(req), 'bottracking.settings', guildId, `threshold=${threshold} action=${autoAction} (form POST)`);
  res.redirect(`/staff/bottracking?guild=${encodeURIComponent(guildId)}&saved=1`);
});


// --- 1.9.x APIs: welcome-DM test, tempban cancel, rules, lottery ----------------
// Welcome DM test (1.9.3): DM the requesting admin a rendered preview.
app.post('/api/guilds/:id/welcome-dm-test', requireAuth, requireGuildAccess, async (req, res) => {
  const settings = await getGuildSettings(req.params.id);
  const template = settings.welcomeDmMessage || '';
  if (!template) return res.status(400).json({ error: 'Set a welcome DM message first.' });
  const admin = req.session.user;
  const guildName = req.guildMeta?.name || 'your server';
  const text = template.replaceAll('{user}', `<@${admin.id}>`).replaceAll('{username}', admin.username).replaceAll('{server}', guildName);
  try {
    const { infoEmbed } = require('./utils/embeds');
    const dm = await discordApi.post('/users/@me/channels', { recipient_id: admin.id }, { headers: botHeaders() });
    await discordApi.post(`/channels/${dm.data.id}/messages`, { embeds: [infoEmbed('Welcome DM preview', text).toJSON()] }, { headers: botHeaders() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Could not DM you (DMs may be closed): ${err.response?.data?.message || err.message}` });
  }
});

// Tempban cancel (1.9.1): unban via Discord REST, then mark the row cancelled.
app.post('/api/guilds/:id/tempbans/:userId/cancel', requireAuth, requireGuildAccess, async (req, res) => {
  const { cancelTempban } = require('./utils/tempban');
  await discordApi.delete(`/guilds/${req.params.id}/bans/${req.params.userId}`, { headers: botHeaders() }).catch(() => {});
  const cancelled = await cancelTempban(req.params.id, req.params.userId).catch(() => false);
  if (!cancelled) return res.status(404).json({ error: 'No active tempban for that user.' });
  res.json({ ok: true });
});

// Server rules (1.9.5): read + save/post (posts via Discord REST, edits in place).
app.get('/api/guilds/:id/rules', requireAuth, requireGuildAccess, async (req, res) => {
  const { getRules } = require('./utils/serverRules');
  res.json(await getRules(req.params.id).catch(() => null) || {});
});
app.post('/api/guilds/:id/rules', requireAuth, requireGuildAccess, async (req, res) => {
  const { title, content, channelId } = req.body || {};
  if (!title || !content || !channelId) return res.status(400).json({ error: 'Title, rules text, and channel are required.' });
  const { formatRulesEmbed, getRules, saveRules } = require('./utils/serverRules');
  const existing = await getRules(req.params.id).catch(() => null);
  const embed = formatRulesEmbed(title, content).toJSON();
  let messageId = existing?.message_id || null;
  try {
    if (messageId && existing.channel_id === channelId) {
      await discordApi.patch(`/channels/${channelId}/messages/${messageId}`, { embeds: [embed] }, { headers: botHeaders() });
    } else {
      const posted = await discordApi.post(`/channels/${channelId}/messages`, { embeds: [embed] }, { headers: botHeaders() });
      messageId = posted.data.id;
    }
  } catch (err) {
    return res.status(500).json({ error: `Could not post the rules: ${err.response?.data?.message || err.message}` });
  }
  const saved = await saveRules(req.params.id, { title, content, channelId, messageId }).catch(() => false);
  if (!saved) return res.status(503).json({ error: 'Rules posted, but the database is unavailable so they were not saved.' });
  res.json({ ok: true, messageId });
});

// Lottery status (1.9.4): jackpot, tickets sold, next draw, recent draws.
app.get('/api/guilds/:id/lottery', requireAuth, requireGuildAccess, async (req, res) => {
  const lottery = require('./utils/lottery');
  const weekStart = lottery.formatWeekStart(new Date());
  const sold = await db.query('SELECT COUNT(*) AS n FROM lottery_tickets WHERE guild_id = ? AND week_start = ?', [req.params.id, weekStart]) || [];
  const draws = await db.query('SELECT * FROM lottery_draws WHERE guild_id = ? ORDER BY drawn_at DESC LIMIT 10', [req.params.id]) || [];
  res.json({
    weekStart,
    ticketsSold: sold[0]?.n || 0,
    jackpot: await lottery.jackpotForWeek(req.params.id, weekStart).catch(() => 0),
    nextDraw: lottery.nextDrawDate(new Date()).toISOString(),
    draws,
  });
});

// --- Anti-nuke staff page (1.9.6) ------------------------------------------------
app.get('/staff/antinuke', requireStaff, async (req, res) => {
  const guilds = await botGuilds();
  const guildId = req.query.guild || guilds[0]?.id || '';
  let events = [];
  let antinukeSettings = null;
  if (db.isEnabled() && guildId) {
    events = await db.query('SELECT * FROM antinuke_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50', [guildId]) || [];
    antinukeSettings = await getGuildSettings(guildId);
  }
  res.render('staff', { user: req.session.user, section: 'antinuke', data: { guilds, guildId, events, antinukeSettings }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.post('/api/staff/antinuke/settings', requireStaffWrite, async (req, res) => {
  const { guildId, enabled, action, threshold, logChannelId, whitelistRoles } = req.body || {};
  if (!guildId) return res.status(400).json({ error: 'guildId is required.' });
  if (action && !['kick', 'ban', 'lockdown'].includes(action)) return res.status(400).json({ error: 'action must be kick, ban, or lockdown.' });
  if (threshold != null && (threshold < 1 || threshold > 20)) return res.status(400).json({ error: 'Threshold must be 1–20.' });
  const saved = await setGuildSettings(guildId, {
    antinukeEnabled: enabled === true || enabled === 'true',
    antinukeAction: action || 'kick',
    antinukeThreshold: threshold == null || threshold === '' ? 5 : parseInt(threshold, 10),
    antinukeLogChannelId: logChannelId || '',
    antinukeWhitelistRoles: Array.isArray(whitelistRoles) ? whitelistRoles : [],
  });
  if (!saved.saved) return res.status(500).json({ error: 'Database unavailable — settings kept in memory only.' });
  await staffUtils.audit(actorId(req), 'antinuke.settings', guildId, `enabled=${enabled} action=${action} threshold=${threshold}`);
  res.json({ ok: true });
});

// Plain-POST fallback for the anti-nuke settings form (no-JS browsers).
app.post('/staff/antinuke/settings', requireStaffWrite, async (req, res) => {
  const { guildId, enabled, action, threshold, logChannelId } = req.body || {};
  if (!guildId) return res.redirect('/staff/antinuke?saved=0');
  const whitelistRoles = Array.isArray(req.body.whitelistRoles) ? req.body.whitelistRoles : (req.body.whitelistRoles ? [req.body.whitelistRoles] : []);
  await setGuildSettings(guildId, {
    antinukeEnabled: enabled === 'true' || enabled === 'on',
    antinukeAction: ['kick', 'ban', 'lockdown'].includes(action) ? action : 'kick',
    antinukeThreshold: threshold ? parseInt(threshold, 10) : 5,
    antinukeLogChannelId: logChannelId || '',
    antinukeWhitelistRoles: whitelistRoles,
  });
  await staffUtils.audit(actorId(req), 'antinuke.settings', guildId, `enabled=${enabled} action=${action} (form POST)`);
  res.redirect(`/staff/antinuke?guild=${encodeURIComponent(guildId)}&saved=1`);
});

// --- Staff JSON endpoints for the client-side JS layer --------------------------
// (live refresh without full-page reloads; same data as the server-rendered pages)
app.get('/api/staff/overview', requireStaff, async (req, res) => {
  const data = { guilds: 0, errors24h: 0, presence: null, commandsUsed: 0, joinsToday: 0, flaggedToday: 0 };
  if (db.isEnabled()) {
    try {
      const g = await discordApi.get('/users/@me/guilds', { headers: botHeaders() });
      data.guilds = (g.data || []).length;
    } catch {}
    const e = await db.query("SELECT COUNT(*) AS n FROM error_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)") || [];
    data.errors24h = e[0]?.n || 0;
    const p = await db.query('SELECT current_text, current_type, updated_at FROM presence_state ORDER BY id DESC LIMIT 1') || [];
    data.presence = p[0] || null;
    const c = await db.query('SELECT SUM(commands_used) AS n FROM guild_stats') || [];
    data.commandsUsed = c[0]?.n || 0;
    const j = await db.query('SELECT SUM(total_joins) AS t, SUM(flagged_joins) AS f FROM bot_join_stats WHERE date = CURDATE()') || [];
    data.joinsToday = j[0]?.t || 0;
    data.flaggedToday = j[0]?.f || 0;
  }
  res.json(data);
});

app.get('/api/staff/errors', requireStaff, async (req, res) => {
  if (!db.isEnabled()) return res.json({ errors: [] });
  const { level, command } = req.query;
  const where = [];
  const params = [];
  if (level && ['error', 'warn', 'info'].includes(level)) { where.push('level = ?'); params.push(level); }
  if (command) { where.push('command_name = ?'); params.push(command); }
  const rows = await db.query(
    `SELECT id, level, shard_id, guild_id, command_name, user_id, message, created_at, resolved FROM error_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 100`,
    params) || [];
  res.json({ errors: rows });
});

app.get('/api/staff/backups', requireStaff, async (req, res) => {
  const logs = db.isEnabled() ? (await db.query('SELECT * FROM backup_logs ORDER BY id DESC LIMIT 30') || []) : [];
  let files = [];
  try {
    files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sql.gz')).map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, mtime: st.mtime };
    }).sort((a, b) => b.mtime - a.mtime);
  } catch {}
  res.json({ logs, files, retentionDays: retentionDays(), scheduleTime: (config.backups?.time || '03:00') });
});

app.get('/api/guilds/:id/invites', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.json({ leaderboard: [], stats: [] });
  const leaderboard = await db.query('SELECT user_id, total_invites, valid_invites, leaves, fake_invites FROM user_invites WHERE guild_id = ? ORDER BY valid_invites DESC, total_invites DESC LIMIT 10', [req.params.id]) || [];
  const stats = await db.query('SELECT user_id, total_invites, valid_invites, leaves, fake_invites, updated_at FROM user_invites WHERE guild_id = ? ORDER BY valid_invites DESC LIMIT 50', [req.params.id]) || [];
  res.json({ leaderboard, stats });
});

app.get('/staff/broadcast', requireOwner, async (req, res) => {
  let guilds = [];
  try {
    const r = await discordApi.get('/users/@me/guilds', { headers: botHeaders() });
    guilds = r.data;
  } catch { guilds = []; }
  res.render('staff', { user: req.session.user, section: 'broadcast', data: { guilds }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.post('/api/staff/commands', requireStaffWrite, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { commandName, enabled } = req.body || {};
  if (!COMMAND_CATALOG.some((c) => c.name === commandName)) return res.status(400).json({ error: 'Unknown command.' });
  await setToggle('command_toggles', commandName, '', Boolean(enabled), actorId(req));
  await staffUtils.audit(actorId(req), 'command.toggle', commandName, `global enabled=${Boolean(enabled)}`);
  res.json({ ok: true });
});

app.post('/api/staff/features', requireStaffWrite, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { feature, enabled } = req.body || {};
  if (!FEATURES.includes(feature)) return res.status(400).json({ error: 'Unknown feature.' });
  await setToggle('feature_toggles', feature, '', Boolean(enabled), actorId(req));
  await staffUtils.audit(actorId(req), 'feature.toggle', feature, `global enabled=${Boolean(enabled)}`);
  res.json({ ok: true });
});

app.post('/api/staff/users', requireOwner, async (req, res) => {
  const { userId, role } = req.body || {};
  if (!/^\d{17,20}$/.test(userId || '')) return res.status(400).json({ error: 'Enter a valid Discord user ID (17–20 digits).' });
  if (!['admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Role must be admin or staff.' });
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await staffUtils.addStaff(req.session.user.id, userId, role);
  res.json({ ok: true });
});

app.delete('/api/staff/users/:userId', requireOwner, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await staffUtils.removeStaff(req.session.user.id, req.params.userId);
  res.json({ ok: true });
});

// Broadcast (owner only): one guild + channel, or every guild by channel NAME.
// Confirm step: the form requires a typed confirmation checkbox.
app.post('/api/staff/broadcast', requireOwner, async (req, res) => {
  const { guildId, channelId, channelName, title, body, confirm } = req.body || {};
  if (confirm !== true && confirm !== 'true') return res.status(400).json({ error: 'Confirm the broadcast first.' });
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required.' });
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const embed = { title: title.slice(0, 256), description: body.slice(0, 4000), color: 0x5865f2, timestamp: new Date().toISOString(), footer: { text: 'Vikings Hall announcement' } };
  const targets = [];
  try {
    if (guildId) {
      if (!channelId) return res.status(400).json({ error: 'Pick a channel for the chosen server.' });
      targets.push(channelId);
    } else {
      if (!channelName) return res.status(400).json({ error: 'Pick a channel name to broadcast to all servers.' });
      const guilds = (await discordApi.get('/users/@me/guilds', { headers: botHeaders() })).data;
      for (const g of guilds) {
        const chans = (await discordApi.get(`/guilds/${g.id}/channels`, { headers: botHeaders() })).data;
        const match = chans.find((c) => c.type === 0 && c.name === channelName);
        if (match) targets.push(match.id);
        await new Promise((r) => setTimeout(r, 150)); // rate-limit friendly
      }
    }
    let sent = 0;
    for (const chId of targets) {
      try {
        await discordApi.post(`/channels/${chId}/messages`, { embeds: [embed] }, { headers: botHeaders() });
        sent++;
      } catch (e) { console.warn(`[staff] broadcast to ${chId} failed:`, e.response?.data?.message || e.message); }
      await new Promise((r) => setTimeout(r, 300));
    }
    await db.query('INSERT INTO broadcasts (actor_id, guild_id, channel_id, channel_name, title, body) VALUES (?, ?, ?, ?, ?, ?)',
      [req.session.user.id, guildId || null, channelId || null, channelName || null, title, body]);
    await staffUtils.audit(req.session.user.id, 'broadcast', guildId || 'all', `sent to ${sent}/${targets.length} channels`);
    res.json({ ok: true, sent, attempted: targets.length });
  } catch (e) {
    console.error('[staff] broadcast failed:', e.message);
    res.status(500).json({ error: 'Broadcast failed — check the bot token and permissions.' });
  }
});

// Embed Creator (1.15.26, staff-only): compose a Discord embed in the
// dashboard and send it to one text channel. Same gating as the other
// staff APIs (requireStaff = owner + approved staff). Sends through the
// dashboard's own axios client + bot token — no second bot client.
app.get('/staff/embed-creator', requireStaff, async (req, res) => {
  let guilds = [];
  try {
    const r = await discordApi.get('/users/@me/guilds', { headers: botHeaders() });
    guilds = r.data;
  } catch { guilds = []; }
  res.render('staff', { user: req.session.user, section: 'embed-creator', data: { guilds }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

// Text channels of one guild, for the creator's channel picker.
app.get('/api/staff/guilds/:id/channels', requireStaff, async (req, res) => {
  const { channels } = await guildChannelsRoles(req.params.id).catch(() => ({ channels: [] }));
  const text = channels
    .filter((c) => c.type === 0)
    .map((c) => ({ id: c.id, name: c.name, position: c.position ?? 0 }))
    .sort((a, b) => a.position - b.position);
  res.json({ channels: text });
});

app.post('/api/staff/embed-creator', requireStaffWrite, async (req, res) => {
  const { guildId, channelId } = req.body || {};
  if (!guildId || !/^\d{17,20}$/.test(String(guildId))) return res.status(400).json({ error: 'Pick a server.' });
  if (!channelId || !/^\d{17,20}$/.test(String(channelId))) return res.status(400).json({ error: 'Pick a text channel.' });
  let payload;
  try {
    payload = require('./utils/embedBuilder').buildEmbed(req.body || {});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  // The channel must be a real text channel in the chosen guild — the
  // picker only offers those, but the id comes from the client, so verify.
  const { channels } = await guildChannelsRoles(guildId).catch(() => ({ channels: [] }));
  const channel = channels.find((c) => c.id === channelId && c.type === 0);
  if (!channel) return res.status(400).json({ error: 'That channel does not exist in this server (or is not a text channel).' });
  try {
    const msg = await discordApi.post(`/channels/${channelId}/messages`, payload, { headers: botHeaders() });
    await staffUtils.audit(req.session.user.id, 'embed.send', channelId, `guild=${guildId} msg=${msg.data.id} title=${payload.embeds[0].title || '(no title)'}`);
    res.json({ ok: true, messageId: msg.data.id, channelId, channelName: channel.name });
  } catch (e) {
    const detail = e.response?.data?.message || e.message;
    const status = e.response?.status === 403 ? 403 : 400;
    res.status(status).json({ error: `Discord refused the send: ${detail}` });
  }
});

// Error handler: log 500s through the central error logger.
app.use((err, req, res, next) => {
  errorLogger.log({ level: 'error', message: `Dashboard ${req.method} ${req.path} failed: ${err.message}`, stack: err.stack, context: { path: req.path, method: req.method } });
  res.status(500).send('Something went wrong — the error was logged for staff.');
});

// --- Start -----------------------------------------------------------------------
(async () => {
  await db.initDatabase();
  issueSetupToken();
  app.listen(PORT, () => {
    console.log(`[dashboard] Running at http://localhost:${PORT}`);
    console.log(`[dashboard] OAuth redirect URI must be: ${REDIRECT_URI}`);
  });
})();

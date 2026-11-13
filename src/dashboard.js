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
const errorLogger = require('./utils/errorLogger');
const { runBackup, retentionDays, BACKUP_DIR } = require('../scripts/backup-db');
const { FEATURES, setToggle } = require('./utils/featureToggles');
const { validateTemplate } = require('./utils/liveChannelTemplate');

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
app.use(rateLimit({ windowMs: 15 * 60_000, max: 300 }));
app.use(session({
  secret: (config.dashboard && config.dashboard.sessionSecret) || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: 'auto', maxAge: 24 * 60 * 60_000 },
}));
if ((config.dashboard?.sessionSecret || '').includes('CHANGE_ME')) {
  console.warn('[dashboard] WARNING: dashboard.sessionSecret in config.json is still the default — set a long random string before exposing this publicly.');
}

// --- Discord API helpers -------------------------------------------------------
const discordApi = axios.create({ baseURL: 'https://discord.com/api/v10', timeout: 10_000 });
const botHeaders = () => ({ Authorization: `Bot ${config.token}` });

function inviteUrl() {
  const perms = (config.dashboard && config.dashboard.invitePermissions) || 1099951041558;
  return `https://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=${perms}&scope=bot%20applications.commands`;
}

async function staffFlag(req) {
  return req.session.user ? await staffUtils.isStaff(req.session.user.id) : false;
}

async function requireStaff(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!(await staffUtils.isStaff(req.session.user.id))) return res.status(403).send('Staff only — this area is for the bot owner and approved staff.');
  next();
}

async function requireOwner(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!staffUtils.isOwner(req.session.user.id)) return res.status(403).send('Owner only.');
  next();
}

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

const setupLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Too many setup attempts — try again in 15 minutes.' });

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
  if (!req.session.user) return res.redirect('/login');
  next();
}

async function userGuilds(req) {
  // Cached in session for the login; refreshed on each server-picker visit.
  const res = await discordApi.get('/users/@me/guilds', {
    headers: { Authorization: `Bearer ${req.session.accessToken}` },
  });
  return res.data;
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
app.use('/setup', setupLimiter);
app.get('/setup', requireSetupAccess, (req, res) => res.redirect('/setup/1'));

app.get('/setup/:step', requireSetupAccess, (req, res) => {
  const n = parseInt(req.params.step, 10);
  if (Number.isNaN(n) || n < 1 || n > SETUP_STEPS.length) return res.redirect('/setup/1');
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
  res.render('version', { user: req.session.user || null, guilds: [], inviteUrl: inviteUrl(), isStaff: false, version, entries: loadChangelog() });
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

app.get('/login', (req, res) => {
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
    const userRes = await discordApi.get('/users/@me', { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
    req.session.user = userRes.data;
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
    res.redirect('/login');
  }
});

// --- Per-server settings pages (one per module) --------------------------------
const MODULES = ['general', 'moderation', 'tickets', 'serverstats', 'streams', 'music', 'leveling', 'reactionroles', 'gameservers', 'commands', 'applications', 'invites', 'welcome', 'automod', 'suggestions', 'economy', 'starboard', 'customcommands', 'faq', 'scheduled', 'roles'];

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
  }
  res.render('settings', {
    user: req.session.user, guild: req.guildMeta, module, settings,
    channels, roles, streamers, tickets, gameServers, applicationForms, pendingApplications, inviteLeaderboard, inviteStats, automodSettings, automodActions, suggestions, premiumSettings, shopItems, customCommands, faqs, scheduledMessages, inviteUrl: inviteUrl(),
    saved: req.query.saved === '1', isStaff: await staffFlag(req),
    commandCatalog: COMMAND_CATALOG,
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
  for (const k of ['serverStatsEnabled', 'levelUpMessages', 'welcomeEnabled', 'goodbyeEnabled']) if (body[k] === 'on') body[k] = 'true';
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
  if ('djRoleId' in body) setRole('djRoleId', body.djRoleId);
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
  // Welcome / goodbye (channel must exist in this server; message ≤2000 chars).
  if ('welcomeChannelId' in body) setChannel('welcomeChannelId', body.welcomeChannelId);
  if ('welcomeMessage' in body && typeof body.welcomeMessage === 'string' && body.welcomeMessage.length <= 2000) patch.welcomeMessage = body.welcomeMessage;
  if ('welcomeEnabled' in body) patch.welcomeEnabled = body.welcomeEnabled === true || body.welcomeEnabled === 'true';
  if ('goodbyeChannelId' in body) setChannel('goodbyeChannelId', body.goodbyeChannelId);
  if ('goodbyeMessage' in body && typeof body.goodbyeMessage === 'string' && body.goodbyeMessage.length <= 2000) patch.goodbyeMessage = body.goodbyeMessage;
  if ('goodbyeEnabled' in body) patch.goodbyeEnabled = body.goodbyeEnabled === true || body.goodbyeEnabled === 'true';
  if ('suggestionChannelId' in body) setChannel('suggestionChannelId', body.suggestionChannelId);
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

app.delete('/api/guilds/:id/streamers/:streamerId', requireAuth, requireGuildAccess, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('DELETE FROM streamers WHERE id = ? AND guild_id = ?', [req.params.streamerId, req.params.id]);
  res.json({ ok: true });
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

app.post('/api/staff/presence/rotate', requireStaff, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable — the bot checks the rotate flag in MySQL.' });
  await db.query('INSERT INTO presence_state (id, rotate_requested_at) VALUES (1, NOW()) ON DUPLICATE KEY UPDATE rotate_requested_at = NOW()');
  await staffUtils.audit(req.session.user.id, 'presence.rotate', '', 'rotate now requested');
  res.json({ ok: true });
});

app.post('/api/staff/presence/templates', requireStaff, async (req, res) => {
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
  await staffUtils.audit(req.session.user.id, 'presence.templates', '', `${activities.length} templates saved`);
  res.json({ ok: true, activities });
});


// --- Staff area (owner + approved staff only) --------------------------------
app.get('/staff', requireStaff, async (req, res) => {
  const data = { botConnected: false, shardInfo: 'Bot not connected — the dashboard runs standalone (npm run dashboard), separate from the bot process. Shard/live status comes from the bot itself; totals below come from the MySQL logs.' };
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
  res.render('staff', { user: req.session.user, section: 'error-detail', data: { error: row }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.post('/api/staff/errors/:id/resolve', requireStaff, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  await db.query('UPDATE error_logs SET resolved = 1, resolved_by = ? WHERE id = ?', [req.session.user.id, req.params.id]);
  await staffUtils.audit(req.session.user.id, 'error.resolve', req.params.id, null);
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
  res.render('staff', { user: req.session.user, section: 'manage', data: { staff: list, audit: auditRows, ownerId: config.ownerId, bootstrap: config.staffUserIds || [] }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.get('/staff/backups', requireStaff, async (req, res) => {
  const logs = db.isEnabled() ? (await db.query('SELECT * FROM backup_logs ORDER BY id DESC LIMIT 30') || []) : [];
  let files = [];
  try {
    files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sql.gz')).map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, mtime: st.mtime };
    }).sort((a, b) => b.mtime - a.mtime);
  } catch {}
  res.render('staff', { user: req.session.user, section: 'backups', data: { logs, files, retentionDays: retentionDays(), scheduleTime: (config.backups?.time || '03:00') }, isStaff: true, inviteUrl: inviteUrl(), saved: req.query.saved === '1' });
});

app.get('/staff/backups/download/:filename', requireStaff, async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename.endsWith('.sql.gz')) return res.status(400).send('Invalid backup file.');
  const full = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(full)) return res.status(404).send('Backup not found.');
  res.download(full, filename);
});

app.post('/api/staff/backup-now', requireStaff, async (req, res) => {
  const result = await runBackup();
  if (!result.ok) return res.status(500).json({ error: result.error });
  await staffUtils.audit(req.session.user.id, 'backup.manual', result.filename, `${result.sizeBytes} bytes`);
  res.json({ ok: true, filename: result.filename, sizeBytes: result.sizeBytes });
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

app.post('/api/staff/botflags/:id/clear', requireStaff, async (req, res) => {
  if (!db.isEnabled()) return res.status(500).json({ error: 'Database unavailable.' });
  const rows = await db.query('SELECT * FROM bot_flags WHERE id = ?', [req.params.id]) || [];
  const flag = rows[0];
  if (!flag) return res.status(404).json({ error: 'Flag not found.' });
  await db.query("UPDATE bot_flags SET status = 'reviewed', reviewed_by = ? WHERE id = ?", [req.session.user.id, flag.id]);
  await staffUtils.audit(req.session.user.id, 'botflag.clear', String(flag.user_id), `flag #${flag.id} score ${flag.score}`);
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
  await db.query("UPDATE bot_flags SET status = 'reviewed', action_taken = ?, reviewed_by = ? WHERE id = ?", [action, req.session.user.id, flag.id]);
  await staffUtils.audit(req.session.user.id, `botflag.${action}`, String(flag.user_id), `flag #${flag.id} score ${flag.score}`);
  res.json({ ok: true });
}
app.post('/api/staff/botflags/:id/kick', requireStaff, (req, res) => botFlagAction(req, res, 'kick'));
app.post('/api/staff/botflags/:id/ban', requireStaff, (req, res) => botFlagAction(req, res, 'ban'));

app.post('/api/staff/bottracking/settings', requireStaff, async (req, res) => {
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
  await staffUtils.audit(req.session.user.id, 'bottracking.settings', guildId, `threshold=${threshold} action=${autoAction}`);
  res.json({ ok: true });
});

// Plain-POST fallback for the bot-tracking settings form (no-JS browsers):
// same save as the API above, then back to the page with ?saved=1.
app.post('/staff/bottracking/settings', requireStaff, async (req, res) => {
  const { guildId, threshold, autoAction, suspectRoleId } = req.body || {};
  if (!guildId) return res.redirect('/staff/bottracking?saved=0');
  await setGuildSettings(guildId, {
    botThreshold: threshold == null || threshold === '' ? null : parseInt(threshold, 10),
    botAutoAction: ['flag', 'kick', 'ban'].includes(autoAction) ? autoAction : 'flag',
    botSuspectRoleId: suspectRoleId || '',
  });
  await staffUtils.audit(req.session.user.id, 'bottracking.settings', guildId, `threshold=${threshold} action=${autoAction} (form POST)`);
  res.redirect(`/staff/bottracking?guild=${encodeURIComponent(guildId)}&saved=1`);
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

app.post('/api/staff/commands', requireStaff, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { commandName, enabled } = req.body || {};
  if (!COMMAND_CATALOG.some((c) => c.name === commandName)) return res.status(400).json({ error: 'Unknown command.' });
  await setToggle('command_toggles', commandName, '', Boolean(enabled), req.session.user.id);
  await staffUtils.audit(req.session.user.id, 'command.toggle', commandName, `global enabled=${Boolean(enabled)}`);
  res.json({ ok: true });
});

app.post('/api/staff/features', requireStaff, async (req, res) => {
  if (!db.isEnabled()) return res.status(503).json({ error: 'Database unavailable.' });
  const { feature, enabled } = req.body || {};
  if (!FEATURES.includes(feature)) return res.status(400).json({ error: 'Unknown feature.' });
  await setToggle('feature_toggles', feature, '', Boolean(enabled), req.session.user.id);
  await staffUtils.audit(req.session.user.id, 'feature.toggle', feature, `global enabled=${Boolean(enabled)}`);
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
  const embed = { title: title.slice(0, 256), description: body.slice(0, 4000), color: 0x5865f2, timestamp: new Date().toISOString(), footer: { text: 'Ace Bot announcement' } };
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

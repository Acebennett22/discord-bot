// Verify 1.16.13: EJS 3.1.10 → 7.0.2 — every dashboard view renders under the
// new major, through the REAL EJS 7 (ejs.renderFile, the same entry point
// Express calls via ejs.__express), with mock data shaped like what the
// dashboard routes actually pass. No live bot, no live dashboard.
// Breaking changes checked from the INSTALLED package (node_modules/ejs):
// EJS 7 ships dual CJS/ESM with the CJS surface (require('ejs'),
// ejs.__express) unchanged; the v6 prototype-pollution mitigation copies
// locals onto a null-prototype object by default (unsafePrototypeLocals:
// false), so a __proto__ key in render data cannot pollute Object.prototype
// and inherited properties of a passed locals object are not visible — our
// routes only pass plain-object literals, so all their properties are own
// properties and nothing needed changing. (Bare prototype members like
// toString still resolve via the global object's prototype chain — that is
// unchanged behavior, not part of the mitigation.) The Node engines field is
// still >=0.12.18, so the server's Node 20.5.1 is fine. No template or
// dashboard-code adaptation was needed: a scratch comparison rendered all
// 69 cases under both EJS 3.1.10 and 7.0.2 with byte-identical output.
'use strict';

// The sandbox config.json holds placeholder credentials, and config.js
// exits on them — the dashboard's own setup-wizard escape hatch
// (ALLOW_PLACEHOLDER_CONFIG=1) is the documented way to load code without
// a real token. Nothing here reaches Discord or MySQL.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ejs = require('ejs');
const docsUtil = require('../src/utils/docs');

// --- Test harness (same shape as tmp/verify-1.16.12.js) ----------------------
let passed = 0;
let failed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

function src(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function installedVersion(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
}

// --- Mock data, shaped like the dashboard routes' res.render locals ---------
const base = {
  user: { id: '1', username: 'Tester', avatar: null },
  inviteUrl: 'https://example.invalid/invite',
  isStaff: true,
  authExpired: false,
  localAccount: null,
  canManageAccounts: true,
  saved: false,
};

function settingsMock(module) {
  const lists = ['channels', 'roles', 'streamers', 'tickets', 'gameServers', 'applicationForms',
    'pendingApplications', 'inviteLeaderboard', 'inviteStats', 'automodActions', 'suggestions',
    'shopItems', 'customCommands', 'faqs', 'scheduledMessages', 'birthdays', 'reactionRoleMappings',
    'giveaways', 'mcWidgets', 'playlists', 'roleMenus', 'countdowns', 'emojis', 'workJobs',
    'recentRobs', 'tempBans', 'lotteryDraws', 'serverRules', 'scheduledEventsList',
    'wordleLeaderboard', 'slowmodeSchedules', 'builtEmbeds', 'pastPolls', 'inviteRewardList',
    'inactiveMembers', 'threadOverrides', 'pendingConfessions', 'tempRoles', 'xpShopItems',
    'commandToggles', 'ticketPanels', 'inviteRoleRules', 'prestigeLeaderboard',
    'statusRoleRules', 'modmailThreads', 'modmailBlocks', 'triviaLeaderboard', 'colorRoles'];
  const objs = ['settings', 'automodSettings', 'premiumSettings', 'countingSettings',
    'aiUsage', 'milestoneNext', 'milestoneSettings', 'translateSettings', 'lotteryStatus',
    'triviaSettings', 'wordleToday', 'ticketRatingStats', 'voiceStats', 'identity'];
  const data = {
    ...base, guild: { id: '123', name: 'Test Guild', icon: null }, module,
    settings: {}, identity: {}, analyticsData: { daily: [] },
  };
  for (const k of lists) data[k] = [];
  for (const k of objs) data[k] = {};
  data.commandCatalog = [];
  data.aiConfigured = false;
  data.voiceRate = 0;
  return data;
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

const SETTINGS_MODULES = ['general', 'identity', 'moderation', 'tickets', 'serverstats', 'streams',
  'music', 'leveling', 'reactionroles', 'gameservers', 'applications', 'commands', 'invites',
  'welcome', 'automod', 'suggestions', 'economy', 'starboard', 'customcommands', 'faq',
  'scheduled', 'roles', 'verification', 'counting', 'tempvc', 'birthdays', 'analytics',
  'giveaways', 'ai', 'modmail', 'games', 'emojis', 'media', 'threads', 'confessions',
  'events', 'embeds', 'embed-creator', 'polls', 'announcements'];

const STAFF_DATA = {
  overview: {},
  errors: { errors: [{ id: 1, level: 'error', shard_id: 0, command_name: 'test', message: 'boom', resolved: false, created_at: new Date('2026-11-21T00:00:00Z') }], filters: { level: '', command: '', shard: '' } },
  'error-detail': { error: { id: 1, level: 'error', shard_id: 0, guild_id: '123', command_name: 'test', user_id: '1', created_at: '2026-11-21 00:00:00', resolved: false, message: 'boom', stack: 'Error: boom', context: '{"a":1}' } },
  commands: { catalog: [{ name: 'ping', category: 'Utility' }], toggles: {} },
  features: { features: ['music'], toggles: {} },
  manage: { staff: [{ user_label: 'Tester', role: 'staff', added_by_label: 'Owner', user_id: '1' }], audit: [], ownerId: '1', bootstrap: [] },
  accounts: { accounts: [{ id: 1, username: 'kitten', role: 'admin', disabled: false, last_login_at: '2026-11-21', created_by: 'owner' }], selfId: 1 },
  broadcast: { guilds: [{ id: '1', name: 'Test Guild' }] },
  'embed-creator': { guilds: [] },
  bottracking: { guilds: [{ id: '1', name: 'Test Guild' }], guildId: '', flags: [], stats: [], botSettings: {}, raid: {}, defaults: {} },
  antinuke: { guilds: [{ id: '1', name: 'Test Guild' }], guildId: '', events: [], antinukeSettings: {} },
  transcripts: { transcripts: [], guilds: [{ id: '1', name: 'Test Guild' }], guildId: '', q: '' },
};
const STAFF_SECTIONS = Object.keys(STAFF_DATA);

function renderFile(file, data) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(path.join(root, 'dashboard', 'views', file), data, {}, (err, str) => (err ? reject(err) : resolve(str)));
  });
}

async function main() {
  await check('package.json pins ejs ^7.0.2 and 7.0.2 is installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.dependencies.ejs, '^7.0.2');
    assert.strictEqual(installedVersion('ejs'), '7.0.2');
    assert.strictEqual(pkg.version, '1.16.13');
    const changelog = src('CHANGELOG.md');
    assert.ok(changelog.includes('## [1.16.13]'), 'no 1.16.13 CHANGELOG entry');
  });

  await check('no other dependency changed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.dependencies.helmet, '^8.3.0');
    assert.strictEqual(pkg.dependencies['express-rate-limit'], '^8.7.5');
    assert.strictEqual(pkg.dependencies['node-cron'], '^4.6.0');
    assert.strictEqual(pkg.dependencies.express, '^4.21.0');
  });

  await check('Express integration intact: ejs.__express is renderFile', () => {
    assert.strictEqual(ejs.__express, ejs.renderFile);
    const dashboard = src('src/dashboard.js');
    assert.ok(dashboard.includes("app.set('view engine', 'ejs')"), 'view engine not set to ejs');
    assert.ok(dashboard.includes("app.set('views', path.join(__dirname, '..', 'dashboard', 'views'))"), 'views dir not set');
    // No code requires ejs directly — only Express loads it via the view engine.
    for (const f of ['src/dashboard.js', 'src/utils/docs.js']) {
      assert.ok(!src(f).includes("require('ejs')") && !src(f).includes('require("ejs")'), `${f} requires ejs directly`);
    }
  });

  await check('no template relies on removed EJS behavior', () => {
    // Include preprocessor directives (<% include x %>) were removed in v3;
    // inherited properties of a passed locals object are no longer visible
    // under the v6+ null-prototype copy, so no template may reference a bare
    // identifier that only exists on a prototype (none do — all locals are
    // plain-object literals passed by the routes). Neither may appear.
    const viewsDir = path.join(root, 'dashboard', 'views');
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.name.endsWith('.ejs')) files.push(path.join(dir, e.name));
      }
    })(viewsDir);
    assert.strictEqual(files.length, 11, `expected 11 .ejs files, found ${files.length}`);
    for (const f of files) {
      const t = fs.readFileSync(f, 'utf8');
      assert.ok(!/<%\s*include[\s>]/.test(t), `${path.basename(f)} uses a removed include directive`);
    }
  });

  await check('EJS 7 null-prototype locals: own properties render, __proto__ data cannot pollute', () => {
    // Own property of a plain-object local: renders (this is all our templates use).
    assert.strictEqual(ejs.render('<%= user.name %>', { user: { name: 'Tester' } }), 'Tester');
    // A __proto__ key in the data must not leak its properties into the
    // template scope, and must not pollute Object.prototype (the v6 fix).
    assert.throws(() => ejs.render('<%= polluted %>', JSON.parse('{"__proto__":{"polluted":"yes"}}')), /polluted is not defined/);
    assert.strictEqual({}.polluted, undefined);
    // An inherited property of a class-instance locals object is not visible
    // either — only own properties are copied onto the null-prototype object.
    function K() {}
    K.prototype.inherited = 'yes';
    assert.throws(() => ejs.render('<%= inherited %>', new K()), /inherited is not defined/);
  });

  // --- Render every view -----------------------------------------------------
  const rendered = [];
  async function attempt(name, file, data, marker) {
    const out = await renderFile(file, data);
    assert.ok(out && out.length > 0, `${name} rendered empty output`);
    if (marker) assert.ok(out.includes(marker), `${name} missing marker: ${marker}`);
    rendered.push(name);
  }

  await check('every dashboard view renders under EJS 7', async () => {
    await attempt('added', 'added.ejs', { ...base });
    await attempt('docs', 'docs.ejs', { ...base, content: docsUtil.getContent(), groups: docsUtil.groupedCommands() }, 'Vikings Hall Wiki');
    await attempt('home', 'home.ejs', { ...base, guilds: [{ id: '1', name: 'Test Guild', icon: null, botPresent: true }] });
    await attempt('login', 'login.ejs', { ...base, error: null, username: '' });
    await attempt('version', 'version.ejs', { ...base, version: '1.16.13', startedAt: '2026-11-21T00:00:00Z', entries: [{ version: '1.16.13', date: '2026-11-21', sections: [{ title: 'Changed', items: ['x'] }] }] }, 'v1.16.13');
    for (const m of SETTINGS_MODULES) {
      await attempt(`settings/${m}`, 'settings.ejs', settingsMock(m));
    }
    for (const s of SETUP_STEPS) {
      const isReview = s.id === 'review';
      await attempt(`setup/${s.id}`, 'setup.ejs', {
        ...base, step: s, steps: SETUP_STEPS, data: {}, error: null,
        links: {}, saved: false, finish: isReview, botUsername: null, isHttp: false, publicUrl: '',
      });
    }
    await attempt('setup/finish', 'setup.ejs', {
      ...base, step: SETUP_STEPS[7], steps: SETUP_STEPS, data: {}, error: null,
      links: {}, saved: true, finish: true, botUsername: 'Vikings Hall Clerk#2587', isHttp: false, publicUrl: '',
    });
    for (const s of STAFF_SECTIONS) {
      await attempt(`staff/${s}`, 'staff.ejs', { ...base, section: s, data: STAFF_DATA[s] });
    }
    await attempt('partial/header', 'partials/header.ejs', { ...base });
    await attempt('partial/footer', 'partials/footer.ejs', {});
    await attempt('partial/embed-creator-form', 'partials/embed-creator-form.ejs',
      { ...base, showGuildPicker: true, guilds: [{ id: '1', name: 'Test Guild' }], channels: [], settings: {}, module: 'embeds' });

    // The enumeration is the test: a silently skipped view fails here.
    const expected = ['added', 'docs', 'home', 'login', 'version',
      ...SETTINGS_MODULES.map((m) => `settings/${m}`),
      ...SETUP_STEPS.map((s) => `setup/${s.id}`), 'setup/finish',
      ...STAFF_SECTIONS.map((s) => `staff/${s}`),
      'partial/header', 'partial/footer', 'partial/embed-creator-form'];
    assert.deepStrictEqual([...rendered].sort(), [...expected].sort(),
      `rendered set does not match expected set (${rendered.length} rendered, ${expected.length} expected)`);
    assert.strictEqual(rendered.length, 69, `expected 69 renders, got ${rendered.length}`);
  });

  console.log(`\n${passed} passed, ${failed} failed${failed ? ` (${failures.join(', ')})` : ''}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

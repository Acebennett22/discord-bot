// Verify 1.16.9: docs rewrite — every user-facing command reference uses
// the consolidated names from 1.15.0, the dashboard /docs scan emits
// consolidated names, and /ask identifies as Vikings Hall Clerk.
// Exercises the REAL src/utils/docs.js scanCommands, the REAL
// buildConsolidated() output (the deployed-path source of truth), and the
// REAL rewritten docs/content.json + README.md. No live bot or dashboard.
'use strict';

// The sandbox config.json holds placeholder credentials, and config.js
// exits on them — the dashboard's own setup-wizard escape hatch
// (ALLOW_PLACEHOLDER_CONFIG=1) is the documented way to load code without
// a real token. Nothing here reaches Discord.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const docs = require('../src/utils/docs');
const { buildConsolidated, PARENT_MAP, UTILITY_TOOLS, stripPrefix } = require('../src/handlers/consolidate');

// --- Test harness (same shape as tmp/verify-1.16.8.js) ----------------------
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

// --- Deployed paths, from the REAL builder ----------------------------------
// buildConsolidated() is the payload that gets registered with Discord.
// Every path it spells out — top-level, subcommand, group, group child —
// is a legal reference. A docs reference is current iff the slash-form it
// writes is one of these paths.
function deployedPaths() {
  const { topLevel } = buildConsolidated();
  const set = new Set();
  for (const { data } of topLevel) {
    const j = data.toJSON();
    const base = `/${j.name}`;
    set.add(base);
    for (const o of j.options || []) {
      if (o.type === 1) set.add(`${base} ${o.name}`);
      if (o.type === 2) {
        set.add(`${base} ${o.name}`);
        for (const s of o.options || []) set.add(`${base} ${o.name} ${s.name}`);
      }
    }
  }
  return { set, topLevel };
}

// --- Flat command names, by scanning the source files -----------------------
// Same name/description rules as scanCommands: a file only appears in the
// reference if it has both. (The two context-menu files have no
// description, so they are never in the reference.)
const DESC_RE = /\.setDescription\((?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\)/;
function walkFlat() {
  const dir = path.join(root, 'src/commands');
  const out = [];
  for (const folder of fs.readdirSync(dir)) {
    const folderPath = path.join(dir, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    for (const file of fs.readdirSync(folderPath)) {
      if (!file.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(folderPath, file), 'utf8');
      const name = src.match(/\.setName\('([^']+)'\)/)?.[1];
      if (!name) continue;
      out.push({ folder, file, name, contextMenu: /ContextMenuCommandBuilder/.test(src), hasDesc: DESC_RE.test(src) });
    }
  }
  return out;
}

// Consolidated display name for a flat file — the same rule docs.js uses.
function consolidatedName({ folder, name }) {
  const parent = folder === 'utility' && UTILITY_TOOLS.has(name) ? 'tools' : PARENT_MAP[folder];
  return parent ? `${parent} ${stripPrefix(name, parent) || name}` : name;
}

// --- Stale-reference classifier ---------------------------------------------
// Same token regex and guards as the rewrite script (tmp/rewrite-docs.js):
// lookbehind blocks tokens inside a path/word, a '.' + letter or a '/'
// right after the flat name means a filename or path continuation.
// A token is stale iff its first word IS a flat command name and the
// slash-form as written is NOT a deployed path. Already-consolidated
// references pass: their first word is a parent name, not a flat name.
const TOKEN_RE = /(?<![A-Za-z0-9_\/.\\-])\/([a-z0-9][a-z0-9-]*)(?: ([a-z][a-z0-9-]*))?/g;
function findStale(text, flatSet, deployed, allowContexts) {
  const stale = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    const flat = m[1];
    const word2 = m[2];
    const offset = m.index;
    if (!flatSet.has(flat)) continue;
    const afterFlat = text[offset + 1 + flat.length];
    if (afterFlat === '.' && /[A-Za-z]/.test(text[offset + 1 + flat.length + 1] || '')) continue;
    if (afterFlat === '/') continue;
    const asWritten = `/${flat}${word2 ? ` ${word2}` : ''}`;
    if (deployed.has(asWritten)) continue;
    if (allowContexts.some((ctx) => {
      const i = text.indexOf(ctx);
      return i !== -1 && offset >= i && offset < i + ctx.length;
    })) continue;
    const lineNo = text.slice(0, offset).split('\n').length;
    stale.push(`${asWritten} (line ${lineNo})`);
  }
  return stale;
}

(async () => {
  const flatFiles = walkFlat();
  const slashFiles = flatFiles.filter((f) => !f.contextMenu);
  const flatSet = new Set(slashFiles.map((f) => f.name));
  const { set: deployed, topLevel } = deployedPaths();
  const content = fs.readFileSync(path.join(root, 'docs/content.json'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

  await check('deployed set sanity: 39 top-level, 270 files (268 slash + 2 context menus), group + standalone sub-paths present', async () => {
    assert.strictEqual(topLevel.length, 39, `top-level ${topLevel.length}`);
    assert.strictEqual(flatFiles.length, 270, `total files ${flatFiles.length}`);
    assert.strictEqual(slashFiles.length, 268, `slash ${slashFiles.length}`);
    for (const p of ['/ticket panel', '/ticket panel create', '/giveaway start', '/mod ban', '/music play', '/economy shop', '/fun 8ball', '/music 247', '/birthday birthday', '/birthday birthday set', '/tempvc tempvc', '/utility setup', '/verify verify']) {
      assert.ok(deployed.has(p), `deployed set missing ${p}`);
    }
    assert.ok(!deployed.has('/ban'), '/ban must not be a deployed path');
    assert.ok(!deployed.has('/play'), '/play must not be a deployed path');
    assert.ok(!deployed.has('/ticket-setup'), '/ticket-setup must not be a deployed path');
  });

  await check('docs: scan emits consolidated names — full set equality with the mapping', async () => {
    const scanned = docs.scanCommands();
    // Only files with a description reach the reference (same rule as the
    // scan itself); every slash file has one, including wordle, whose
    // description is double-quoted.
    const expected = new Set(slashFiles.filter((f) => f.hasDesc).map(consolidatedName));
    const got = new Set(scanned.map((c) => c.name));
    assert.strictEqual(scanned.length, expected.size, `scan returned ${scanned.length} entries, expected ${expected.size}`);
    for (const name of expected) assert.ok(got.has(name), `scan missing ${name}`);
    for (const name of got) assert.ok(expected.has(name), `scan has unexpected ${name}`);
  });

  await check('docs: scan spot checks (grouped, utility, standalone, self-named)', async () => {
    const byName = new Map(docs.scanCommands().map((c) => [c.name, c]));
    for (const name of ['mod ban', 'ticket panel', 'music play', 'tools poll', 'economy shop', 'fun 8ball', 'music 247', 'birthday birthday', 'steam steam', 'weather weather', 'verify verify', 'tempvc tempvc', 'automod automod', 'suggest suggest', 'giveaway', 'mediathreads', 'serverbackup', 'botidentity', 'fun wordle']) {
      assert.ok(byName.has(name), `scan missing ${name}`);
    }
    for (const stale of ['ban', 'play', 'poll', 'setup', 'ticket-setup', 'birthday-set', 'shop', 'ticket-panel', '8ball', '247']) {
      assert.ok(!byName.has(stale), `scan still lists flat name ${stale}`);
    }
  });

  await check('docs: scan keeps botidentity in Bot Identity with the 3 subcommands (1.16.8 regression)', async () => {
    const entry = docs.scanCommands().find((c) => c.name === 'botidentity');
    assert.ok(entry, 'botidentity missing from scan');
    assert.strictEqual(entry.category, 'Bot Identity');
    assert.deepStrictEqual([...entry.subcommands].sort(), ['reset', 'set-name', 'show']);
    assert.strictEqual(entry.audience, 'Admin');
  });

  await check('docs: content.json has no stale flat references', async () => {
    const stale = findStale(content, flatSet, deployed, []);
    assert.deepStrictEqual(stale, [], `stale refs: ${stale.join(', ')}`);
  });

  await check('docs: README has no stale flat references except verified non-command uses', async () => {
    // These three are NOT slash commands and must stay as written:
    //  - the /setup rate limit is the dashboard setup-wizard route
    //    (Express rate limiting only applies to HTTP routes);
    //  - "Listening to /help" quotes the config.json presence default
    //    verbatim (the default itself is still stale — a code change for
    //    a later release, not docs);
    //  - /shop in the endpoints list is the dashboard API route
    //    /api/guilds/:id/shop, not the /economy shop command.
    const allow = [
      'including the `/setup` limit',
      '`Listening to /help`',
      '(`/streamers`, `/applications`, `/suggestions`, `/shop`, `/custom-commands`, `/faq`, `/scheduled`, `/commands`)',
    ];
    const stale = findStale(readme, flatSet, deployed, allow);
    assert.deepStrictEqual(stale, [], `stale refs: ${stale.join(', ')}`);
  });

  await check('docs: consolidated names are present in content.json', async () => {
    // The guides never reference a plain /mod ban (banning is documented
    // via /mod tempban), /fun 8ball, or any /steam command (Steam appears
    // only as the steamcommunity.com API-key URL), so none of those are
    // in this list — the zero-stale classifier check above is the proof
    // nothing stale remains.
    for (const ref of ['/ticket setup', '/mod tempban', '/music play', '/economy shop', '/music 247', '/ticket panel', '/birthday birthday set', '/weather weather', '/utility setup', '/verify verify', '/tempvc tempvc', '/botidentity set-name', '/staff errors', '/invite inviterole add', '/invite myinviterewards', '/invite invites', '/invite inviteleaderboard', '/invite info', '/invite reset']) {
      assert.ok(content.includes(ref), `content.json missing ${ref}`);
    }
    for (const ref of ['/ticket-setup', '/ticket-panel']) {
      assert.ok(!content.includes(ref), `content.json still has ${ref}`);
    }
  });

  await check('docs: audit-flagged nonexistent commands are only routes / files / repo names', async () => {
    // /invite: only the dashboard route, twice — once as "(or /invite)",
    // once as "or /invite)" — and the real consolidated commands
    // /invite inviterole, /invite invitereward, /invite invites,
    // /invite inviteleaderboard, /invite myinviterewards, /invite info,
    // /invite reset.
    assert.strictEqual((content.match(/\/invite\)/g) || []).length, 2, '/invite route refs');
    for (const m of content.matchAll(/\/invite ([a-z]+)/g)) {
      assert.ok(['inviterole', 'invitereward', 'invites', 'inviteleaderboard', 'myinviterewards', 'info', 'reset'].includes(m[1]), `/invite ${m[1]} is not a real command`);
    }
    // /version: only "the /version page" (dashboard).
    assert.strictEqual((content.match(/\/version/g) || []).length, 1);
    assert.ok(content.includes('the /version page'));
    // /bot-errors: only the log file path.
    assert.strictEqual((content.match(/bot-errors/g) || []).length, 1);
    assert.ok(content.includes('logs/bot-errors.log'));
    // /restore-db: only the script invocation.
    assert.strictEqual((content.match(/restore-db/g) || []).length, 1);
    assert.ok(content.includes('node scripts/restore-db.js'));
    // /wordle-list: only the GitHub repo name.
    assert.strictEqual((content.match(/wordle-list/g) || []).length, 1);
    assert.ok(content.includes('tabatkins/wordle-list'));
  });

  await check('docs: README mediathreads fix (/mediathreads add, no set subcommand)', async () => {
    assert.ok(readme.includes('/mediathreads add <channel>'), 'README missing /mediathreads add');
    assert.ok(!readme.includes('/mediathreads set'), 'README still says /mediathreads set');
  });

  await check('ai: system prompt says Vikings Hall Clerk, not AceBot', async () => {
    const ai = fs.readFileSync(path.join(root, 'src/utils/ai.js'), 'utf8');
    assert.ok(ai.includes('You are Vikings Hall Clerk'), 'ai.js prompt missing Vikings Hall Clerk');
    assert.ok(!ai.includes('You are AceBot'), 'ai.js prompt still says AceBot');
  });

  await check('ai: internal-only AceBot strings untouched', async () => {
    assert.ok(fs.readFileSync(path.join(root, 'src/utils/spotify.js'), 'utf8').includes('AceBot/1.2.7'), 'spotify.js User-Agent changed');
    assert.ok(fs.readFileSync(path.join(root, 'src/utils/translate.js'), 'utf8').includes('AceBot/1.10'), 'translate.js User-Agent changed');
    assert.ok(fs.readFileSync(path.join(root, 'dashboard/public/js/settings.js'), 'utf8').includes('AceBot.'), 'dashboard settings.js AceBot namespace changed');
  });

  await check('version: package.json 1.16.9 with changelog entry', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.16.9');
    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    assert.ok(changelog.includes('## [1.16.9] - 2026-11-21'), 'CHANGELOG.md missing 1.16.9 entry');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('Failures:', failures.join(', '));
    process.exit(1);
  }
})();

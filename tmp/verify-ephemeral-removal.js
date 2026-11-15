#!/usr/bin/env node
// Verification for 1.15.7 (remove ephemeral) — run with
// ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-ephemeral-removal.js
// Asserts:
//  1. Full bot load via the real loader: 268 flat commands, 38 top-level, 0 failures.
//  2. Remaining `ephemeral: true` sites == the codemod KEEP list (74), nothing else.
//  3. /help and /trivia replies are public AND their collectors are invoker-only.
//  4. No empty reply/followUp/deferReply/update option objects left behind.
//  5. The 1.15.5 /help group checks still pass (groupEmbed + count 268).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// --- 1. Full bot load via the real loader ---
const { loadCommands } = require('../src/handlers/commandHandler');
const client = { commands: new Map() };
let loaded = null;
try {
  loadCommands(client);
  loaded = { size: client.commands.size };
} catch (e) {
  check('bot load (no require failures)', false, e.message);
}
if (loaded) {
  check('bot load: 38 top-level commands', loaded.size === 38, `got ${loaded.size}`);
  const { buildConsolidated } = require('../src/handlers/consolidate');
  const { flatCount, childCount } = buildConsolidated();
  check('bot load: 268 flat commands', flatCount === 268, `got ${flatCount}`);
  // 263 grouped children + 3 standalones (giveaway, serverbackup,
  // mediathreads) = 266 flat chat children reachable; the 2 context menus
  // make up the remaining 2 of the 268 files.
  check('bot load: 263 grouped chat children', childCount === 263, `got ${childCount}`);
}

// --- 2. Remaining ephemeral sites == KEEP list ---
const codemodSrc = fs.readFileSync(path.join(__dirname, 'remove-ephemeral-codemod.py'), 'utf8');
const keepPairs = [...codemodSrc.matchAll(/\("(src\/[^"]+)", (\d+)\)/g)]
  .map((m) => `${m[1]}:${m[2]}`);
const keepSet = new Set(keepPairs);
const grepOut = execSync(
  'grep -rn "ephemeral: true" src/ --include="*.js"',
  { cwd: ROOT, encoding: 'utf8' },
).trim();
const remaining = grepOut ? grepOut.split('\n').map((l) => {
  const m = l.match(/^(src\/[^:]+):(\d+):/);
  return m ? `${m[1]}:${m[2]}` : l;
}) : [];
check('remaining ephemeral sites == KEEP list (74)', remaining.length === keepSet.size
  && remaining.every((r) => keepSet.has(r)),
`got ${remaining.length}, expected ${keepSet.size}`);
const extra = remaining.filter((r) => !keepSet.has(r));
if (extra.length) console.log('  extra (should be removed):', extra.join(', '));
const missing = [...keepSet].filter((k) => !remaining.includes(k));
if (missing.length) console.log('  missing (should be kept):', missing.join(', '));

// --- 3. /help and /trivia: public reply + invoker-only collector ---
for (const [file, kind] of [
  ['src/commands/utility/help.js', 'StringSelect'],
  ['src/commands/fun/trivia.js', 'Button'],
]) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  check(`${file}: no ephemeral left`, !src.includes('ephemeral'));
  check(`${file}: collector has invoker-only filter`,
    src.includes('filter: (sel) => sel.user.id === interaction.user.id')
    || src.includes('filter: (btn) => btn.user.id === interaction.user.id')
    // 1.15.8 unified the help collector to one (i) filter covering both the
    // select menu and the buttons (no componentType filter).
    || src.includes('filter: (i) => i.user.id === interaction.user.id'));
}

// --- 4. No empty option objects left behind ---
const emptyObj = execSync(
  'grep -rn "reply({})\\|followUp({})\\|deferReply({})\\|update({})" src/ --include="*.js" || true',
  { cwd: ROOT, encoding: 'utf8' },
).trim();
check('no empty reply/followUp/deferReply/update objects', emptyObj === '', emptyObj);

// --- 5. /help group checks (1.15.5 test) still pass ---
try {
  execSync('node tmp/verify-help.js', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  check('/help verify script (tmp/verify-help.js) passes', true);
} catch (e) {
  check('/help verify script (tmp/verify-help.js) passes', false, (e.stdout || '') + (e.stderr || ''));
}

// --- 3b. /trivia: execute with a mock interaction, test the filter live ---
const triviaCmd = require('../src/commands/fun/trivia');
(async () => {
  let capturedCollector = null;
  let capturedReply = null;
  const mockMsg = {
    createMessageComponentCollector: (opts) => { capturedCollector = opts; return { on: () => {} }; },
  };
  const mockInteraction = {
    user: { id: '111' },
    reply: async (opts) => { capturedReply = opts; return { resource: { message: mockMsg } }; },
    editReply: async () => {},
  };
  await triviaCmd.execute(mockInteraction);
  check('/trivia: reply is public (no ephemeral flag)', capturedReply && capturedReply.ephemeral === undefined);
  check('/trivia: collector is invoker-only (accepts invoker, rejects others)',
    capturedCollector && typeof capturedCollector.filter === 'function'
    && capturedCollector.filter({ user: { id: '111' } }) === true
    && capturedCollector.filter({ user: { id: '222' } }) === false);
  finish();
})().catch((e) => { check('/trivia: execute with mock interaction', false, e.message); finish(); });

function finish() {
  console.log(failures === 0 ? 'ALL EPHEMERAL-REMOVAL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

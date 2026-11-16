// Verification for 1.15.29: ephemeral -> MessageFlags migration + translate 429 handling.
// Run: node tmp/verify-1.15.29.js   (exit 0 = all pass)
// config.js exits on placeholder credentials unless this is set first.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;
let total = 0;
function check(name, fn) {
  total++;
  try { fn(); console.log(`  PASS ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
}
const pending = [];
let chain = Promise.resolve();
function checkAsync(name, fn) {
  total++;
  // Chain async checks so they run sequentially in source order — they share
  // module state (fetch mock, cooldown map, lastCallAt) and must not race.
  chain = chain.then(async () => {
    try { await fn(); console.log(`  PASS ${name}`); }
    catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
  });
  pending.push(chain);
}

// --- Mock the database BEFORE requiring translate.js (it requires ./database,
// and errorLogger requires it too — the cache injection covers both). ---
let mockRows = [];
const dbPath = require.resolve('../src/utils/database');
require.cache[dbPath] = { exports: { isEnabled: () => true, query: async () => mockRows } };

const translate = require('../src/utils/translate');
const errorLogger = require('../src/utils/errorLogger');
const loggedEntries = [];
errorLogger.log = (entry) => { loggedEntries.push(entry); };

const CH = '111111111111111111';
const mockMsg = (guildId, content) => ({
  guildId, channelId: CH, content,
  reply: async () => {},
});
const okTranslateBody = [[['Hello', 'hola', null, null], [' thanks', ' gracias', null, null]], null, 'es'];
const okRes = () => ({ status: 200, ok: true, json: async () => okTranslateBody });
const errRes = (status) => ({ status, ok: false, json: async () => ({}) });

console.log('== 1. Ephemeral migration (grep-based) ==');
check('no `ephemeral:` remains anywhere in src/', () => {
  const out = execSync('grep -rn "ephemeral:" src/ --include="*.js" || true', { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(out, '', `still present:\n${out}`);
});
check('no `ephemeral: true` remains anywhere in src/', () => {
  const out = execSync('grep -rn "ephemeral: true" src/ --include="*.js" || true', { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(out, '');
});
check('exactly 74 `flags: MessageFlags.Ephemeral` sites', () => {
  const out = execSync('grep -rn "flags: MessageFlags.Ephemeral" src/ --include="*.js"', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  assert.strictEqual(out.length, 74, `got ${out.length}`);
});
// Bare-word `ephemeral` mentions left deliberately — all comments, none is code.
const COMMENT_ALLOWLIST = {
  'src/commands/utility/poll.js:34': 'comment: notes the poll post is the exception to ephemeral replies',
  'src/commands/sticky/sticky-set.js:7': 'comment: notes no ephemeral in the sticky defer/edit order',
  'src/events/giveawayInteraction.js:3': 'comment: explains a missed requirement gets an ephemeral message',
  'src/events/reactionRoleInteraction.js:3': 'comment: explains a missed requirement gets an ephemeral message',
};
check('remaining bare-word `ephemeral` mentions are exactly the 4 allowlisted comments', () => {
  const out = execSync('grep -rn "ephemeral" src/ --include="*.js"', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  assert.strictEqual(out.length, 4, `got ${out.length}: ${out.join(' | ')}`);
  for (const line of out) {
    const m = line.match(/^(src\/[^:]+:\d+):/);
    assert.ok(m, `unparseable line: ${line}`);
    assert.ok(COMMENT_ALLOWLIST[m[1]], `not allowlisted: ${line}`);
    assert.ok(line.includes('//'), `not a comment: ${line}`);
  }
});
check('every file using MessageFlags.Ephemeral imports MessageFlags', () => {
  const out = execSync('grep -rln "flags: MessageFlags.Ephemeral" src/ --include="*.js"', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  assert.strictEqual(out.length, 29, `got ${out.length} files`);
  for (const rel of out) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(/require\('discord\.js'\)/.test(src), `${rel}: no discord.js require`);
    assert.ok(src.includes('MessageFlags'), `${rel}: MessageFlags not imported`);
  }
});
check('no `ephemeral` in any interaction-response call (reply/deferReply/followUp/editReply)', () => {
  // Any `ephemeral` token left must be inside a `//` comment (checked above).
  const out = execSync('grep -rn "ephemeral" src/ --include="*.js"', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  for (const line of out) {
    const code = line.split(':').slice(2).join(':');
    assert.ok(code.trim().startsWith('//'), `non-comment ephemeral: ${line}`);
  }
});

console.log('== 2. Bot still loads (no require failures from the migration) ==');
check('command loader: 38 top-level, 269 flat', () => {
  const { loadCommands } = require('../src/handlers/commandHandler');
  const client = { commands: new Map() };
  loadCommands(client);
  assert.strictEqual(client.commands.size, 38, `top-level got ${client.commands.size}`);
  const { buildConsolidated } = require('../src/handlers/consolidate');
  const { flatCount } = buildConsolidated();
  assert.strictEqual(flatCount, 269, `flat got ${flatCount}`);
});

console.log('== 3. Translate 429 handling (mocked fetch) ==');
let fetchCalls = [];
let fetchScript = [];
function setFetch(script) {
  fetchCalls = [];
  fetchScript = [...script];
  global.fetch = async () => {
    fetchCalls.push(Date.now());
    const next = fetchScript.shift();
    return next === 429 ? errRes(429) : next === 500 ? errRes(500) : okRes();
  };
}

checkAsync('translateText retries on 429 then succeeds (429, 429, 200)', async () => {
  setFetch([429, 429, 200]);
  const start = Date.now();
  const res = await translate.translateText('hola gracias amigo', 'en');
  const elapsed = Date.now() - start;
  assert.strictEqual(res.translated, 'Hello thanks');
  assert.strictEqual(fetchCalls.length, 3, `fetch called ${fetchCalls.length}x`);
  // Backoff is 1s then 2s, so the whole call takes >= ~3s.
  assert.ok(elapsed >= 2800, `expected >=2800ms backoff, took ${elapsed}ms`);
});
checkAsync('translateText gives up after 2 retries on persistent 429 (3 calls, status 429)', async () => {
  setFetch([429, 429, 429, 429]);
  let err = null;
  try { await translate.translateText('hola gracias amigo', 'en'); } catch (e) { err = e; }
  assert.ok(err, 'expected a throw');
  assert.strictEqual(err.status, 429, `status got ${err.status}`);
  assert.match(err.message, /429/);
  assert.strictEqual(fetchCalls.length, 3, `fetch called ${fetchCalls.length}x`);
});
checkAsync('non-429 failure does NOT retry (500 -> 1 call)', async () => {
  setFetch([500]);
  let err = null;
  try { await translate.translateText('hola gracias amigo', 'en'); } catch (e) { err = e; }
  assert.ok(err && /500/.test(err.message));
  assert.strictEqual(fetchCalls.length, 1, `fetch called ${fetchCalls.length}x`);
});
checkAsync('minimum interval: back-to-back calls are spaced ~1s apart', async () => {
  setFetch([200, 200]);
  await translate.translateText('hola gracias amigo', 'en');
  await translate.translateText('hola gracias amigo', 'en');
  assert.strictEqual(fetchCalls.length, 2);
  const gap = fetchCalls[1] - fetchCalls[0];
  assert.ok(gap >= 900, `gap was ${gap}ms, expected >=900ms`);
});

console.log('== 4. Per-guild cooldown + warn-level logging via handleTranslateMessage ==');
mockRows = [{ enabled: 1, channels_json: [CH], target_lang: 'en' }];
checkAsync('429 failure logs at warn and sets a 10-min per-guild cooldown', async () => {
  setFetch([429, 429, 429]);
  loggedEntries.length = 0;
  const guildA = 'guild-cooldown-a';
  const first = await translate.handleTranslateMessage(mockMsg(guildA, 'hola gracias amigo'));
  assert.strictEqual(first, false);
  assert.strictEqual(fetchCalls.length, 3, `first call fetched ${fetchCalls.length}x`);
  assert.strictEqual(loggedEntries.length, 1, `logged ${loggedEntries.length} entries`);
  assert.strictEqual(loggedEntries[0].level, 'warn', `level got ${loggedEntries[0].level}`);
  assert.match(loggedEntries[0].message, /429/);
  // Second message in the same guild: suppressed, no fetch, no log.
  const callsBefore = fetchCalls.length;
  const logsBefore = loggedEntries.length;
  const second = await translate.handleTranslateMessage(mockMsg(guildA, 'hola gracias amigo'));
  assert.strictEqual(second, false);
  assert.strictEqual(fetchCalls.length, callsBefore, 'cooldown did not suppress the fetch');
  assert.strictEqual(loggedEntries.length, logsBefore, 'cooldown did not suppress the log');
});
checkAsync('cooldown is per-guild: another guild still translates', async () => {
  setFetch([200]);
  loggedEntries.length = 0;
  let replied = null;
  const msg = mockMsg('guild-cooldown-b', 'hola gracias amigo');
  msg.reply = async (payload) => { replied = payload; };
  const ok = await translate.handleTranslateMessage(msg);
  assert.strictEqual(ok, true);
  assert.strictEqual(fetchCalls.length, 1);
  assert.ok(replied && replied.embeds && replied.embeds.length === 1, 'expected a reply embed');
  assert.strictEqual(loggedEntries.length, 0, 'success should not log');
});
checkAsync('non-429 failure still logs at error and sets NO cooldown', async () => {
  setFetch([500]);
  loggedEntries.length = 0;
  const guildC = 'guild-cooldown-c';
  const first = await translate.handleTranslateMessage(mockMsg(guildC, 'hola gracias amigo'));
  assert.strictEqual(first, false);
  assert.strictEqual(loggedEntries.length, 1);
  assert.strictEqual(loggedEntries[0].level, 'error', `level got ${loggedEntries[0].level}`);
  // Second message: no cooldown, so it fetches again.
  setFetch([200]);
  let replied = null;
  const msg = mockMsg(guildC, 'hola gracias amigo');
  msg.reply = async (payload) => { replied = payload; };
  const ok = await translate.handleTranslateMessage(msg);
  assert.strictEqual(ok, true, 'expected retry after a non-429 failure');
  assert.ok(replied);
});

Promise.all(pending).then(() => {
  console.log(`\n${total - failures}/${total} checks passed`);
  process.exit(failures ? 1 : 0);
});

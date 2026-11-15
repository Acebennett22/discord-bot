// Verification for 1.15.2: translate channels_json normalization + withResponse.
// Run: node tmp/verify-translate-fix.js   (exit 0 = all pass)
// config.js exits on placeholder credentials unless this is set first.
process.env.ALLOW_PLACEHOLDER_CONFIG = '1';
const assert = require('assert');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log(`  PASS ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
}

// --- Mock the database BEFORE requiring translate.js (it requires ./database,
// and errorLogger requires it too — the cache injection covers both). ---
let mockRows = [];
const dbPath = require.resolve('../src/utils/database');
require.cache[dbPath] = { exports: { isEnabled: () => true, query: async () => mockRows } };

const translate = require('../src/utils/translate');
const errorLogger = require('../src/utils/errorLogger');
const loggedErrors = [];
const origLog = errorLogger.log;
errorLogger.log = (entry) => { loggedErrors.push(entry); };

const CH = '123456789012345678';
const CH2 = '987654321098765432';

console.log('== 1. Reproduce the original crash (OLD reader logic) ==');
check('old path: bare-number channels_json throws on .includes', () => {
  const row = { channels_json: Number(CH) };
  let channels = [];
  try { channels = JSON.parse(row.channels_json || '[]'); } catch {}
  assert.throws(() => channels.includes(CH), /includes is not a function/);
});
check('old path: correct array silently becomes [] (silent failure)', () => {
  const row = { channels_json: [CH, CH2] };
  let channels = [];
  try { channels = JSON.parse(row.channels_json || '[]'); } catch {}
  assert.deepStrictEqual(channels, []);
  assert.strictEqual(channels.includes(CH), false);
});

console.log('== 2. normalizeChannels handles every shape ==');
const shapes = [
  ['already-parsed array', [CH, CH2], [CH, CH2]],
  ['array of numbers', [111, 222], ['111', '222']],
  ['JSON string of an array', `["${CH}","${CH2}"]`, [CH, CH2]],
  ['JSON string of a bare number', '12345', ['12345']],
  ['JSON string of a bare string', `"${CH}"`, [CH]],
  ['bare number', 12345, ['12345']],
  ['bare string ID (precision-safe, > 2^53)', CH, [CH]],
  ['comma-separated IDs', `${CH},${CH2}`, [CH, CH2]],
  ['object of IDs', { 0: CH, 1: CH2 }, [CH, CH2]],
  ['null', null, []],
  ['undefined', undefined, []],
  ['invalid JSON string (comma-split)', 'not json', ['not json']],
  ['empty string', '', []],
  ['JSON empty array string', '[]', []],
];
for (const [name, input, expected] of shapes) {
  check(`normalizeChannels: ${name}`, () => {
    const out = translate.normalizeChannels(input);
    assert.ok(Array.isArray(out), 'must be an array');
    assert.ok(out.every((v) => typeof v === 'string'), 'entries must be strings');
    assert.deepStrictEqual(out, expected);
  });
}

console.log('== 3. getTranslateSettings via mocked db ==');
async function runSettingsTests() {
  await checkAsync('array row -> channels array of strings', async () => {
    mockRows = [{ guild_id: '1', enabled: 1, channels_json: [CH, CH2], target_lang: 'es' }];
    const s = await translate.getTranslateSettings('1');
    assert.deepStrictEqual(s, { enabled: true, channels: [CH, CH2], target_lang: 'es' });
  });
  await checkAsync('bare-number row -> channels wrapped, no throw', async () => {
    mockRows = [{ guild_id: '1', enabled: 1, channels_json: 12345, target_lang: 'fr' }];
    const s = await translate.getTranslateSettings('1');
    assert.deepStrictEqual(s.channels, ['12345']);
    assert.strictEqual(s.channels.includes('12345'), true);
  });
  await checkAsync('JSON-string row -> channels parsed', async () => {
    mockRows = [{ guild_id: '1', enabled: 1, channels_json: `["${CH}"]`, target_lang: 'de' }];
    const s = await translate.getTranslateSettings('1');
    assert.deepStrictEqual(s.channels, [CH]);
  });
  await checkAsync('null channels_json -> []', async () => {
    mockRows = [{ guild_id: '1', enabled: 1, channels_json: null, target_lang: 'en' }];
    const s = await translate.getTranslateSettings('1');
    assert.deepStrictEqual(s.channels, []);
  });
}

console.log('== 4. handleTranslateMessage no longer throws for the bad row ==');
async function runHandleTests() {
  await checkAsync('bare-number row, message in channel: no throw, no error logged', async () => {
    mockRows = [{ guild_id: '1', enabled: 1, channels_json: 12345, target_lang: 'es' }];
    loggedErrors.length = 0;
    const msg = { guildId: '1', channelId: '12345', content: 'hi' }; // short text: returns after .includes
    const result = await translate.handleTranslateMessage(msg);
    assert.strictEqual(result, false); // false = no reply (text too short), not an error
    assert.strictEqual(loggedErrors.length, 0, `expected no errors logged, got ${JSON.stringify(loggedErrors)}`);
  });
  await checkAsync('bare-number row, message NOT in channel: returns false, no throw', async () => {
    mockRows = [{ guild_id: '1', enabled: 1, channels_json: 12345, target_lang: 'es' }];
    loggedErrors.length = 0;
    const msg = { guildId: '1', channelId: CH2, content: 'hello there friend' };
    const result = await translate.handleTranslateMessage(msg);
    assert.strictEqual(result, false);
    assert.strictEqual(loggedErrors.length, 0);
  });
  await checkAsync('array row, message in channel, short text: no throw', async () => {
    mockRows = [{ guild_id: '1', enabled: 1, channels_json: [CH], target_lang: 'es' }];
    loggedErrors.length = 0;
    const result = await translate.handleTranslateMessage({ guildId: '1', channelId: CH, content: 'yo' });
    assert.strictEqual(result, false);
    assert.strictEqual(loggedErrors.length, 0);
  });
}

console.log('== 5. saveTranslateSettings normalizes before writing ==');
async function runSaveTests() {
  await checkAsync('bare-number patch is written as a JSON array string', async () => {
    mockRows = [{ guild_id: '1', enabled: 1, channels_json: [CH], target_lang: 'en' }];
    let written = null;
    require.cache[dbPath].exports.query = async (sql, params) => {
      if (String(sql).includes('INSERT INTO translate_settings')) written = params[2];
      return mockRows;
    };
    await translate.saveTranslateSettings('1', { channels: 12345 });
    assert.strictEqual(written, JSON.stringify(['12345']));
    require.cache[dbPath].exports.query = async () => mockRows;
  });
}

console.log('== 6. withResponse sites obtain the sent message ==');
const ping = require('../src/commands/utility/ping');
const help = require('../src/commands/utility/help');
const trivia = require('../src/commands/fun/trivia');

function fakeCollector() { return { on() { return this; }, stop() {} }; }
function fakeMessage() { return { createdTimestamp: 1000042, createMessageComponentCollector: () => fakeCollector() }; }

async function runCommandTests() {
  await checkAsync('ping: round-trip computed from withResponse message', async () => {
    let replyOpts = null; let edited = null;
    const interaction = {
      createdTimestamp: 1000000,
      client: { shard: undefined, ws: { ping: 12 }, guilds: { cache: { size: 3 } } },
      reply: async (opts) => { replyOpts = opts; return { resource: { message: fakeMessage() } }; },
      editReply: async (opts) => { edited = opts; return {}; },
    };
    await ping.execute(interaction);
    assert.strictEqual(replyOpts.withResponse, true);
    assert.strictEqual(replyOpts.fetchReply, undefined);
    const text = JSON.stringify(edited);
    assert.ok(text.includes('42ms'), `expected 42ms round-trip in edit, got ${text}`);
  });
  await checkAsync('help: collector created on withResponse message', async () => {
    let replyOpts = null; let collectorMade = false;
    const msg = fakeMessage();
    msg.createMessageComponentCollector = () => { collectorMade = true; return fakeCollector(); };
    const interaction = {
      client: { commands: new Map([['ping', { data: { name: 'ping', description: 'x' } }]]) },
      reply: async (opts) => { replyOpts = opts; return { resource: { message: msg } }; },
      editReply: async () => ({}),
    };
    await help.execute(interaction);
    assert.strictEqual(replyOpts.withResponse, true);
    assert.strictEqual(replyOpts.fetchReply, undefined);
    assert.strictEqual(collectorMade, true);
  });
  await checkAsync('trivia: collector created on withResponse message', async () => {
    let replyOpts = null; let collectorMade = false;
    const msg = fakeMessage();
    msg.createMessageComponentCollector = () => { collectorMade = true; return fakeCollector(); };
    const interaction = {
      user: { tag: 'Tester#1' },
      reply: async (opts) => { replyOpts = opts; return { resource: { message: msg } }; },
      editReply: async () => ({}),
    };
    await trivia.execute(interaction);
    assert.strictEqual(replyOpts.withResponse, true);
    assert.strictEqual(replyOpts.fetchReply, undefined);
    assert.strictEqual(collectorMade, true);
  });
}

(async () => {
  await runSettingsTests();
  await runHandleTests();
  await runSaveTests();
  await runCommandTests();
  errorLogger.log = origLog;
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();

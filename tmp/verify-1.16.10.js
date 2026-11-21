// Verify 1.16.10: small audit fixes — disabled-command attempts are logged,
// the reaction-role INSERT failure is reported instead of claiming success,
// and poll.js loses its stale comment and stale example date.
// Exercises the REAL interactionCreate handler and the REAL
// reactionroles-add execute() with mocked DB/interaction. No live bot.
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

// --- Test harness (same shape as tmp/verify-1.16.9.js) ----------------------
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

// --- Source checks -----------------------------------------------------------
async function main() {
  const interactionSrc = src('src/events/interactionCreate.js');
  const addSrc = src('src/commands/reactionroles/reactionroles-add.js');
  const pollSrc = src('src/commands/utility/poll.js');

  await check('interactionCreate: disabled branch logs the attempt', () => {
    const start = interactionSrc.indexOf('if (!toggle.enabled)');
    assert.ok(start >= 0, 'disabled branch not found');
    const branch = interactionSrc.slice(start, interactionSrc.indexOf('let success = true;'));
    assert.ok(branch.includes('db.logCommand'), 'no db.logCommand in disabled branch');
    assert.ok(branch.includes('success: false'), 'disabled log is not success: false');
    assert.ok(branch.includes('Disabled ('), 'disabled log has no Disabled errorMessage');
    assert.ok(branch.includes('commandName: effectiveName'), 'disabled log does not use effectiveName');
  });

  await check('interactionCreate: disabled reply still sent before the log', () => {
    const start = interactionSrc.indexOf('if (!toggle.enabled)');
    const branch = interactionSrc.slice(start, interactionSrc.indexOf('let success = true;'));
    assert.ok(branch.indexOf("errorEmbed('Disabled'") < branch.indexOf('db.logCommand'),
      'reply must come before the log call');
  });

  await check('reactionroles-add: INSERT uses queryDetailed', () => {
    assert.ok(addSrc.includes('const { error } = await db.queryDetailed('),
      'INSERT does not use db.queryDetailed');
    // The SELECT for channel_id still uses plain query() — only the INSERT
    // must go through queryDetailed.
    assert.ok(!/await db\.query\(\s*'INSERT INTO reaction_roles/.test(addSrc),
      'INSERT still uses plain db.query');
  });

  await check('reactionroles-add: INSERT failure replies with an error', () => {
    assert.ok(addSrc.includes("if (error) return interaction.reply"), 'no error check after INSERT');
    assert.ok(addSrc.includes('Could not save pair'), 'no Could not save pair error reply');
    assert.ok(addSrc.indexOf('if (error)') < addSrc.indexOf('await msg.edit'),
      'error reply must come before the message edit');
  });

  await check('poll: stale example date and stale comment are gone', () => {
    assert.ok(!pollSrc.includes('2026-11-14'), 'stale 2026-11-14 example date still present');
    assert.ok(!pollSrc.includes('exception to ephemeral'), 'stale ephemeral comment still present');
    assert.ok(pollSrc.includes('2026-12-25 15:00'), 'new example date missing');
    assert.ok(pollSrc.includes('polls are public'), 'new public-poll comment missing');
  });

  await check('package.json is 1.16.10 and CHANGELOG has the entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.16.10');
    const changelog = src('CHANGELOG.md');
    assert.ok(changelog.includes('## [1.16.10]'), 'no 1.16.10 CHANGELOG entry');
  });

  // --- Functional: reactionroles-add, INSERT failure -------------------------
  await check('reactionroles-add execute(): failed INSERT replies Could not save pair', async () => {
    const dbPath = require.resolve('../src/utils/database');
    const fakeDb = {
      isEnabled: () => true,
      query: async () => [{ channel_id: 'c1' }],
      queryDetailed: async () => ({ rows: null, error: { sqlMessage: 'Duplicate entry', message: 'Duplicate entry' } }),
    };
    require.cache[dbPath] = { exports: fakeDb };
    // reactionRoles.js captures the db module at load time, so clear it
    // too — otherwise it keeps the fakeDb from the earlier test.
    delete require.cache[require.resolve('../src/utils/reactionRoles')];
    delete require.cache[require.resolve('../src/commands/reactionroles/reactionroles-add')];
    const add = require('../src/commands/reactionroles/reactionroles-add');
    let replied = null;
    const interaction = {
      guildId: 'g1',
      options: {
        getString: (n) => (n === 'message_id' ? 'm1' : '👍'),
        getRole: (n) => (n === 'role' ? { id: 'r1', name: 'Test' } : null),
        getInteger: () => null,
      },
      guild: { channels: { cache: new Map(), fetch: async () => null } },
      reply: async (arg) => { replied = arg; return arg; },
    };
    await add.execute(interaction);
    assert.ok(replied, 'no reply sent');
    const embed = replied.embeds[0];
    const text = JSON.stringify(embed);
    assert.ok(text.includes('Could not save pair'), 'error reply is not Could not save pair');
    assert.ok(text.includes('Duplicate entry'), 'DB error message not surfaced');
  });

  await check('reactionroles-add execute(): successful INSERT still replies Pair added', async () => {
    const dbPath = require.resolve('../src/utils/database');
    let edited = false;
    const fakeDb = {
      isEnabled: () => true,
      // The channel lookup returns the channel row; the pairs SELECT inside
      // buildRows returns no pairs, so no role resolution is needed.
      query: async (sql) => (String(sql).includes('SELECT channel_id') ? [{ channel_id: 'c1' }] : []),
      queryDetailed: async () => ({ rows: { affectedRows: 1 }, error: null }),
    };
    require.cache[dbPath] = { exports: fakeDb };
    // reactionRoles.js captures the db module at load time — clear it too,
    // so buildRows uses this test's fakeDb, not the earlier test's.
    delete require.cache[require.resolve('../src/utils/reactionRoles')];
    delete require.cache[require.resolve('../src/commands/reactionroles/reactionroles-add')];
    const add = require('../src/commands/reactionroles/reactionroles-add');
    let replied = null;
    const fakeMsg = { edit: async () => { edited = true; } };
    const interaction = {
      guildId: 'g1',
      options: {
        getString: (n) => (n === 'message_id' ? 'm1' : '👍'),
        getRole: (n) => (n === 'role' ? { id: 'r1', name: 'Test' } : null),
        getInteger: () => null,
      },
      guild: {
        roles: { cache: new Map() },
        channels: { cache: new Map([['c1', { messages: { fetch: async () => fakeMsg } }]]), fetch: async () => null },
      },
      reply: async (arg) => { replied = arg; return arg; },
    };
    await add.execute(interaction);
    assert.ok(edited, 'message components were not rebuilt on success');
    assert.ok(replied, 'no reply sent');
    assert.ok(JSON.stringify(replied.embeds[0]).includes('Pair added'), 'success reply is not Pair added');
  });

  // --- Functional: interactionCreate, disabled command -----------------------
  await check('interactionCreate execute(): disabled command is logged with success false', async () => {
    const dbPath = require.resolve('../src/utils/database');
    const togglesPath = require.resolve('../src/utils/featureToggles');
    const logCalls = [];
    require.cache[dbPath] = {
      exports: {
        isEnabled: () => true,
        logCommand: async (row) => { logCalls.push(row); },
        query: async () => null,
      },
    };
    require.cache[togglesPath] = {
      exports: { isCommandEnabled: async () => ({ enabled: false, reason: 'command' }) },
    };
    // resolveChild is only used for consolidated parents; the fake command
    // below is not a parent, so the real module loads fine.
    delete require.cache[require.resolve('../src/events/interactionCreate')];
    const handler = require('../src/events/interactionCreate');
    let replied = null;
    const interaction = {
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      commandName: 'testcmd',
      guildId: 'g1',
      channelId: 'c1',
      user: { id: 'u1', tag: 'User#1' },
      reply: async (arg) => { replied = arg; return arg; },
    };
    const client = { commands: new Map([['testcmd', { isParent: false, execute: async () => {} }]]) };
    await handler.execute(interaction, client);
    assert.ok(replied, 'no Disabled reply sent');
    assert.ok(JSON.stringify(replied.embeds[0]).includes('Disabled'), 'reply is not the Disabled embed');
    assert.strictEqual(logCalls.length, 1, `expected 1 logCommand call, got ${logCalls.length}`);
    assert.strictEqual(logCalls[0].success, false);
    assert.strictEqual(logCalls[0].commandName, 'testcmd');
    assert.ok(String(logCalls[0].errorMessage).includes('Disabled'), 'log errorMessage does not say Disabled');
  });

  console.log(`\n${passed} passed, ${failed} failed${failed ? ` (${failures.join(', ')})` : ''}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

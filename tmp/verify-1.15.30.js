// Verify 1.15.30 — snipe null-author crash + Unknown interaction crash.
// Reproduces BOTH crashes against the OLD logic, then proves the fixed
// code handles them. Run from the repo root:
//   ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.15.30.js
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}

// ---------------------------------------------------------------- snipe.js
console.log('== snipe null-author ==');
const snipe = require('../src/utils/snipe');
const snipeSrc = fs.readFileSync(path.join(__dirname, '../src/utils/snipe.js'), 'utf8');

// (0) Old logic reproduced: the pre-fix guard lets a null author through,
//     then dereferences message.author.id -> TypeError reading 'id'.
function oldRecordDelete(message) {
  if (!message?.guild || message.author?.bot) return;
  return message.author.id; // eslint-disable-line no-unused-expressions
}
function oldRecordEdit(oldMessage) {
  if (!oldMessage?.guild || oldMessage.author?.bot) return;
  return oldMessage.author.id; // eslint-disable-line no-unused-expressions
}
const partialMsg = {
  guild: { id: 'g1' },
  channelId: 'c1',
  author: null, // uncached delete: fetch() failed, message stays partial
  content: 'hello',
  attachments: [],
};
let oldThrewDelete = false;
try { oldRecordDelete(partialMsg); } catch (e) { oldThrewDelete = /reading 'id'/.test(e.message); }
check('OLD recordDelete throws TypeError reading id on null author', oldThrewDelete);
let oldThrewEdit = false;
try { oldRecordEdit(partialMsg); } catch (e) { oldThrewEdit = /reading 'id'/.test(e.message); }
check('OLD recordEdit throws TypeError reading id on null author', oldThrewEdit);

// (1) Fixed code: null author is skipped, no throw, nothing recorded.
let threw = false;
try { snipe.recordDelete(partialMsg); } catch { threw = true; }
check('FIXED recordDelete: null author does not throw', !threw);
check('FIXED recordDelete: null author records nothing', snipe.getDeleted('c1') === null);
threw = false;
try { snipe.recordEdit(partialMsg, { ...partialMsg, content: 'bye' }); } catch { threw = true; }
check('FIXED recordEdit: null author does not throw', !threw);
check('FIXED recordEdit: null author records nothing', snipe.getEdited('c1') === null);

// (2) Bot author still skipped.
const botMsg = {
  guild: { id: 'g1' }, channelId: 'c2',
  author: { id: 'b1', bot: true, tag: 'Bot#1', displayAvatarURL: () => 'u' },
  content: 'beep', attachments: [],
};
snipe.recordDelete(botMsg);
check('recordDelete: bot author skipped', snipe.getDeleted('c2') === null);
snipe.recordEdit(botMsg, { ...botMsg, content: 'boop' });
check('recordEdit: bot author skipped', snipe.getEdited('c2') === null);

// (3) DM (no guild) still skipped.
const dmMsg = {
  guild: null, channelId: 'c3',
  author: { id: 'u9', tag: 'User#9', displayAvatarURL: () => 'u' },
  content: 'dm', attachments: [],
};
snipe.recordDelete(dmMsg);
check('recordDelete: no-guild message skipped', snipe.getDeleted('c3') === null);

// (4) Normal author still recorded, with correct fields.
const user = { id: 'u1', tag: 'User#1', displayAvatarURL: () => 'https://cdn/x.png' };
const goodMsg = {
  guild: { id: 'g1' }, channelId: 'c4', author: user,
  content: 'sniped!', attachments: [{ url: 'https://cdn/a.png' }],
};
snipe.recordDelete(goodMsg);
const got = snipe.getDeleted('c4');
check('recordDelete: normal author recorded', got !== null);
check('recordDelete: authorId/authorTag/content kept', got && got.authorId === 'u1' && got.authorTag === 'User#1' && got.content === 'sniped!');
check('recordDelete: attachment url kept', got && got.attachments && got.attachments[0] === 'https://cdn/a.png');
snipe.recordEdit(goodMsg, { ...goodMsg, content: 'edited!' });
const gotE = snipe.getEdited('c4');
check('recordEdit: normal author recorded', gotE !== null && gotE.authorId === 'u1' && gotE.before === 'sniped!' && gotE.after === 'edited!');

// (5) Unchanged edit still ignored.
snipe.recordEdit(goodMsg, { ...goodMsg, content: 'sniped!' });
check('recordEdit: unchanged content not recorded', snipe.getEdited('c4') !== null && snipe.getEdited('c4').after === 'edited!');

// (6) Source guards present.
check('source: recordDelete guards !message.author', /if \(!message\?\.\guild \|\| !message\.author \|\| message\.author\.bot\) return;/.test(snipeSrc));
check('source: recordEdit guards !oldMessage.author', /if \(!oldMessage\?\.\guild \|\| !oldMessage\.author \|\| oldMessage\.author\.bot\) return;/.test(snipeSrc));

// ------------------------------------------------------- interactionCreate.js
console.log('== interactionCreate Unknown interaction ==');
const handlerSrc = fs.readFileSync(path.join(__dirname, '../src/events/interactionCreate.js'), 'utf8');
check('source: disabled reply is guarded with .catch', /await interaction\.reply\(\{ embeds: \[errorEmbed\('Disabled', why\)\] \}\)\.catch\(\(\) => \{\}\);/.test(handlerSrc));

// Stub the handler's DB/toggle/logger deps via the require cache BEFORE
// requiring the handler, so no real DB or config is touched.
const logCommandCalls = [];
const errorLogCalls = [];
let toggleResult = { enabled: false, reason: 'feature', feature: 'Test Feature' };
function stubModule(relPath, exportsObj) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
stubModule('../src/utils/database', { logCommand: async (args) => { logCommandCalls.push(args); } });
stubModule('../src/utils/featureToggles', { isCommandEnabled: async () => toggleResult });
stubModule('../src/utils/errorLogger', { log: async (args) => { errorLogCalls.push(args); } });

const handler = require('../src/events/interactionCreate');

function makeInteraction(replyImpl) {
  const calls = { reply: 0, followUp: 0, lastReply: null };
  return {
    calls,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    commandName: 'testcmd',
    guildId: 'g1',
    channelId: 'c1',
    user: { id: 'u1', tag: 'User#1' },
    options: { getSubcommandGroup: () => null, getSubcommand: () => null },
    replied: false,
    deferred: false,
    reply: async (payload) => { calls.reply++; calls.lastReply = payload; return replyImpl(payload); },
    followUp: async () => { calls.followUp++; },
  };
}
function makeClient(executeImpl) {
  return { commands: new Map([['testcmd', { isParent: false, execute: executeImpl }]]) };
}

(async () => {
  // (7) OLD behaviour reproduced: an unguarded reply that rejects with
  //     10062 propagates out of execute() as an uncaught exception.
  async function oldDisabledReply(interaction) {
    return interaction.reply({ embeds: [{ title: 'Disabled' }] }); // no .catch
  }
  const err10062 = new Error('Unknown interaction');
  err10062.code = 10062;
  const deadInteraction = makeInteraction(async () => { throw err10062; });
  let oldThrew = false;
  try { await oldDisabledReply(deadInteraction); } catch (e) { oldThrew = e.code === 10062; }
  check('OLD disabled reply throws 10062 out of the handler', oldThrew);

  // (8) FIXED: disabled path + reply rejecting 10062 -> handler resolves,
  //     reply attempted exactly once, no followUp, no error log.
  logCommandCalls.length = 0; errorLogCalls.length = 0;
  toggleResult = { enabled: false, reason: 'feature', feature: 'Test Feature' };
  const dead2 = makeInteraction(async () => { throw err10062; });
  threw = false;
  try { await handler.execute(dead2, makeClient(async () => {})); } catch { threw = true; }
  check('FIXED disabled path: 10062 reply does not throw', !threw);
  check('FIXED disabled path: reply attempted once', dead2.calls.reply === 1);
  check('FIXED disabled path: no followUp attempted', dead2.calls.followUp === 0);
  check('FIXED disabled path: no error logged for the dead reply', errorLogCalls.length === 0);

  // (9) Disabled path + healthy reply -> resolves, Disabled embed sent.
  const ok = makeInteraction(async () => {});
  threw = false;
  try { await handler.execute(ok, makeClient(async () => {})); } catch { threw = true; }
  check('disabled path: healthy reply resolves', !threw);
  check('disabled path: reply called once with Disabled embed', ok.calls.reply === 1
    && JSON.stringify(ok.calls.lastReply).includes('Disabled'));

  // (10) Enabled path still works end to end: command runs, outcome logged.
  logCommandCalls.length = 0; errorLogCalls.length = 0;
  toggleResult = { enabled: true };
  let ran = false;
  const enabledInteraction = makeInteraction(async () => {});
  await handler.execute(enabledInteraction, makeClient(async () => { ran = true; }));
  check('enabled path: command executes', ran === true);
  check('enabled path: outcome logged (success)', logCommandCalls.length === 1
    && logCommandCalls[0].success === true && logCommandCalls[0].commandName === 'testcmd');

  // (11) Enabled path + command throws -> error reply via followUp/reply,
  //      outcome logged as failure, handler still resolves.
  logCommandCalls.length = 0; errorLogCalls.length = 0;
  const failing = makeInteraction(async () => {});
  threw = false;
  try {
    await handler.execute(failing, makeClient(async () => { throw new Error('boom'); }));
  } catch { threw = true; }
  check('enabled path: throwing command does not escape handler', !threw);
  check('enabled path: error logged to errorLogger', errorLogCalls.length === 1);
  check('enabled path: failure outcome logged', logCommandCalls.length === 1 && logCommandCalls[0].success === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Harness error:', e); process.exit(1); });

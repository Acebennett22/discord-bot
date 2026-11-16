// Verify 1.16.2: the bot's public reply to a mod or setup command deletes
// itself after 60 seconds, while log posts, ghost ping callouts, ephemeral
// replies, and replies with live components are never touched.
//
// BACKGROUND: the owner asked for channels to stay clean — a mod/setup
// command's confirmation reply fades after a minute, because the permanent
// record lives in the log channels / DB. Implementation is central: the
// consolidated-command router (src/handlers/consolidate.js) arms a wrapper
// on interaction.reply/deferReply/editReply ONLY for in-scope commands
// (src/utils/replyAutoDelete.js); no command file changed, and log posts
// (channel.send) never pass through the wrapper at all.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.16.2.js
'use strict';

process.env.ALLOW_PLACEHOLDER_CONFIG = '1';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { MessageFlags } = require('discord.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log(`  PASS ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}`); }
};

// --- Fake timers: capture setTimeout calls instead of waiting 60s ---------
const realSetTimeout = global.setTimeout;
const timers = [];
global.setTimeout = (fn, ms, ...rest) => {
  const t = { fn, ms, unrefCalled: false, unref() { this.unrefCalled = true; } };
  timers.push(t);
  return t;
};
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

// --- Real router + helper ---------------------------------------------------
const { buildConsolidated } = require('../src/handlers/consolidate');
const autoDelete = require('../src/utils/replyAutoDelete');
const { topLevel } = buildConsolidated();
const parentByName = (name) => topLevel.find((c) => c.isParent && c.data.name === name);

// --- Fakes ------------------------------------------------------------------
function makeMessage({ components = [] } = {}) {
  const msg = {
    components,
    deleted: false,
    fetchCalls: 0,
    fetchThrows: false,
    async fetch() {
      this.fetchCalls += 1;
      if (this.fetchThrows) throw new Error('Unknown Message');
      return this;
    },
    async delete() { this.deleted = true; },
  };
  return msg;
}

// A stub child module whose execute() just replies the way the test wants.
// flatName is the child's REAL flat name — scope is decided off it, so the
// stub must carry the real name or the test would exercise the wrong rule.
function stubChild(replyBehavior, flatName = 'stub') {
  return {
    module: {
      async execute(interaction) {
        return replyBehavior(interaction);
      },
    },
    flatName,
    perms: null,
  };
}

function makeInteraction({ group = null, sub = 'stub', replyMessage = null, replyBehavior = null } = {}) {
  const message = replyMessage || makeMessage();
  const calls = { reply: [], defer: [], edit: [], followUp: [] };
  const ix = {
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => sub,
    },
    memberPermissions: { has: () => true },
    user: { id: 'u1', tag: 'Tester#0001' },
    guildId: 'g1',
    channelId: 'c1',
    calls,
    __message: message,
    async reply(...args) {
      calls.reply.push(args[0]);
      if (replyBehavior) return replyBehavior(ix, ...args);
      return message;
    },
    async deferReply(...args) { calls.defer.push(args[0]); },
    async editReply(...args) {
      calls.edit.push(args[0]);
      return message;
    },
    async followUp(...args) {
      calls.followUp.push(args[0]);
      return makeMessage();
    },
  };
  return ix;
}

async function runCase(name, fn) {
  timers.length = 0;
  try { await fn(); } catch (err) { check(`${name} (threw: ${err.message})`, false); }
}

(async () => {
  console.log('--- 1.16.2 reply auto-delete ---');

  // --- Unit: scope decisions ------------------------------------------------
  const fakeIx = (sub) => ({ options: { getSubcommand: () => sub } });
  check('scope: /mod ban is in scope (parent rule)', autoDelete.shouldAutoDeleteReply('mod', { flatName: 'ban' }, fakeIx('ban')));
  check('scope: /mod snipe is in scope (parent rule covers info commands too)', autoDelete.shouldAutoDeleteReply('mod', { flatName: 'snipe' }, fakeIx('snipe')));
  check('scope: /mod logging status is in scope (parent rule)', autoDelete.shouldAutoDeleteReply('mod', { flatName: 'logging' }, fakeIx('status')));
  check('scope: /ticket setup is in scope (flat *-setup)', autoDelete.shouldAutoDeleteReply('ticket', { flatName: 'ticket-setup' }, fakeIx('setup')));
  check('scope: /birthday setup is in scope (flat *-setup)', autoDelete.shouldAutoDeleteReply('birthday', { flatName: 'birthday-setup' }, fakeIx('setup')));
  check('scope: /utility setup is in scope (subcommand named setup)', autoDelete.shouldAutoDeleteReply('utility', { flatName: 'setup' }, fakeIx('setup')));
  check('scope: /fun trivia-daily setup is in scope (subcommand named setup)', autoDelete.shouldAutoDeleteReply('fun', { flatName: 'trivia-daily' }, fakeIx('setup')));
  check('scope: /economy balance is out of scope', !autoDelete.shouldAutoDeleteReply('economy', { flatName: 'balance' }, fakeIx('balance')));
  check('scope: /music play is out of scope', !autoDelete.shouldAutoDeleteReply('music', { flatName: 'play' }, fakeIx('play')));
  check('scope: /fun trivia-daily (no setup subcommand) is out of scope', !autoDelete.shouldAutoDeleteReply('fun', { flatName: 'trivia-daily' }, fakeIx('daily')));
  check('scope: missing interaction does not throw', autoDelete.shouldAutoDeleteReply('mod', { flatName: 'ban' }, null) === true);

  // --- Unit: ephemeral detection ---------------------------------------------
  check('ephemeral: flags: MessageFlags.Ephemeral detected', autoDelete.isEphemeralOptions({ flags: MessageFlags.Ephemeral }));
  check('ephemeral: ephemeral: true detected', autoDelete.isEphemeralOptions({ ephemeral: true }));
  check('ephemeral: plain options not ephemeral', !autoDelete.isEphemeralOptions({ embeds: [] }));
  check('ephemeral: string content not ephemeral', !autoDelete.isEphemeralOptions('hello'));
  check('ephemeral: undefined not ephemeral', !autoDelete.isEphemeralOptions(undefined));

  // --- Router: /mod ban reply is scheduled -----------------------------------
  await runCase('router /mod ban', async () => {
    const mod = parentByName('mod');
    const msg = makeMessage();
    mod.children.set('ban', stubChild(async (ix) => ix.reply({ embeds: [{ title: 'Member banned' }] }), 'ban'));
    const ix = makeInteraction({ sub: 'ban', replyMessage: msg });
    await mod.execute(ix);
    check('router /mod ban: one 60s timer scheduled', timers.length === 1 && timers[0].ms === 60_000);
    check('router /mod ban: timer is unref’d (won’t keep process alive)', timers[0].unrefCalled === true);
    check('router /mod ban: reply asked for fetchReply', ix.calls.reply.length === 1 && ix.calls.reply[0].fetchReply === true);
    check('router /mod ban: original reply content preserved', ix.calls.reply[0].embeds[0].title === 'Member banned');
    timers[0].fn();
    await flush();
    check('router /mod ban: message deleted when the timer fires', msg.deleted === true);
  });

  // --- Router: setup command reply is scheduled -------------------------------
  await runCase('router /ticket setup', async () => {
    const ticket = parentByName('ticket');
    const msg = makeMessage();
    ticket.children.set('setup', stubChild(async (ix) => ix.reply({ embeds: [{ title: 'Ticket setup done' }] }), 'ticket-setup'));
    const ix = makeInteraction({ sub: 'setup', replyMessage: msg });
    await ticket.execute(ix);
    check('router /ticket setup: one 60s timer scheduled', timers.length === 1 && timers[0].ms === 60_000);
    timers[0].fn();
    await flush();
    check('router /ticket setup: message deleted when the timer fires', msg.deleted === true);
  });

  // --- Router: /utility setup via the subcommand rule --------------------------
  await runCase('router /utility setup', async () => {
    const utility = parentByName('utility');
    const msg = makeMessage();
    utility.children.set('setup', stubChild(async (ix) => ix.reply({ content: 'Setup saved.' }), 'setup'));
    const ix = makeInteraction({ sub: 'setup', replyMessage: msg });
    await utility.execute(ix);
    check('router /utility setup: timer scheduled via subcommand rule', timers.length === 1);
  });

  // --- Router: out-of-scope command is untouched --------------------------------
  await runCase('router /economy balance', async () => {
    const economy = parentByName('economy');
    const msg = makeMessage();
    economy.children.set('balance', stubChild(async (ix) => ix.reply({ embeds: [{ title: 'Balance' }] }), 'balance'));
    const ix = makeInteraction({ sub: 'balance', replyMessage: msg });
    await economy.execute(ix);
    check('router /economy balance: no timer scheduled', timers.length === 0);
    check('router /economy balance: reply passed through WITHOUT fetchReply', ix.calls.reply.length === 1 && ix.calls.reply[0].fetchReply === undefined);
    check('router /economy balance: message NOT deleted', msg.deleted === false);
  });

  // --- Router: ephemeral reply (e.g. /mod report) is left alone -----------------
  await runCase('router /mod report ephemeral', async () => {
    const mod = parentByName('mod');
    const msg = makeMessage();
    mod.children.set('report', stubChild(async (ix) => ix.reply({ embeds: [{ title: 'Report filed' }], flags: MessageFlags.Ephemeral }), 'report'));
    const ix = makeInteraction({ sub: 'report', replyMessage: msg });
    await mod.execute(ix);
    check('router /mod report: ephemeral reply not scheduled', timers.length === 0);
    check('router /mod report: ephemeral reply passed through unchanged', ix.calls.reply[0].fetchReply === undefined && ix.calls.reply[0].flags === MessageFlags.Ephemeral);
  });

  // --- Router: reply with components is never scheduled --------------------------
  await runCase('router /tools rules-setup with buttons', async () => {
    const tools = parentByName('tools');
    const msg = makeMessage({ components: [{ type: 1, components: [{ type: 2 }] }] });
    tools.children.set('rules-setup', stubChild(async (ix) => ix.reply({ embeds: [{ title: 'Rules' }], components: msg.components }), 'rules-setup'));
    const ix = makeInteraction({ sub: 'rules-setup', replyMessage: msg });
    await tools.execute(ix);
    check('router rules-setup: reply with buttons not scheduled', timers.length === 0);
  });

  // --- Router: components added by a later edit also protect the reply ------------
  await runCase('components added before the timer fires', async () => {
    const mod = parentByName('mod');
    const msg = makeMessage();
    mod.children.set('ban', stubChild(async (ix) => ix.reply({ embeds: [{ title: 'Member banned' }] }), 'ban'));
    const ix = makeInteraction({ sub: 'ban', replyMessage: msg });
    await mod.execute(ix);
    check('components-later: timer scheduled on the plain reply', timers.length === 1);
    msg.components = [{ type: 1, components: [{ type: 2 }] }]; // command edited buttons on
    timers[0].fn();
    await flush();
    check('components-later: message NOT deleted once it has buttons', msg.deleted === false);
  });

  // --- Router: deferReply + editReply path (serverstats-setup) ---------------------
  await runCase('router defer+edit', async () => {
    const utility = parentByName('utility');
    const msg = makeMessage();
    utility.children.set('serverstats-setup', stubChild(async (ix) => {
      await ix.deferReply();
      return ix.editReply({ embeds: [{ title: 'Server Stats enabled' }] });
    }, 'serverstats-setup'));
    const ix = makeInteraction({ sub: 'serverstats-setup', replyMessage: msg });
    await utility.execute(ix);
    check('router defer+edit: one timer scheduled on the edit', timers.length === 1 && timers[0].ms === 60_000);
    timers[0].fn();
    await flush();
    check('router defer+edit: edited reply deleted when the timer fires', msg.deleted === true);
  });

  // --- Router: ephemeral defer is left alone ---------------------------------------
  await runCase('router ephemeral defer', async () => {
    const utility = parentByName('utility');
    const msg = makeMessage();
    utility.children.set('serverstats-setup', stubChild(async (ix) => {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      return ix.editReply({ embeds: [{ title: 'Stats' }] });
    }, 'serverstats-setup'));
    const ix = makeInteraction({ sub: 'serverstats-setup', replyMessage: msg });
    await utility.execute(ix);
    check('router ephemeral defer: edit not scheduled', timers.length === 0);
  });

  // --- Router: followUp is never scheduled -------------------------------------------
  await runCase('router followUp untouched', async () => {
    const mod = parentByName('mod');
    const msg = makeMessage();
    const followMsg = makeMessage();
    mod.children.set('ban', stubChild(async (ix) => {
      await ix.reply({ embeds: [{ title: 'Member banned' }] });
      await ix.followUp({ embeds: [{ title: 'Extra data' }] });
      return null;
    }, 'ban'));
    const ix = makeInteraction({ sub: 'ban', replyMessage: msg });
    // Make followUp return the tracked message.
    ix.followUp = async (...args) => { ix.calls.followUp.push(args[0]); return followMsg; };
    await mod.execute(ix);
    check('router followUp: only the main reply scheduled (one timer)', timers.length === 1);
    timers[0].fn();
    await flush();
    check('router followUp: main reply deleted', msg.deleted === true);
    check('router followUp: follow-up message NOT deleted', followMsg.deleted === false);
  });

  // --- Router: already-deleted message at fire time never throws ----------------------
  await runCase('message already gone', async () => {
    const mod = parentByName('mod');
    const msg = makeMessage();
    msg.fetchThrows = true;
    mod.children.set('ban', stubChild(async (ix) => ix.reply({ embeds: [{ title: 'Member banned' }] }), 'ban'));
    const ix = makeInteraction({ sub: 'ban', replyMessage: msg });
    await mod.execute(ix);
    let threw = false;
    try { timers[0].fn(); await flush(); } catch { threw = true; }
    check('message already gone: timer callback does not throw', threw === false);
    check('message already gone: nothing deleted', msg.deleted === false);
  });

  // --- Router: "Missing permissions" error reply for an in-scope command fades ---------
  await runCase('router permission error', async () => {
    const mod = parentByName('mod');
    const msg = makeMessage();
    mod.children.set('ban', { module: { async execute() { throw new Error('should not run'); } }, flatName: 'ban', perms: 4n });
    const ix = makeInteraction({ sub: 'ban', replyMessage: msg });
    ix.memberPermissions = { has: () => false };
    await mod.execute(ix);
    check('router permission error: error reply scheduled for deletion', timers.length === 1 && timers[0].ms === 60_000);
    check('router permission error: child never ran', ix.calls.reply[0].embeds[0].data?.title === '❌ Missing permissions');
  });

  // --- Never touched: logs and ghost pings ---------------------------------------------
  const consolidateSrc = read('src/handlers/consolidate.js');
  const usages = (fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }) || [])
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('src', f))
    .filter((f) => read(f).includes('replyAutoDelete'));
  check('never touched: only consolidate.js wires the auto-delete helper', usages.length === 1 && usages[0] === path.join('src', 'handlers', 'consolidate.js'));
  check('never touched: memberLog.js does not use the helper (log posts are channel.send)', !read('src/utils/memberLog.js').includes('replyAutoDelete'));
  check('never touched: messageLog.js does not use the helper (modlog posts are channel.send)', !read('src/events/messageLog.js').includes('replyAutoDelete'));
  check('never touched: ghostPing.js does not use the helper (callouts are channel.send)', !read('src/events/ghostPing.js').includes('replyAutoDelete'));
  check('never touched: interactionCreate mod-log post is channel.send, not a reply', read('src/events/interactionCreate.js').includes('channel.send({') && !read('src/events/interactionCreate.js').includes('replyAutoDelete'));
  check('never touched: automod log posts do not use the helper', !read('src/utils/automod.js').includes('replyAutoDelete'));

  // --- Scope completeness: every /mod child and every *-setup is covered ----------------
  const modNames = [...parentByName('mod').children.values()].map((c) => c.flatName);
  check('scope completeness: all 23 /mod children resolve in-scope', modNames.length === 23 && modNames.every((n) => autoDelete.shouldAutoDeleteReply('mod', { flatName: n }, fakeIx(n))));
  const setupNames = [];
  for (const p of topLevel.filter((c) => c.isParent)) {
    for (const child of p.children.values()) {
      if (child.flatName.endsWith('-setup')) setupNames.push(child.flatName);
    }
  }
  check('scope completeness: all 29 *-setup flat commands resolve in-scope', setupNames.length === 29 && setupNames.every((n) => autoDelete.shouldAutoDeleteReply('other', { flatName: n }, fakeIx('setup'))));
  check('scope completeness: utility/setup.js (flat name exactly \'setup\') resolves via the subcommand rule', autoDelete.shouldAutoDeleteReply('utility', { flatName: 'setup' }, fakeIx('setup')));

  global.setTimeout = realSetTimeout;
  console.log(`\n1.16.2 verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  global.setTimeout = realSetTimeout;
  console.error(err);
  process.exit(1);
});

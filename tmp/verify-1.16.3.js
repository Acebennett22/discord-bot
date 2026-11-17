// Verify 1.16.3: every reply to a ticket command is ephemeral (only the
// invoking user can see it), while the ticket panel embed, messages posted
// into ticket channels, log posts, and ghost ping callouts stay public.
//
// BACKGROUND: the owner asked for all ticket commands to be ephemeral.
// Implementation is central: the consolidated-command router
// (src/handlers/consolidate.js) arms a wrapper on interaction.reply /
// deferReply / editReply / followUp ONLY for children of the /ticket
// parent (new helper src/utils/replyEphemeral.js), so no ticket command
// file changed. The ticket panel button handler
// (src/events/ticketInteraction.js) marks the clicker's confirmations
// and error replies ephemeral directly — the claim / add-user / reopen
// button replies stay public because they ARE the in-channel notice
// (no separate channel.send exists for them), and the panel message
// itself plus open/close notices go through channel.send, never the
// wrapper. Replies carrying buttons/select menus CAN be ephemeral — the
// wrapper does not skip them.
//
// Run: ALLOW_PLACEHOLDER_CONFIG=1 node tmp/verify-1.16.3.js
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

// --- Fake timers: capture setTimeout calls (auto-delete interplay) --------
const timers = [];
global.setTimeout = (fn, ms, ...rest) => {
  const t = { fn, ms, unrefCalled: false, unref() { this.unrefCalled = true; } };
  timers.push(t);
  return t;
};
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

// --- Real router + helper ---------------------------------------------------
const { buildConsolidated } = require('../src/handlers/consolidate');
const ephemeral = require('../src/utils/replyEphemeral');
const { topLevel } = buildConsolidated();
const parentByName = (name) => topLevel.find((c) => c.isParent && c.data.name === name);
const ticketParent = parentByName('ticket');

// --- Fakes ------------------------------------------------------------------
function makeMessage({ components = [] } = {}) {
  const msg = {
    components,
    deleted: false,
    async fetch() { return this; },
    async delete() { this.deleted = true; },
  };
  return msg;
}

function makeInteraction({
  group = null, sub = 'stub',
  channels = {}, strings = {}, integers = {}, roles = {}, users = {},
  channelTextBased = true, permsHas = true,
} = {}) {
  const calls = { reply: [], defer: [], edit: [], followUp: [] };
  const channelSends = [];
  const channel = {
    id: 'c1',
    isTextBased: () => channelTextBased,
    async send(opts) { channelSends.push(opts); return { id: 'm1' }; },
  };
  const ix = {
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => sub,
      getChannel: (name) => (name in channels ? channels[name] : null),
      getString: (name) => (name in strings ? strings[name] : null),
      getInteger: (name) => (name in integers ? integers[name] : null),
      getRole: (name) => (name in roles ? roles[name] : null),
      getUser: (name) => (name in users ? users[name] : null),
    },
    memberPermissions: { has: () => permsHas },
    member: { id: 'u1' },
    user: { id: 'u1', tag: 'Tester#0001' },
    guildId: 'g1',
    guild: { id: 'g1' },
    channelId: 'c1',
    channel,
    calls,
    channelSends,
    async reply(...args) { calls.reply.push(args[0]); return makeMessage(); },
    async deferReply(...args) { calls.defer.push(args[0]); },
    async editReply(...args) { calls.edit.push(args[0]); return makeMessage(); },
    async followUp(...args) { calls.followUp.push(args[0]); return makeMessage(); },
  };
  return ix;
}

function isEph(options) {
  if (!options || typeof options !== 'object') return false;
  if (options.ephemeral === true) return true;
  const flags = options.flags;
  if (typeof flags === 'number') return (flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
  if (Array.isArray(flags)) return flags.includes(MessageFlags.Ephemeral);
  return false;
}
const hasNoEph = (options) => !options || (typeof options === 'object' && !isEph(options) && options.ephemeral !== true && options.flags === undefined);

async function runCase(name, fn) {
  timers.length = 0;
  try { await fn(); } catch (err) { check(`${name} (threw: ${err.message})`, false); }
  await flush();
}

(async () => {
  console.log('--- 1.16.3 ticket replies ephemeral ---');

  // --- Unit: scope decisions ------------------------------------------------
  const fakeIx = (sub) => ({ options: { getSubcommand: () => sub } });
  for (const flat of ['ticket-setup', 'ticket-panel', 'ticket-add', 'ticket-remove', 'ticket-claim', 'ticket-close', 'ticket-ratings']) {
    check(`scope: /ticket ${flat} is in scope`, ephemeral.shouldForceEphemeral('ticket', { flatName: flat }, fakeIx('x')));
  }
  check('scope: /mod ban is out of scope', !ephemeral.shouldForceEphemeral('mod', { flatName: 'ban' }, fakeIx('ban')));
  check('scope: /economy balance is out of scope', !ephemeral.shouldForceEphemeral('economy', { flatName: 'balance' }, fakeIx('balance')));
  check('scope: /utility setup is out of scope (ticket settings live there, but it is a setup command)', !ephemeral.shouldForceEphemeral('utility', { flatName: 'setup' }, fakeIx('setup')));
  check('scope: /music play is out of scope', !ephemeral.shouldForceEphemeral('music', { flatName: 'play' }, fakeIx('play')));

  // --- Unit: flag merging ----------------------------------------------------
  check('flag: undefined -> { flags: Ephemeral }', isEph(ephemeral.withEphemeralFlag(undefined)));
  check('flag: string content -> object with flag', (() => { const o = ephemeral.withEphemeralFlag('hi'); return o.content === 'hi' && isEph(o); })());
  check('flag: plain object gains flag', isEph(ephemeral.withEphemeralFlag({ embeds: [] })));
  check('flag: numeric flags are OR-ed, other bits kept', (() => { const o = ephemeral.withEphemeralFlag({ flags: MessageFlags.SuppressEmbeds }); return isEph(o) && (o.flags & MessageFlags.SuppressEmbeds) === MessageFlags.SuppressEmbeds; })());
  check('flag: array flags gain Ephemeral', (() => { const o = ephemeral.withEphemeralFlag({ flags: [MessageFlags.SuppressEmbeds] }); return isEph(o) && o.flags.includes(MessageFlags.SuppressEmbeds); })());
  check('flag: already-ephemeral object passes through unchanged', (() => { const o = { flags: MessageFlags.Ephemeral, embeds: [] }; return ephemeral.withEphemeralFlag(o) === o; })());
  check('flag: ephemeral: true passes through unchanged', (() => { const o = { ephemeral: true }; return ephemeral.withEphemeralFlag(o) === o; })());

  // --- Real router: every ticket child replies ephemeral ----------------------
  // /ticket setup with a non-text channel -> "Invalid channel" reply.
  await runCase('setup invalid channel', async () => {
    const ix = makeInteraction({ sub: 'setup', channels: { channel: { isTextBased: () => false } } });
    await ticketParent.execute(ix);
    check('setup invalid-channel reply is ephemeral', ix.calls.reply.length === 1 && isEph(ix.calls.reply[0]));
    check('setup invalid-channel posts nothing to the channel', ix.channelSends.length === 0);
  });

  // /ticket setup with a valid channel -> panel posted via channel.send
  // (NOT ephemeral) + ephemeral confirmation reply, and NO auto-delete
  // timer (the 1.16.2 wrapper must see the flag and stand down).
  await runCase('setup valid channel', async () => {
    const sends = [];
    const fakeChannel = { id: 'c9', isTextBased: () => true, async send(opts) { sends.push(opts); return { id: 'm9' }; } };
    const ix = makeInteraction({ sub: 'setup', channels: { channel: fakeChannel } });
    await ticketParent.execute(ix);
    check('setup panel goes out via channel.send (one post)', sends.length === 1);
    check('setup panel post is NOT ephemeral', sends.length === 1 && hasNoEph(sends[0]));
    check('setup panel post carries the button row', sends.length === 1 && Array.isArray(sends[0].components) && sends[0].components.length === 1);
    check('setup confirmation reply is ephemeral', ix.calls.reply.length === 1 && isEph(ix.calls.reply[0]));
    check('setup schedules NO auto-delete timer (ephemeral + auto-delete interplay)', timers.length === 0);
  });

  // /ticket panel list -> "No extra panels yet" reply (DB disabled).
  await runCase('panel list', async () => {
    const ix = makeInteraction({ group: 'panel', sub: 'list' });
    await ticketParent.execute(ix);
    check('panel list reply is ephemeral', ix.calls.reply.length === 1 && isEph(ix.calls.reply[0]));
  });

  // /ticket panel delete -> "Not found" reply (DB disabled).
  await runCase('panel delete', async () => {
    const ix = makeInteraction({ group: 'panel', sub: 'delete', integers: { id: 99 } });
    await ticketParent.execute(ix);
    check('panel delete reply is ephemeral', ix.calls.reply.length === 1 && isEph(ix.calls.reply[0]));
  });

  // /ticket panel create -> "Database unavailable" reply (DB disabled).
  await runCase('panel create', async () => {
    const ix = makeInteraction({ group: 'panel', sub: 'create', strings: { title: 'Test', description: null } });
    await ticketParent.execute(ix);
    check('panel create reply is ephemeral', ix.calls.reply.length === 1 && isEph(ix.calls.reply[0]));
    check('panel create posts nothing (DB unavailable, before channel.send)', ix.channelSends.length === 0);
  });

  // /ticket add / claim / close / remove -> "Not a ticket" reply (DB disabled).
  for (const sub of ['add', 'claim', 'close', 'remove']) {
    await runCase(`ticket ${sub}`, async () => {
      const ix = makeInteraction({ sub });
      await ticketParent.execute(ix);
      check(`${sub} reply is ephemeral`, ix.calls.reply.length === 1 && isEph(ix.calls.reply[0]));
    });
  }

  // /ticket ratings -> "Database unavailable" reply (DB disabled).
  await runCase('ratings', async () => {
    const ix = makeInteraction({ sub: 'ratings' });
    await ticketParent.execute(ix);
    check('ratings reply is ephemeral', ix.calls.reply.length === 1 && isEph(ix.calls.reply[0]));
  });

  // Router's own "Missing permissions" reply for /ticket is ephemeral too.
  await runCase('permission error', async () => {
    const ix = makeInteraction({ sub: 'setup', permsHas: false, channels: { channel: { isTextBased: () => false } } });
    await ticketParent.execute(ix);
    check('missing-permissions reply is ephemeral', ix.calls.reply.length === 1 && isEph(ix.calls.reply[0]));
    check('missing-permissions reply schedules no auto-delete timer', timers.length === 0);
  });

  // --- deferReply / editReply / followUp carry the flag -----------------------
  // The wrapper stays armed on the interaction object, so calling the
  // methods after a real ticket command exercises the same code path.
  await runCase('defer/edit/followUp', async () => {
    const ix = makeInteraction({ sub: 'add' });
    await ticketParent.execute(ix);
    await ix.deferReply();
    await ix.editReply({ embeds: [] });
    await ix.followUp({ content: 'extra' });
    await ix.followUp('plain string follow-up');
    check('deferReply() with no args gains the flag', ix.calls.defer.length === 1 && isEph(ix.calls.defer[0]));
    check('editReply gains the flag', ix.calls.edit.length === 1 && isEph(ix.calls.edit[0]));
    check('followUp object gains the flag', ix.calls.followUp.length === 2 && isEph(ix.calls.followUp[0]));
    check('followUp string gains the flag', isEph(ix.calls.followUp[1]));
  });

  // --- Non-ticket command untouched (stub child, 1.16.2 pattern) -------------
  await runCase('non-ticket untouched', async () => {
    const economy = parentByName('economy');
    const real = economy.children.get('balance');
    economy.children.set('balance', {
      module: { async execute(interaction) { return interaction.reply({ content: 'balance: 0' }); } },
      flatName: 'balance',
      perms: null,
    });
    try {
      const ix = makeInteraction({ sub: 'balance' });
      // The stub's parent is /economy: route via the economy parent.
      const econParent = parentByName('economy');
      await econParent.execute(ix);
      check('non-ticket reply has NO Ephemeral flag', ix.calls.reply.length === 1 && !isEph(ix.calls.reply[0]));
      check('non-ticket reply has NO fetchReply injected', ix.calls.reply.length === 1 && ix.calls.reply[0].fetchReply !== true);
      check('non-ticket reply schedules no timer', timers.length === 0);
    } finally {
      economy.children.set('balance', real);
    }
  });

  // --- Source checks: button handler + channel posts -------------------------
  const ti = read('src/events/ticketInteraction.js');
  check('button: create-modal deferReply is ephemeral', /ticket_create_modal[\s\S]{0,400}?deferReply\(\{\s*flags: MessageFlags\.Ephemeral \}\)/.test(ti));
  check('button: close-modal deferReply is ephemeral', /ticket_close_modal[\s\S]{0,400}?deferReply\(\{\s*flags: MessageFlags\.Ephemeral \}\)/.test(ti));
  check('button: "Not a ticket" error reply is ephemeral', ti.includes("errorEmbed('Not a ticket', 'This channel is not a ticket.')], flags: MessageFlags.Ephemeral"));
  check('button: "No permission" error replies are ephemeral', (ti.match(/errorEmbed\('No permission'[^)]*\)\], flags: MessageFlags\.Ephemeral/g) || []).length === 2);
  check('button: "User not found" error reply is ephemeral', /errorEmbed\('User not found'[^)]*\)\], flags: MessageFlags\.Ephemeral/.test(ti));
  const tiLines = ti.split('\n');
  const lineHas = (needle) => tiLines.filter((l) => l.includes(needle));
  check('button: claim success reply stays PUBLIC (it IS the in-channel notice)', lineHas("successEmbed('Ticket claimed'").length === 1 && !lineHas("successEmbed('Ticket claimed'")[0].includes('Ephemeral'));
  check('button: reopen success reply stays PUBLIC (log-channel notice)', lineHas("successEmbed('Ticket reopened'").length === 1 && !lineHas("successEmbed('Ticket reopened'")[0].includes('Ephemeral'));
  check('button: add-user success reply stays PUBLIC (it IS the in-channel notice)', lineHas("successEmbed('User added'").length === 1 && !lineHas("successEmbed('User added'")[0].includes('Ephemeral'));
  check('button: rating handler already ephemeral (unchanged)', read('src/events/ticketRatingInteraction.js').includes('flags: MessageFlags.Ephemeral'));

  const ticketsSrc = read('src/utils/tickets.js');
  check('tickets util: channel.send posts exist and none is ephemeral', (ticketsSrc.match(/\.send\(/g) || []).length >= 3 && !ticketsSrc.includes('Ephemeral'));
  check('tickets util: ticket open-embed post is a plain channel.send (no flags)', /await channel\.send\(\{ content: `<@\$\{interaction\.user\.id\}>`, embeds: \[tickets\.ticketOpenEmbed/.test(ti));

  // Central-only: no ticket command file was touched for this.
  const ticketFiles = fs.readdirSync(path.join(ROOT, 'src/commands/tickets')).filter((f) => f.endsWith('.js'));
  check('central-only: no ticket command file mentions Ephemeral', ticketFiles.every((f) => !read(`src/commands/tickets/${f}`).includes('Ephemeral')));
  check('central-only: only consolidate.js wires the helper', read('src/handlers/consolidate.js').includes("require('../utils/replyEphemeral')") && !read('src/commands/tickets/ticket-setup.js').includes('replyEphemeral'));
  check('central-only: no non-ticket command file references the helper', (() => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    return walk(path.join(ROOT, 'src/commands')).filter((f) => f.endsWith('.js')).every((f) => !fs.readFileSync(f, 'utf8').includes('replyEphemeral'));
  })());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

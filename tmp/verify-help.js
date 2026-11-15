// Verify /help (1.15.5): every group renders real commands through the
// consolidated parents, total count is 266, and every listed path resolves.
const { Collection } = require('discord.js');
const { buildConsolidated } = require('../src/handlers/consolidate');
const help = require('../src/commands/utility/help');

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.log(`FAIL: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

const { topLevel } = buildConsolidated();
const client = { commands: new Collection() };
for (const cmd of topLevel) client.commands.set(cmd.data.name, cmd);

// 1. Total count.
check(help.countCommands(client) === 266, `total count is 266 (got ${help.countCommands(client)})`);

// 2. Select menu stays within Discord's 25-option limit.
const groupKeys = Object.keys(help.GROUPS);
check(groupKeys.length <= 25, `${groupKeys.length} groups (select menu limit 25)`);
check(groupKeys.every((k) => help.GROUPS[k].label.length <= 100), 'all group labels <= 100 chars');

// 3. Every group renders >= 1 line, never "No commands in this group.",
// and every description fits the 4096-char embed limit.
let listed = 0;
for (const key of groupKeys) {
  const embed = help.groupEmbed(client, key);
  const desc = embed.data.description;
  check(desc !== 'No commands in this group.', `group ${key} is not empty`);
  check(desc.length <= 4096, `group ${key} description ${desc.length} chars <= 4096`);
  listed += desc.split('\n').length;
}
console.log(`total listed paths: ${listed}`);

// 4. Every listed path resolves to a real leaf subcommand with the same
// description. Build the set of real paths from the consolidated JSON.
const real = new Map(); // "/mod ban" -> description
for (const cmd of client.commands.values()) {
  const json = cmd.data.toJSON();
  if ((json.type ?? 1) !== 1) { real.set(json.name, null); continue; } // context menu
  if (cmd.isParent) {
    for (const opt of json.options || []) {
      if (opt.type === 2) for (const inner of opt.options || []) real.set(`/${json.name} ${opt.name} ${inner.name}`, inner.description);
      else real.set(`/${json.name} ${opt.name}`, opt.description);
    }
  } else if ((json.options || []).length) {
    for (const opt of json.options) real.set(`/${json.name} ${opt.name}`, opt.description);
  } else {
    real.set(`/${json.name}`, json.description);
  }
}
let badPaths = 0;
for (const key of groupKeys) {
  for (const line of help.linesForGroup(client, key)) {
    const m = line.match(/^\*\*(.+?)\*\* — (.*)$/);
    if (!m) { badPaths++; console.log(`FAIL: unparsable line in ${key}: ${line}`); continue; }
    const [, path, desc] = m;
    if (path.startsWith('/')) {
      if (!real.has(path)) { badPaths++; console.log(`FAIL: ${key} lists ${path} which does not resolve`); }
      else if (real.get(path) !== desc) { badPaths++; console.log(`FAIL: ${key} ${path} description mismatch`); }
    }
    // Non-slash lines are the two context-menu entries; checked below.
  }
}
check(badPaths === 0, `all listed slash paths resolve with matching descriptions (${real.size} real paths)`);

// 5. Moderation group specifically lists the mod subcommands.
const modLines = help.linesForGroup(client, 'moderation').join('\n');
for (const name of ['/mod ban', '/mod kick', '/mod timeout', '/mod warn add', '/mod warn list', '/mod purge']) {
  check(modLines.includes(`**${name}**`), `moderation lists ${name}`);
}

// 6. Standalones + context menus are listed in "other"/"giveaways".
const other = help.linesForGroup(client, 'other').join('\n');
check(other.includes('**/serverbackup '), 'other lists serverbackup subcommands');
check(other.includes('**/mediathreads '), 'other lists mediathreads subcommands');
check(other.includes('**Bookmark message**'), 'other lists Bookmark message context menu');
check(other.includes('**Translate message**'), 'other lists Translate message context menu');
check(help.linesForGroup(client, 'giveaways').some((l) => l.startsWith('**/giveaway ')), 'giveaways lists /giveaway subcommands');

// 7. Every parent appears in exactly one group; every top-level command is
// listed somewhere.
const parentToGroups = {};
for (const [key, g] of Object.entries(help.GROUPS)) {
  for (const p of g.parents || []) parentToGroups[p] = (parentToGroups[p] || []).concat(key);
}
const allParents = [...client.commands.values()].filter((c) => c.isParent).map((c) => c.data.name);
check(allParents.every((p) => (parentToGroups[p] || []).length === 1), 'every parent in exactly one group');
check(allParents.every((p) => parentToGroups[p]), 'no parent missing from groups');

// 8. Execute path: opening embed says 266 and the menu has <= 25 options.
(async () => {
  let captured = null;
  let collected = null;
  const replyMsg = { createMessageComponentCollector: () => { collected = { on: () => {} }; return collected; } };
  const interaction = {
    client,
    reply: async (opts) => { captured = opts; return { resource: { message: replyMsg } }; },
    editReply: async () => {},
  };
  await help.execute(interaction);
  const opening = captured.embeds[0].data.description;
  check(opening.includes('**266 commands**'), `opening embed says 266 commands (got: ${opening.split('\n').pop()})`);
  check(captured.components[0].components[0].options.length <= 25, `select menu has ${captured.components[0].components[0].options.length} options (<= 25)`);
  check(captured.ephemeral === true, 'reply is ephemeral');
  console.log(failures === 0 ? 'ALL HELP CHECKS PASSED' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: execute threw', e); process.exit(1); });

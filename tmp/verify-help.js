// Verify /help (1.15.8): opening view lists categories only, group views are
// paginated at 10 commands per page with ◀ / ▶ / Back navigation, and the
// collector stays invoker-only for the menu AND the buttons.
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
check(help.countCommands(client) === 269, `total count is 269 (got ${help.countCommands(client)})`);

// 2. Select menu stays within Discord's 25-option limit.
const groupKeys = Object.keys(help.GROUPS);
check(groupKeys.length <= 25, `${groupKeys.length} groups (select menu limit 25)`);
check(groupKeys.every((k) => help.GROUPS[k].label.length <= 100), 'all group labels <= 100 chars');
check(groupKeys.every((k) => (help.GROUPS[k].blurb || '').length <= 100), 'all group blurbs <= 100 chars');

// 3. Every group paginates: each page has <= 10 lines and fits the 4096-char
// embed limit, pages join back to the full line list, and no group is empty.
let listed = 0;
for (const key of groupKeys) {
  const lines = help.linesForGroup(client, key);
  const total = help.pageCount(client, key);
  check(total === Math.max(1, Math.ceil(lines.length / help.PAGE_SIZE)), `group ${key} has ${total} page(s) for ${lines.length} lines`);
  const seen = [];
  for (let p = 0; p < total; p++) {
    const embed = help.groupEmbed(client, key, p);
    const desc = embed.data.description;
    const pageLines = desc === 'No commands in this group.' ? [] : desc.split('\n');
    check(pageLines.length <= help.PAGE_SIZE, `group ${key} page ${p + 1} has ${pageLines.length} lines (<= ${help.PAGE_SIZE})`);
    check(desc.length <= 4096, `group ${key} page ${p + 1} description ${desc.length} chars <= 4096`);
    check(embed.data.title.includes(`Page ${p + 1}/${total}`), `group ${key} page ${p + 1} title shows Page ${p + 1}/${total}`);
    // Total embed size (title + description + footer) under Discord's 6000.
    const footerLen = (embed.data.footer?.text || '').length;
    check((embed.data.title || '').length + desc.length + footerLen <= 6000, `group ${key} page ${p + 1} total embed size under 6000`);
    seen.push(...pageLines);
  }
  check(seen.length === lines.length && seen.every((l, i) => l === lines[i]), `group ${key} pages join back to its ${lines.length} lines`);
  check(lines.length >= 1, `group ${key} is not empty`);
  listed += lines.length;
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

// 8. Execute path: opening view is categories only (no command list), the
// reply is public, the menu is invoker-only; then drive the full navigation
// flow with mock component interactions.
class FakeCollector {
  constructor(opts) { this.opts = opts; this.handlers = {}; }
  on(event, fn) { this.handlers[event] = fn; return this; }
  async fire(event, i) { await this.handlers[event]?.(i); }
}

(async () => {
  let captured = null;
  let lastUpdate = null;
  let editReplyArg = null;
  let collected = null;
  const replyMsg = { createMessageComponentCollector: (opts) => { collected = new FakeCollector(opts); return collected; } };
  const interaction = {
    client,
    user: { id: '111' },
    reply: async (opts) => { captured = opts; return { resource: { message: replyMsg } }; },
    editReply: async (arg) => { editReplyArg = arg; },
  };
  const comp = (customId, { values, userId = '111' } = {}) => ({
    customId, values, user: { id: userId },
    update: async (payload) => { lastUpdate = payload; },
  });

  await help.execute(interaction);

  // 8a. Opening view: categories only.
  const opening = captured.embeds[0];
  check(opening.data.title === '🤖 Vikings Hall — Help', `opening title is the help title (got: ${opening.data.title})`);
  check(opening.data.description.includes('**269 commands**'), 'opening embed says 269 commands');
  check(groupKeys.every((k) => opening.data.description.includes(help.GROUPS[k].label)), 'opening embed lists all 25 group labels');
  check(!opening.data.description.includes('**/mod ban**') && !opening.data.description.includes('**/music play**'), 'opening embed lists NO commands (not one giant list)');
  const openingFooterLen = (opening.data.footer?.text || '').length;
  check(opening.data.description.length <= 4096 && opening.data.description.length + openingFooterLen <= 6000, `opening embed fits Discord limits (${opening.data.description.length} chars)`);
  check(captured.components.length === 1, `opening view has 1 component row (menu only, got ${captured.components.length})`);
  check(captured.components[0].components[0].options.length <= 25, `select menu has ${captured.components[0].components[0].options.length} options (<= 25)`);
  // 1.15.7: the reply is PUBLIC now (no ephemeral flag).
  check(captured.ephemeral === undefined, 'reply is public (no ephemeral flag)');

  // 8b. Collector filter is invoker-only for both the select menu and buttons.
  const filter = collected.opts.filter;
  check(typeof filter === 'function'
    && filter({ user: { id: '111' }, customId: 'help_category' }) === true
    && filter({ user: { id: '222' }, customId: 'help_category' }) === false
    && filter({ user: { id: '111' }, customId: 'help_next' }) === true
    && filter({ user: { id: '222' }, customId: 'help_next' }) === false,
  'collector filter is invoker-only for select menu AND buttons');

  // 8c. Select /tools (25 lines -> 3 pages of 10/10/5).
  const toolsLines = help.linesForGroup(client, 'tools').length;
  const toolsPages = Math.ceil(toolsLines / 10);
  check(toolsLines > 10, `/tools has ${toolsLines} lines (> 10, so pagination engages)`);
  await collected.fire('collect', comp('help_category', { values: ['tools'] }));
  const page1 = lastUpdate.embeds[0];
  check(page1.data.title.includes(`Page 1/${toolsPages}`), `tools page 1 title shows Page 1/${toolsPages} (got: ${page1.data.title})`);
  check(page1.data.description.split('\n').length === 10, `tools page 1 shows exactly 10 commands (got ${page1.data.description.split('\n').length})`);
  check(lastUpdate.components.length === 2, `group view has 2 component rows (menu + buttons, got ${lastUpdate.components.length})`);
  const [prev1, , next1] = lastUpdate.components[1].components;
  check(prev1.data.disabled === true, 'Previous disabled on page 1');
  check(next1.data.disabled === false, 'Next enabled on page 1');

  // 8d. Next repeatedly -> last page (Next disabled, Previous enabled).
  for (let p = 2; p <= toolsPages; p++) {
    await collected.fire('collect', comp('help_next'));
    check(lastUpdate.embeds[0].data.title.includes(`Page ${p}/${toolsPages}`), `Next advances to Page ${p}/${toolsPages}`);
    const expectedLines = p === toolsPages ? toolsLines - 10 * (toolsPages - 1) : 10;
    check(lastUpdate.embeds[0].data.description.split('\n').length === expectedLines, `tools page ${p} shows ${expectedLines} commands`);
  }
  const [, , nextLast] = lastUpdate.components[1].components;
  check(nextLast.data.disabled === true, 'Next disabled on last page');
  const [prevLast] = lastUpdate.components[1].components;
  check(prevLast.data.disabled === false, 'Previous enabled on last page');

  // 8e. Next again stays clamped on the last page.
  await collected.fire('collect', comp('help_next'));
  check(lastUpdate.embeds[0].data.title.includes(`Page ${toolsPages}/${toolsPages}`), 'Next on last page stays clamped');

  // 8f. Previous goes back a page.
  await collected.fire('collect', comp('help_prev'));
  check(lastUpdate.embeds[0].data.title.includes(`Page ${toolsPages - 1}/${toolsPages}`), `Previous goes back to Page ${toolsPages - 1}/${toolsPages}`);

  // 8g. Back to categories returns to the opening view (menu only).
  await collected.fire('collect', comp('help_home'));
  check(lastUpdate.embeds[0].data.title === '🤖 Vikings Hall — Help', 'Back to categories returns to the home view');
  check(!lastUpdate.embeds[0].data.description.includes('**/mod ban**'), 'home view after Back still lists no commands');
  check(lastUpdate.components.length === 1, `home view after Back has 1 component row (got ${lastUpdate.components.length})`);

  // 8h. Switching groups via the select menu FROM a group page works
  // (menu stays present on group pages).
  await collected.fire('collect', comp('help_category', { values: ['music'] }));
  check(lastUpdate.embeds[0].data.title.startsWith('🎵 Music'), `select from home opens music group (got: ${lastUpdate.embeds[0].data.title})`);
  await collected.fire('collect', comp('help_category', { values: ['leveling'] }));
  check(lastUpdate.embeds[0].data.title.startsWith('🏆 Leveling'), `select from a group page switches to leveling (got: ${lastUpdate.embeds[0].data.title})`);
  check(lastUpdate.components.length === 2, 'group view after switch still has menu + buttons');

  // 8i. Collector end clears the components.
  await collected.fire('end');
  check(editReplyArg && Array.isArray(editReplyArg.components) && editReplyArg.components.length === 0, 'collector end clears components');

  console.log(failures === 0 ? 'ALL HELP CHECKS PASSED' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: execute threw', e); process.exit(1); });

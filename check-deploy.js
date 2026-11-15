// Pre-flight check for `npm run deploy`: validates the exact payload
// deploy-commands.js sends (the CONSOLIDATED list since 1.15.0) against
// Discord's documented limits, and verifies every one of the 269 flat
// commands is reachable through exactly one (parent, group?, subcommand)
// path.
const { buildConsolidated } = require('./src/handlers/consolidate');

const { topLevel, flatCount, childCount, parentCount } = buildConsolidated();
const all = topLevel.map((c) => ({ file: c.data.name, json: c.data.toJSON(), isParent: !!c.isParent }));

const problems = [];
const byType = {};
const seenNames = new Map();

// Count grouped children: each level-1 subcommand OR group under a parent is
// one flat child (a group's inner subcommands belong to that same child —
// they are NOT separate flat commands, so do not recurse into groups here).
let leafCount = 0;
let contextCount = 0;
for (const { json: j, isParent } of all) {
  if ((j.type ?? 1) !== 1) { contextCount++; continue; }
  if (isParent) leafCount += (j.options || []).length;
  else leafCount += 1; // standalone chat command (serverbackup, giveaway, mediathreads)
}

for (const { file, json: j } of all) {
  const type = j.type ?? 1;
  byType[type] = (byType[type] || 0) + 1;
  const key = type + ':' + j.name;
  if (seenNames.has(key)) problems.push(`DUPLICATE NAME ${j.name} (type ${type}): ${seenNames.get(key)} vs ${file}`);
  else seenNames.set(key, file);
  if (type === 1 || type === undefined) {
    if (!j.description || j.description.length < 1 || j.description.length > 100) problems.push(`BAD DESCRIPTION (${j.description?.length}) ${j.name} in ${file}`);
    if (!/^[a-z0-9_-]{1,32}$/.test(j.name)) problems.push(`BAD NAME ${j.name} in ${file}`);
  }
  if ((type === 2 || type === 3) && j.description) problems.push(`CONTEXT MENU WITH DESCRIPTION ${j.name} in ${file}`);
  if ((j.options?.length || 0) > 25) problems.push(`TOO MANY OPTIONS (${j.options.length}) ${j.name} in ${file}`);
  const checkOpts = (opts, where) => {
    const seen = new Set();
    let seenRequired = false;
    let seenOptional = false;
    for (const o of opts || []) {
      if (seen.has(o.name)) problems.push(`DUPLICATE OPTION NAME ${o.name} in ${j.name} ${where} (${file})`);
      seen.add(o.name);
      if (o.description && (o.description.length < 1 || o.description.length > 100)) problems.push(`BAD OPTION DESCRIPTION (${o.description.length}) ${j.name} ${where}${o.name} in ${file}`);
      if (!/^[a-z0-9_-]{1,32}$/.test(o.name)) problems.push(`BAD OPTION NAME ${o.name} in ${j.name} ${file}`);
      if ((o.choices?.length || 0) > 25) problems.push(`TOO MANY CHOICES (${o.choices.length}) ${j.name} ${where}${o.name} in ${file}`);
      for (const c of o.choices || []) {
        if (typeof c.name === 'string' && (c.name.length < 1 || c.name.length > 100)) problems.push(`BAD CHOICE NAME (${c.name.length}) ${j.name} ${where}${o.name} in ${file}`);
        if (typeof c.value === 'string' && c.value.length > 100) problems.push(`BAD CHOICE VALUE (${c.value.length}) ${j.name} ${where}${o.name} in ${file}`);
      }
      if (o.type === 1 || o.type === 2) {
        if ((o.options?.length || 0) > 25) problems.push(`TOO MANY OPTIONS (${o.options.length}) ${j.name} ${where}${o.name} in ${file}`);
        checkOpts(o.options, where + o.name + ' > ');
        continue;
      }
      if (o.required) { if (seenOptional) problems.push(`REQUIRED AFTER OPTIONAL ${j.name} ${where}${o.name} in ${file}`); seenRequired = true; }
      else seenOptional = true;
    }
  };
  checkOpts(j.options, '');
}

if (leafCount !== 267) problems.push(`LEAF COUNT ${leafCount} != 267 chat-input children (some flat commands unreachable or duplicated)`);
if (contextCount !== 2) problems.push(`CONTEXT MENU COUNT ${contextCount} != 2`);
if (flatCount !== 269) problems.push(`FLAT COUNT ${flatCount} != 269`);

console.log(`top-level commands: ${all.length} (${parentCount} parents, ${all.length - parentCount} standalone/context)`);
console.log(`grouped subcommands: ${childCount} (flat chat children reachable: ${leafCount})`);
console.log('by type (1=chat, 2=user, 3=message):', JSON.stringify(byType));
console.log('CHAT_INPUT count vs Discord global limit 100:', (byType[1] || 0), (byType[1] || 0) > 100 ? 'OVER LIMIT' : 'ok');
console.log('problems:', problems.length);
problems.forEach((p) => console.log(' -', p));
if (problems.length) process.exit(1);

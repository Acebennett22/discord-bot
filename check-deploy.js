// Pre-flight check for `npm run deploy`: validates the exact payload
// deploy-commands.js sends against Discord's documented limits.
const fs = require('fs');
const path = require('path');
const commandsPath = path.resolve(__dirname, 'src', 'commands');
const all = [];
for (const folder of fs.readdirSync(commandsPath)) {
  const folderPath = path.join(commandsPath, folder);
  if (!fs.statSync(folderPath).isDirectory()) continue;
  for (const file of fs.readdirSync(folderPath).filter((f) => f.endsWith('.js'))) {
    const cmd = require(path.join(folderPath, file));
    if (cmd?.data) all.push({ file: folder + '/' + file, json: cmd.data.toJSON() });
  }
}
const problems = [];
const byType = {};
const seenNames = new Map();
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
    let seenRequired = false;
    let seenOptional = false;
    for (const o of opts || []) {
      if (o.description && (o.description.length < 1 || o.description.length > 100)) problems.push(`BAD OPTION DESCRIPTION (${o.description.length}) ${j.name} ${where}${o.name} in ${file}`);
      if (!/^[a-z0-9_-]{1,32}$/.test(o.name)) problems.push(`BAD OPTION NAME ${o.name} in ${j.name} ${file}`);
      if ((o.choices?.length || 0) > 25) problems.push(`TOO MANY CHOICES (${o.choices.length}) ${j.name} ${where}${o.name} in ${file}`);
      for (const c of o.choices || []) {
        if (typeof c.name === 'string' && (c.name.length < 1 || c.name.length > 100)) problems.push(`BAD CHOICE NAME (${c.name.length}) ${j.name} ${where}${o.name} in ${file}`);
        if (typeof c.value === 'string' && c.value.length > 100) problems.push(`BAD CHOICE VALUE (${c.value.length}) ${j.name} ${where}${o.name} in ${file}`);
      }
      if (o.type === 1 || o.type === 2) { checkOpts(o.options, where + o.name + ' > '); continue; }
      if (o.required) { if (seenOptional) problems.push(`REQUIRED AFTER OPTIONAL ${j.name} ${where}${o.name} in ${file}`); seenRequired = true; }
      else seenOptional = true;
    }
  };
  checkOpts(j.options, '');
}
console.log('total commands:', all.length);
console.log('by type (1=chat, 2=user, 3=message):', JSON.stringify(byType));
console.log('CHAT_INPUT count vs Discord global limit 100:', (byType[1] || 0), (byType[1] || 0) > 100 ? 'OVER LIMIT' : 'ok');
console.log('problems:', problems.length);
problems.forEach((p) => console.log(' -', p));

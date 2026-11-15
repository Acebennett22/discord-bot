// Registers slash commands with Discord — GLOBAL by default, so the bot works
// in every server it joins. Set guildId in config.json ONLY for fast dev
// testing (guild commands appear instantly; global can take up to ~1 hour).
// Run: npm run deploy   (after filling in config.json)
//
// Diagnostics: DEPLOY_LIMIT=N deploys only the first N commands,
// DEPLOY_OFFSET=N skips the first N (combine to bisect a failing deploy,
// e.g. DEPLOY_LIMIT=50 npm run deploy). A bulk PUT *replaces* the whole
// command list in that scope, so only use slices in a test guild (guildId)
// or when no commands are registered yet.
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./utils/config');

const allCommands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const folder of fs.readdirSync(commandsPath)) {
  const folderPath = path.join(commandsPath, folder);
  if (!fs.statSync(folderPath).isDirectory()) continue;
  for (const file of fs.readdirSync(folderPath).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(folderPath, file));
    if (command?.data) allCommands.push(command.data.toJSON());
  }
}

const offset = Math.max(0, parseInt(process.env.DEPLOY_OFFSET || '0', 10) || 0);
const limit = parseInt(process.env.DEPLOY_LIMIT || '0', 10) || 0;
const commands = limit > 0 ? allCommands.slice(offset, offset + limit) : allCommands.slice(offset);
console.log(`[deploy] Sending ${commands.length} of ${allCommands.length} commands (offset ${offset})${commands.length ? ` — first: ${commands[0].name}, last: ${commands[commands.length - 1].name}` : ''}.`);

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
      console.log(`✅ Registered ${commands.length} guild commands in ${config.guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
      console.log(`✅ Registered ${commands.length} global commands (may take up to an hour to appear).`);
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err.message);
    // The flattened message hides which element Discord rejected — print
    // the raw error object and the exact command at index 0 of the sent
    // array so the culprit is visible.
    if (err.rawError) console.error('[deploy] Raw Discord error:', JSON.stringify(err.rawError, null, 2));
    if (commands[0]) console.error('[deploy] Rejected element [0]:', JSON.stringify(commands[0], null, 2));
    process.exit(1);
  }
})();

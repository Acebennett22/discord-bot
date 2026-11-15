// Registers slash commands with Discord — GLOBAL by default, so the bot works
// in every server it joins. Set guildId in config.json ONLY for fast dev
// testing (guild commands appear instantly; global can take up to ~1 hour).
// Run: npm run deploy   (after filling in config.json)
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./utils/config');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const folder of fs.readdirSync(commandsPath)) {
  const folderPath = path.join(commandsPath, folder);
  if (!fs.statSync(folderPath).isDirectory()) continue;
  for (const file of fs.readdirSync(folderPath).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(folderPath, file));
    if (command?.data) commands.push(command.data.toJSON());
  }
}

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
    // Discord's 50035 carries a nested `errors` object naming the exact
    // field — print it in full so the next failure is diagnosable.
    if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
    process.exit(1);
  }
})();

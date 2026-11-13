// Auto-loads every command file under src/commands/** into client.commands.
// Each command exports { data: SlashCommandBuilder, execute }.
const fs = require('fs');
const path = require('path');

function loadCommands(client) {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const folders = fs.readdirSync(commandsPath);
  for (const folder of folders) {
    const folderPath = path.join(commandsPath, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    const files = fs.readdirSync(folderPath).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const command = require(path.join(folderPath, file));
      if (!command?.data?.name || typeof command.execute !== 'function') {
        console.warn(`[commands] Skipping ${folder}/${file}: missing data.name or execute().`);
        continue;
      }
      client.commands.set(command.data.name, command);
    }
  }
  console.log(`[commands] Loaded ${client.commands.size} commands.`);
}

module.exports = { loadCommands };

// Auto-loads every command file under src/commands/** into client.commands.
// Since 1.15.0 the 266 flat commands are consolidated into ~37 top-level
// commands (see src/handlers/consolidate.js) so the bot fits Discord's
// 100-commands-per-scope cap. client.commands holds the PARENT commands
// keyed by parent name, plus standalone commands and context menus.
const { buildConsolidated } = require('./consolidate');

function loadCommands(client) {
  const { topLevel, flatCount, childCount, parentCount } = buildConsolidated();
  for (const cmd of topLevel) client.commands.set(cmd.data.name, cmd);
  console.log(`[commands] Loaded ${client.commands.size} top-level commands (${parentCount} parents, ${childCount} grouped subcommands, from ${flatCount} files).`);
}

module.exports = { loadCommands };

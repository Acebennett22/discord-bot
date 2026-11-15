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
//
// DEPLOY_MODE=single registers commands one at a time (POST each — Discord
// upserts by name) instead of one bulk PUT. Use it if the bulk request
// itself is rejected for size: it bypasses the per-request array limit, but
// it still counts toward Discord's 200 new-command creates per day and the
// 100 CHAT_INPUT commands per scope, so it stops at the first failure and
// names the command that failed.
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
// Default deploy limit is 100: Discord rejects a bulk request much above
// that ("Must be 130 or fewer in length"), and 100 is the per-scope
// command cap. Set DEPLOY_LIMIT=0 for no limit, or another number to test.
const limit = process.env.DEPLOY_LIMIT !== undefined
  ? (parseInt(process.env.DEPLOY_LIMIT, 10) || 0)
  : 100;
const commands = limit > 0 ? allCommands.slice(offset, offset + limit) : allCommands.slice(offset);
const skipped = limit > 0 ? allCommands.slice(offset + limit) : [];
const singleMode = process.env.DEPLOY_MODE === 'single';
console.log(`[deploy] ${singleMode ? 'Single' : 'Bulk'} mode: sending ${commands.length} of ${allCommands.length} commands (offset ${offset}, limit ${limit || 'none'})${commands.length ? ` — first: ${commands[0].name}, last: ${commands[commands.length - 1].name}` : ''}.`);
if (skipped.length) console.log(`[deploy] Skipping ${skipped.length} commands over the limit (not registered): ${skipped.map((c) => c.name).join(', ')}`);
if (skipped.length && !singleMode) console.log('[deploy] WARNING: a bulk deploy REPLACES the whole command list — any commands previously registered one-at-a-time beyond these 100 will be removed. Use DEPLOY_MODE=single to add commands without wiping the rest.');

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (singleMode) {
      let done = 0;
      let current = null;
      try {
        for (const cmd of commands) {
          current = cmd;
          if (config.guildId) await rest.post(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: cmd });
          else await rest.post(Routes.applicationCommands(config.clientId), { body: cmd });
          done++;
          if (done % 25 === 0 || done === commands.length) console.log(`[deploy] ${done}/${commands.length} registered (latest: ${cmd.name}).`);
        }
      } catch (err) {
        // Report the command that actually failed, not commands[0].
        console.error(`[deploy] Failed while registering ${current?.name || 'unknown'} (${done}/${commands.length} done).`);
        throw err;
      }
      console.log(`✅ Registered ${done} commands one at a time${config.guildId ? ` in guild ${config.guildId}` : ' globally (may take up to an hour to appear)'}.`);
      return;
    }
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
    // the raw error object and, for bulk mode, the exact command at index 0
    // of the sent array so the culprit is visible. (Single mode already
    // names the failing command above.)
    if (err.rawError) console.error('[deploy] Raw Discord error:', JSON.stringify(err.rawError, null, 2));
    if (!singleMode && commands[0]) console.error('[deploy] Rejected element [0]:', JSON.stringify(commands[0], null, 2));
    process.exit(1);
  }
})();

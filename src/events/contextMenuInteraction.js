// "Bookmark message" context-menu command — the slash-command handler in
// interactionCreate.js only routes chat-input commands, so context menu
// commands are routed here.
const { Events } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');
const errorLogger = require('../utils/errorLogger');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (!interaction.isMessageContextMenuCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      await errorLogger.log({ level: 'error', guildId: interaction.guildId, commandName: interaction.commandName, userId: interaction.user.id, message: `/${interaction.commandName} failed: ${err.message}`, stack: err.stack });
      const payload = { embeds: [errorEmbed('Command error', 'Something went wrong running that command.')] };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};

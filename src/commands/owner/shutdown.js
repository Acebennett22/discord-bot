const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { requireOwner } = require('../../utils/ownerCheck');
const { infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('shutdown').setDescription('Owner only: gracefully shut the bot down.'),
  async execute(interaction) {
    if (!(await requireOwner(interaction))) return;
    await interaction.reply({ embeds: [infoEmbed('Shutting down', '🛑 Shutting down gracefully…')], flags: MessageFlags.Ephemeral });
    setTimeout(async () => {
      try {
        const db = require('../../utils/database');
        await db.closePool().catch(() => {});
        await interaction.client.destroy();
      } catch {}
      console.log('[shutdown] Graceful shutdown complete.');
      process.exit(0);
    }, 1000);
  },
};

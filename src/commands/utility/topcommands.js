const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('topcommands').setDescription('Top 10 most-used commands in this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'MySQL is not connected, so command stats are unavailable.')], ephemeral: true });
    const rows = await db.getTopCommands(interaction.guildId, 10);
    if (!rows) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Could not read stats from MySQL right now.')], ephemeral: true });
    if (!rows.length) return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Top commands', 'No commands logged in this server yet.')] });
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Top commands — this server', rows.map((r, i) => `**${i + 1}.** /${r.command_name} — ${r.uses}`).join('\n'))] });
  },
};

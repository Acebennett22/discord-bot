const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('mystats').setDescription('Show your own stats in this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) {
      return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'MySQL is not connected, so stored stats are unavailable. Check config.json `database`.')], ephemeral: true });
    }
    const s = await db.getUserStats(interaction.user.id, interaction.guildId);
    if (!s) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Could not read your stats from MySQL right now.')], ephemeral: true });
    return interaction.reply({ embeds: [infoEmbed(`Your stats — ${interaction.user.tag}`, [
      `**Commands used (this server):** ${s.commands_used}`,
      `**Warnings:** ${s.warns}`,
      `**Last seen:** ${s.last_seen ? new Date(s.last_seen).toLocaleString() : 'Never'}`,
    ].join('\n'))], ephemeral: true });
  },
};

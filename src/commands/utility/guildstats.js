const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('guildstats').setDescription('Show this server\'s stats (commands, songs, joins, warns).'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'MySQL is not connected, so guild stats are unavailable.')] });
    const s = await db.getGuildStats(interaction.guildId);
    if (!s) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Could not read stats from MySQL right now.')] });
    return interaction.reply({  embeds: [infoEmbed(`Guild stats — ${interaction.guild.name}`, [
      `**Commands used:** ${s.commandsUsed}`,
      `**Songs played:** ${s.songsPlayed}`,
      `**Members joined:** ${s.membersJoined}`,
      `**Warnings issued:** ${s.warns}`,
    ].join('\n'))] });
  },
};

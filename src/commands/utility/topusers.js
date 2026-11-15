const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('topusers').setDescription('Top 10 most active command users in this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'MySQL is not connected, so user stats are unavailable.')] });
    const rows = await db.getTopUsers(interaction.guildId, 10);
    if (!rows) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Could not read stats from MySQL right now.')] });
    if (!rows.length) return interaction.reply({  embeds: [infoEmbed('Top users', 'No command activity logged in this server yet.')] });
    return interaction.reply({  embeds: [infoEmbed('Top users — this server', rows.map((r, i) => `**${i + 1}.** ${r.username || `<@${r.user_id}>`} — ${r.uses}`).join('\n'))] });
  },
};

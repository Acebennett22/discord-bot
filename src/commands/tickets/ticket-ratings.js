const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const ratings = require('../../utils/ticketRatings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-ratings')
    .setDescription('Staff: show ticket support ratings (average, count, recent).'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Ticket ratings need MySQL.')] });
    if (!interaction.memberPermissions?.has('ManageGuild') && !interaction.memberPermissions?.has('ManageMessages')) {
      return interaction.reply({ embeds: [errorEmbed('Staff only', 'You need Manage Server to view ticket ratings.')] });
    }
    const stats = await ratings.getRatingStats(interaction.guildId);
    if (!stats.count) return interaction.reply({ embeds: [infoEmbed('⭐ Ticket ratings', 'No ratings yet — members are asked to rate when their ticket closes.')] });
    const lines = stats.recent.map((r) => {
      const stars = '⭐'.repeat(r.rating);
      return `${stars} — <@${r.user_id}> (ticket #${r.ticket_id})${r.comment ? `\n> ${r.comment.slice(0, 200)}` : ''}`;
    });
    return interaction.reply({ embeds: [infoEmbed('⭐ Ticket ratings', [
      `**Average:** ${stats.average.toFixed(2)} / 5 from **${stats.count}** rating${stats.count === 1 ? '' : 's'}`,
      '',
      '**Recent:**',
      ...lines,
    ].join('\n'))] });
  },
};

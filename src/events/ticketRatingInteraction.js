// Ticket rating buttons + comment modal — customIds trating:<ticketId>:<stars>,
// trating-addcomment:<ticketId>:<stars>, trating-comment:<ticketId>:<stars>.
const { MessageFlags, Events } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const ratings = require('../utils/ticketRatings');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('trating-addcomment:')) {
      const [, ticketIdStr, starsStr] = interaction.customId.split(':');
      return interaction.showModal(ratings.commentModal(Number(ticketIdStr), Number(starsStr))).catch(() => {});
    }
    if (interaction.isButton() && interaction.customId.startsWith('trating:')) {
      const [, ticketIdStr, starsStr] = interaction.customId.split(':');
      const ticketId = Number(ticketIdStr);
      const stars = Number(starsStr);
      if (!ticketId || stars < 1 || stars > 5) return;
      await ratings.saveRating(ticketId, interaction.guildId, interaction.user.id, stars, null).catch(() => null);
      return interaction.reply({
        embeds: [successEmbed('Thanks for rating!', `You rated your ticket ${'⭐'.repeat(stars)} (${stars}/5).`)],
        components: [ratings.commentRow(ticketId, stars)],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('trating-comment:')) {
      const [, ticketIdStr, starsStr] = interaction.customId.split(':');
      const ticketId = Number(ticketIdStr);
      const stars = Number(starsStr);
      const comment = interaction.fields.getTextInputValue('comment') || '';
      await ratings.saveRating(ticketId, interaction.guildId, interaction.user.id, stars, comment || null).catch(() => null);
      return interaction.reply({ embeds: [successEmbed('Comment saved', comment ? 'Thanks — your comment was added to the rating.' : 'Rating saved.')], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};

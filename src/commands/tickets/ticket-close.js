const { SlashCommandBuilder } = require('discord.js');
const tickets = require('../../utils/tickets');
const { getGuildSettings } = require('../../utils/guildSettings');
const { errorEmbed, successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-close')
    .setDescription('Close this ticket (creator, support, or admin).')
    .addStringOption((o) => o.setName('reason').setDescription('Close reason')),
  async execute(interaction) {
    const ticket = await tickets.getTicketByChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ embeds: [errorEmbed('Not a ticket', 'This command only works inside a ticket channel.')], ephemeral: true });
    const settings = await getGuildSettings(interaction.guildId);
    if (!tickets.canManageTicket(interaction.member, ticket, settings)) {
      return interaction.reply({ embeds: [errorEmbed('No permission', 'Only the ticket creator, support staff, or an admin can close this ticket.')], ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    await tickets.closeTicket(interaction, interaction.channel, ticket, interaction.options.getString('reason'), interaction.user);
    return interaction.editReply({ embeds: [successEmbed('Ticket closed', '🔒 Transcript generated — the channel will be deleted in 60 seconds unless reopened.')] });
  },
};

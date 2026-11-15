const { SlashCommandBuilder } = require('discord.js');
const tickets = require('../../utils/tickets');
const { getGuildSettings } = require('../../utils/guildSettings');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-remove')
    .setDescription('Remove a user from this ticket.')
    .addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true)),
  async execute(interaction) {
    const ticket = await tickets.getTicketByChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ embeds: [errorEmbed('Not a ticket', 'This command only works inside a ticket channel.')] });
    const settings = await getGuildSettings(interaction.guildId);
    if (!tickets.canManageTicket(interaction.member, ticket, settings)) {
      return interaction.reply({ embeds: [errorEmbed('No permission', 'Only the ticket creator, support staff, or an admin can remove users.')] });
    }
    const user = interaction.options.getUser('user');
    if (user.id === ticket.user_id) return interaction.reply({ embeds: [errorEmbed('Cannot remove', 'You cannot remove the ticket creator.')] });
    await interaction.channel.permissionOverwrites.delete(user.id).catch(() => {});
    return interaction.reply({  embeds: [successEmbed('User removed', `${user} was removed from this ticket.`)] });
  },
};

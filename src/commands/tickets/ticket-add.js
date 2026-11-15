const { SlashCommandBuilder } = require('discord.js');
const tickets = require('../../utils/tickets');
const { getGuildSettings } = require('../../utils/guildSettings');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-add')
    .setDescription('Add a user to this ticket.')
    .addUserOption((o) => o.setName('user').setDescription('User to add').setRequired(true)),
  async execute(interaction) {
    const ticket = await tickets.getTicketByChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ embeds: [errorEmbed('Not a ticket', 'This command only works inside a ticket channel.')] });
    const settings = await getGuildSettings(interaction.guildId);
    if (!tickets.canManageTicket(interaction.member, ticket, settings)) {
      return interaction.reply({ embeds: [errorEmbed('No permission', 'Only the ticket creator, support staff, or an admin can add users.')] });
    }
    const user = interaction.options.getUser('user');
    await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    return interaction.reply({  embeds: [successEmbed('User added', `${user} was added to this ticket.`)] });
  },
};

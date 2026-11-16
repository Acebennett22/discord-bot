const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const tickets = require('../../utils/tickets');
const { getGuildSettings } = require('../../utils/guildSettings');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Admin only: post the ticket panel in a channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to post the panel in (defaults to this channel)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Invalid channel', 'Pick a text channel for the ticket panel.')] });
    const label = tickets.resolveTicketButtonLabel(await getGuildSettings(interaction.guildId));
    await channel.send({ embeds: [tickets.ticketPanelEmbed(null, null, label)], components: [tickets.ticketPanelRow(null, label)] });
    return interaction.reply({  embeds: [successEmbed('Ticket panel posted', `The ticket panel is live in <#${channel.id}>. Configure the category, support role, and log channel with /setup first if you haven't yet.`)] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const tickets = require('../../utils/tickets');
const { getGuildSettings } = require('../../utils/guildSettings');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('ticket-claim').setDescription('Claim this ticket (support staff or admin).'),
  async execute(interaction) {
    const ticket = await tickets.getTicketByChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ embeds: [errorEmbed('Not a ticket', 'This command only works inside a ticket channel.')], ephemeral: true });
    const settings = await getGuildSettings(interaction.guildId);
    if (!tickets.isSupport(interaction.member, ticket, settings)) {
      return interaction.reply({ embeds: [errorEmbed('No permission', 'Only support staff or an admin can claim a ticket.')], ephemeral: true });
    }
    if (db.isEnabled()) {
      await db.query("UPDATE tickets SET claimed_by = ?, status = 'claimed' WHERE id = ?", [interaction.user.id, ticket.id]);
    }
    return interaction.reply({ embeds: [successEmbed('Ticket claimed', `${interaction.user} has claimed this ticket.`)] });
  },
};

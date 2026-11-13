// Handles ticket buttons + modals (separate listener from interactionCreate,
// which only handles slash commands).
const {
  Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  PermissionsBitField,
} = require('discord.js');
const tickets = require('../utils/tickets');
const { getGuildSettings } = require('../utils/guildSettings');
const { successEmbed, errorEmbed, infoEmbed } = require('../utils/embeds');
const db = require('../utils/database');

function modalInput(id, label, style = TextInputStyle.Short, required = true) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required),
  );
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const client = interaction.client;

    // --- Create Ticket button -> subject modal (default panel or a
    // multi-panel button: ticket_create:<panelId>) ---
    if (interaction.isButton() && (interaction.customId === 'ticket_create' || interaction.customId.startsWith('ticket_create:'))) {
      const panelId = interaction.customId.includes(':') ? interaction.customId.split(':')[1] : null;
      const modal = new ModalBuilder().setCustomId(panelId ? `ticket_create_modal:${panelId}` : 'ticket_create_modal').setTitle('Create a Ticket');
      modal.addComponents(modalInput('subject', 'Subject / reason for your ticket', TextInputStyle.Short, true));
      return interaction.showModal(modal);
    }

    // --- Ticket control buttons (in the ticket channel) ---
    if (interaction.isButton() && ['ticket_close', 'ticket_claim', 'ticket_add_user'].includes(interaction.customId)) {
      const ticket = await tickets.getTicketByChannel(interaction.channelId);
      const settings = await getGuildSettings(interaction.guildId);
      if (!ticket) return interaction.reply({ embeds: [errorEmbed('Not a ticket', 'This channel is not a ticket.')], ephemeral: true });
      if (!tickets.canManageTicket(interaction.member, ticket, settings)) {
        return interaction.reply({ embeds: [errorEmbed('No permission', 'Only the ticket creator, support staff, or an admin can do that.')], ephemeral: true });
      }
      if (interaction.customId === 'ticket_close') {
        const modal = new ModalBuilder().setCustomId('ticket_close_modal').setTitle('Close Ticket');
        modal.addComponents(modalInput('reason', 'Close reason (optional)', TextInputStyle.Short, false));
        return interaction.showModal(modal);
      }
      if (interaction.customId === 'ticket_claim') {
        if (db.isEnabled()) {
          await db.query("UPDATE tickets SET claimed_by = ?, status = 'claimed' WHERE id = ?", [interaction.user.id, ticket.id]);
        }
        return interaction.reply({ embeds: [successEmbed('Ticket claimed', `🙋 ${interaction.user} has claimed this ticket.`)] });
      }
      if (interaction.customId === 'ticket_add_user') {
        const modal = new ModalBuilder().setCustomId('ticket_add_user_modal').setTitle('Add User to Ticket');
        modal.addComponents(modalInput('user', 'User ID or @mention', TextInputStyle.Short, true));
        return interaction.showModal(modal);
      }
    }

    // --- Reopen button (in the ticket log channel) ---
    if (interaction.isButton() && interaction.customId.startsWith('ticket_reopen:')) {
      const channelId = interaction.customId.split(':')[1];
      const channel = interaction.guild.channels.cache.get(channelId)
        || await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel) return interaction.reply({ embeds: [errorEmbed('Not found', 'That ticket channel no longer exists.')], ephemeral: true });
      const ticket = await tickets.getTicketByChannel(channelId);
      const settings = await getGuildSettings(interaction.guildId);
      if (!tickets.isSupport(interaction.member, ticket, settings)) {
        return interaction.reply({ embeds: [errorEmbed('No permission', 'Only support staff or an admin can reopen a ticket.')], ephemeral: true });
      }
      await tickets.reopenTicket(channel, ticket, interaction.user);
      return interaction.reply({ embeds: [successEmbed('Ticket reopened', `🔓 Ticket <#${channelId}> reopened.`)], ephemeral: true });
    }

    // --- Modals ---
    if (interaction.isModalSubmit() && (interaction.customId === 'ticket_create_modal' || interaction.customId.startsWith('ticket_create_modal:'))) {
      const panelId = interaction.customId.includes(':') ? interaction.customId.split(':')[1] : null;
      const subject = interaction.fields.getTextInputValue('subject');
      await interaction.deferReply({ ephemeral: true });
      const settings = await getGuildSettings(interaction.guildId);
      // Multi-panel (1.11.5): the panel's own category/staff role win.
      let panel = null;
      let channelOpts = {};
      if (panelId) {
        panel = await tickets.getPanel(interaction.guildId, panelId);
        if (!panel) return interaction.editReply({ embeds: [errorEmbed('Panel gone', 'That ticket panel no longer exists — ask an admin to post a new one.')] });
        channelOpts = { categoryId: panel.category_id, supportRoleId: panel.staff_role_id };
      }
      const channel = await tickets.createTicketChannel(interaction.guild, interaction.user, subject, settings, channelOpts);
      const ticket = await tickets.createTicketRecord(interaction.guildId, channel.id, interaction.user.id, subject, panel ? panel.id : null);
      await channel.send({ content: `<@${interaction.user.id}>`, embeds: [tickets.ticketOpenEmbed(ticket, interaction.user.tag)], components: [tickets.ticketControlRow()] });
      return interaction.editReply({ embeds: [successEmbed('Ticket created', `🎫 Your ticket is ready: <#${channel.id}>`)] });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'ticket_close_modal') {
      const reason = interaction.fields.getTextInputValue('reason') || 'No reason given';
      const ticket = await tickets.getTicketByChannel(interaction.channelId);
      await interaction.deferReply({ ephemeral: true });
      await tickets.closeTicket(interaction, interaction.channel, ticket, reason, interaction.user);
      return interaction.editReply({ embeds: [successEmbed('Ticket closed', '🔒 Transcript generated — the channel will be deleted in 60 seconds unless reopened.')] });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'ticket_add_user_modal') {
      const raw = interaction.fields.getTextInputValue('user');
      const userId = raw.replace(/[^0-9]/g, '');
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) return interaction.reply({ embeds: [errorEmbed('User not found', 'Could not find that user — use their user ID or @mention.')], ephemeral: true });
      await interaction.channel.permissionOverwrites.edit(userId, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
      });
      return interaction.reply({ embeds: [successEmbed('User added', `➕ ${user} was added to this ticket.`)] });
    }
  },
};

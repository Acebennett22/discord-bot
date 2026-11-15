const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const tickets = require('../../utils/tickets');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Admin only: manage multiple ticket panels (each with its own category and staff role).')
    .addSubcommand((s) => s.setName('create').setDescription('Post a new ticket panel.')
      .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true))
      .addChannelOption((o) => o.setName('category').setDescription('Category new tickets go in').addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption((o) => o.setName('staff_role').setDescription('Staff role for tickets from this panel'))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to post the panel in (defaults to this channel)').addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName('description').setDescription('Panel description text')))
    .addSubcommand((s) => s.setName('list').setDescription('List all ticket panels in this server.'))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a ticket panel (existing tickets are untouched).')
      .addIntegerOption((o) => o.setName('id').setDescription('Panel ID (see /ticket-panel list)').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const panels = await tickets.listPanels(interaction.guildId);
      if (!panels.length) {
        return interaction.reply({ embeds: [infoEmbed('🎫 Ticket panels', 'No extra panels yet — the default panel from `/ticket-setup` is the only one. Create one with `/ticket-panel create`.')] });
      }
      const fields = panels.map((p) => ({
        name: `#${p.id} — ${p.title}`,
        value: `Category: ${p.category_id ? `<#${p.category_id}>` : 'default'} · Staff role: ${p.staff_role_id ? `<@&${p.staff_role_id}>` : 'default'} · Posted in <#${p.channel_id}>${p.message_id ? ` · [jump](https://discord.com/channels/${interaction.guildId}/${p.channel_id}/${p.message_id})` : ''}`,
      }));
      return interaction.reply({  embeds: [infoEmbed('🎫 Ticket panels', 'Each panel opens tickets in its own category with its own staff role.', fields)] });
    }
    if (sub === 'delete') {
      const id = interaction.options.getInteger('id');
      const panel = await tickets.deletePanel(interaction.guildId, id);
      if (!panel) return interaction.reply({ embeds: [errorEmbed('Not found', `No ticket panel #${id} in this server.`)] });
      return interaction.reply({  embeds: [successEmbed('Panel deleted', `🎫 **${panel.title}** (#${id}) has been deleted. Tickets already opened from it are untouched.`)] });
    }
    // create
    const title = interaction.options.getString('title');
    const category = interaction.options.getChannel('category');
    const staffRole = interaction.options.getRole('staff_role');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const description = interaction.options.getString('description');
    if (!channel?.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Invalid channel', 'Pick a text channel for the panel.')] });
    const panel = await tickets.createPanel(interaction.guildId, {
      channelId: channel.id,
      categoryId: category?.id || null,
      staffRoleId: staffRole?.id || null,
      title,
      description,
      createdBy: interaction.user.id,
    });
    if (!panel) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Ticket panels need MySQL — connect the database first.')] });
    const message = await channel.send({ embeds: [tickets.ticketPanelEmbed(title, description)], components: [tickets.ticketPanelRow(panel.id)] }).catch(() => null);
    if (message) {
      const db = require('../../utils/database');
      await db.query('UPDATE ticket_panels SET message_id = ? WHERE id = ?', [message.id, panel.id]).catch(() => {});
    }
    return interaction.reply({  embeds: [successEmbed('Ticket panel created', `🎫 **${title}** (#${panel.id}) is live in <#${channel.id}>${category ? ` — tickets go to **${category.name}**` : ''}${staffRole ? `, staffed by **${staffRole.name}**` : ''}.`)] });
  },
};

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { setGuildSettings } = require('../../utils/guildSettings');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set this server\'s welcome channel, log channel, and ticket settings (admin only).')
    .addChannelOption((o) => o.setName('welcome_channel').setDescription('Channel for welcome messages'))
    .addChannelOption((o) => o.setName('log_channel').setDescription('Channel for moderation logs'))
    .addChannelOption((o) => o.setName('ticket_category').setDescription('Category new ticket channels are created under'))
    .addChannelOption((o) => o.setName('ticket_log_channel').setDescription('Channel for ticket transcripts/close logs'))
    .addRoleOption((o) => o.setName('ticket_support_role').setDescription('Role that can see and claim tickets'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const patch = {};
    const welcome = interaction.options.getChannel('welcome_channel');
    const log = interaction.options.getChannel('log_channel');
    const cat = interaction.options.getChannel('ticket_category');
    const tlog = interaction.options.getChannel('ticket_log_channel');
    const role = interaction.options.getRole('ticket_support_role');
    if (welcome) patch.welcomeChannelId = welcome.id;
    if (log) patch.logChannelId = log.id;
    if (cat) patch.ticketCategoryId = cat.id;
    if (tlog) patch.ticketLogChannelId = tlog.id;
    if (role) patch.ticketSupportRoleId = role.id;
    if (!Object.keys(patch).length) {
      return interaction.reply({ embeds: [errorEmbed('Nothing to set', 'Give at least one option, e.g. /setup welcome_channel:#general log_channel:#mod-logs')], ephemeral: true });
    }
    const { saved, settings } = await setGuildSettings(interaction.guildId, patch);
    const lines = [
      `Welcome channel: ${settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : 'not set'}`,
      `Log channel: ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'not set'}`,
      `Ticket category: ${settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : 'not set'}`,
      `Ticket log channel: ${settings.ticketLogChannelId ? `<#${settings.ticketLogChannelId}>` : 'not set'}`,
      `Ticket support role: ${settings.ticketSupportRoleId ? `<@&${settings.ticketSupportRoleId}>` : 'not set'}`,
    ];
    if (!saved) lines.push('\n⚠️ MySQL is not connected, so these settings are only kept in memory for this run — connect the database to make /setup permanent.');
    return interaction.reply({ embeds: [successEmbed('Server setup saved', lines.join('\n'))] });
  },
};

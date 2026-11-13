const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const slowmode = require('../../utils/slowmode');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode-schedule-remove')
    .setDescription('Admin: remove a channel slowmode schedule.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Slowmode schedules need MySQL.')], ephemeral: true });
    if (!interaction.memberPermissions?.has('ManageChannels')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Channels to use slowmode settings.')], ephemeral: true });
    }
    const channel = interaction.options.getChannel('channel');
    await slowmode.removeSchedule(interaction.guildId, channel.id);
    return interaction.reply({ embeds: [successEmbed('Schedule removed', `Slowmode schedule removed for <#${channel.id}>. The current slowmode stays as-is until changed.`)], ephemeral: true });
  },
};

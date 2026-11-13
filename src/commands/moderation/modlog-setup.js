const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { setPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modlog-setup')
    .setDescription('Admin only: set the channel for deleted/edited message logs.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to post message logs in (empty = turn off)').addChannelTypes(ChannelType.GuildText))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Message logging only works in a server.')], ephemeral: true });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to set the modlog channel.')], ephemeral: true });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so settings can\'t be saved right now.')], ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    const { saved } = await setPremiumSettings(interaction.guildId, { modlogChannelId: channel ? channel.id : '' });
    if (!saved) return interaction.reply({ embeds: [errorEmbed('Not saved', 'Settings were kept in memory only — MySQL is not connected.')], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Modlog updated', channel ? `Deleted and edited messages will be logged in ${channel}.` : 'Message logging is now off.')], ephemeral: true });
  },
};

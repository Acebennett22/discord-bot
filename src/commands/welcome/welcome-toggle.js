const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome-toggle')
    .setDescription('Admin only: enable or disable welcome messages.')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn welcome messages on or off').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')], ephemeral: true });
    }
    const enabled = interaction.options.getBoolean('enabled');
    const { settings } = await setGuildSettings(interaction.guildId, { welcomeEnabled: enabled });
    if (!settings.welcomeChannelId) {
      return interaction.reply({ embeds: [successEmbed('Welcome messages ' + (enabled ? 'enabled' : 'disabled'), 'No welcome channel is set yet — run /welcome-setup to pick one.')], ephemeral: true });
    }
    return interaction.reply({ embeds: [successEmbed('Welcome messages ' + (enabled ? 'enabled' : 'disabled'), `Welcomes in <#${settings.welcomeChannelId}> are now ${enabled ? '✅ on' : '❌ off'}.`)], ephemeral: true });
  },
};

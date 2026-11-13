const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('goodbye-toggle')
    .setDescription('Admin only: enable or disable goodbye messages.')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn goodbye messages on or off').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')], ephemeral: true });
    }
    const enabled = interaction.options.getBoolean('enabled');
    const { settings } = await setGuildSettings(interaction.guildId, { goodbyeEnabled: enabled });
    if (!settings.goodbyeChannelId) {
      return interaction.reply({ embeds: [successEmbed('Goodbye messages ' + (enabled ? 'enabled' : 'disabled'), 'No goodbye channel is set yet — run /goodbye-setup to pick one.')], ephemeral: true });
    }
    return interaction.reply({ embeds: [successEmbed('Goodbye messages ' + (enabled ? 'enabled' : 'disabled'), `Goodbyes in <#${settings.goodbyeChannelId}> are now ${enabled ? '✅ on' : '❌ off'}.`)], ephemeral: true });
  },
};

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed } = require('../../utils/embeds');
const { setGuildSettings, getGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-toggle')
    .setDescription('Admin only: turn the verification gate on or off.')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enable the verification gate?').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const enabled = interaction.options.getBoolean('enabled');
    await setGuildSettings(interaction.guildId, { verificationEnabled: enabled });
    const settings = await getGuildSettings(interaction.guildId);
    if (enabled && !settings.verificationChannelId) {
      return interaction.reply({ embeds: [successEmbed('Verification enabled', '⚠️ No verification channel is set yet — run /verify-setup first, or new members will have nowhere to verify.')], ephemeral: true });
    }
    return interaction.reply({ embeds: [successEmbed('Verification updated', `The verification gate is now **${enabled ? 'enabled' : 'disabled'}**.`)], ephemeral: true });
  },
};

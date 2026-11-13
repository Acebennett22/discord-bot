const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getGuildSettings } = require('../../utils/guildSettings');
const { verifyPanelComponents } = require('../../utils/verification');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify yourself in this server — get the verified role.'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Verification only works in a server.')], ephemeral: true });
    const settings = await getGuildSettings(interaction.guildId);
    if (!settings.verificationEnabled) {
      return interaction.reply({ embeds: [errorEmbed('Verification isn\'t set up', 'This server doesn\'t have verification enabled yet — ask an admin to run `/verify-setup`.')], ephemeral: true });
    }
    const roleId = settings.verificationRoleId || '';
    if (roleId && interaction.member.roles.cache.has(roleId)) {
      return interaction.reply({ embeds: [successEmbed('Already verified', 'You already have the verified role — you\'re good to go.')], ephemeral: true });
    }
    const where = settings.verificationChannelId ? `<#${settings.verificationChannelId}>` : 'the verification channel';
    return interaction.reply({
      embeds: [infoEmbed('Verify yourself', `Click the **Verify** button below${settings.verificationMode === 'captcha' ? ' and answer the quick math question' : ''} to get access to the server.\n\n(You can also verify in ${where}.)`)],
      components: verifyPanelComponents(),
      ephemeral: true,
    });
  },
};

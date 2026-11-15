const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getGuildSettings, DEFAULT_WELCOME_MESSAGE } = require('../../utils/guildSettings');
const { formatMessage, sendWelcome } = require('../../utils/welcome');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome-test')
    .setDescription('Admin only: send a preview welcome message for yourself.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')] });
    }
    const settings = await getGuildSettings(interaction.guildId);
    if (!settings.welcomeChannelId) {
      return interaction.reply({ embeds: [errorEmbed('Not set up', 'No welcome channel is set yet — run /welcome-setup first.')] });
    }
    if (!settings.welcomeEnabled) {
      return interaction.reply({ embeds: [errorEmbed('Welcomes disabled', 'Welcome messages are toggled off — run /welcome-toggle enabled:true first.')] });
    }
    const result = await sendWelcome(interaction.member);
    if (!result.sent) {
      return interaction.reply({ embeds: [errorEmbed('Could not send', `I couldn't post in <#${settings.welcomeChannelId}> — check my permissions there.`)] });
    }
    const preview = formatMessage(settings.welcomeMessage || DEFAULT_WELCOME_MESSAGE, interaction.member);
    return interaction.reply({
      embeds: [infoEmbed('👋 Welcome preview sent', `Posted a welcome for you in <#${settings.welcomeChannelId}>:\n\n${preview.slice(0, 1500)}`)],
    });
  },
};

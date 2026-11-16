// Verification gate interactions: the Verify button and the captcha modal.
const { MessageFlags, Events } = require('discord.js');
const { getGuildSettings } = require('../utils/guildSettings');
const { grantVerification, openCaptchaModal, answerCaptcha } = require('../utils/verification');
const { errorEmbed, successEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Captcha modal submit.
    if (interaction.isModalSubmit() && interaction.customId === 'verify:captcha') {
      return answerCaptcha(interaction);
    }
    if (!interaction.isButton() || interaction.customId !== 'verify:btn') return;
    const settings = await getGuildSettings(interaction.guildId);
    if (!settings.verificationEnabled) {
      return interaction.reply({ embeds: [errorEmbed('Verification is off', 'The verification gate is not enabled in this server.')], flags: MessageFlags.Ephemeral });
    }
    const roleId = settings.verificationRoleId;
    if (roleId && interaction.member.roles.cache.has(roleId)) {
      return interaction.reply({ embeds: [successEmbed('Already verified', 'You already have the verified role.')], flags: MessageFlags.Ephemeral });
    }
    if (settings.verificationMode === 'captcha') {
      return openCaptchaModal(interaction);
    }
    const result = await grantVerification(interaction.member, 'button');
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not verify', result.reason)], flags: MessageFlags.Ephemeral });
    return interaction.reply({ embeds: [successEmbed('Verified!', `✅ You're verified — the **${result.role.name}** role was granted. Welcome!`)], flags: MessageFlags.Ephemeral });
  },
};

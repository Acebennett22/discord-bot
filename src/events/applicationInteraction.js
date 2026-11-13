// Handles application flows: /apply select menu + modals, form-creation modal,
// and Accept/Deny review buttons in the review channel.
const {
  Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const apps = require('../utils/applications');
const { getGuildSettings } = require('../utils/guildSettings');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const db = require('../utils/database');

function textRow(id, label, required = true) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Paragraph).setRequired(required).setMaxLength(1000),
  );
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // --- /apply form picker ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'apply_pick_form') {
      const form = await apps.getForm(parseInt(interaction.values[0], 10), interaction.guildId);
      if (!form || !form.is_open) return interaction.reply({ embeds: [errorEmbed('Form closed', 'That form is no longer open.')], ephemeral: true });
      const { applyModal } = require('../commands/applications/apply');
      return interaction.showModal(applyModal(form));
    }

    // --- Create-form modal (from /application-create) ---
    if (interaction.isModalSubmit() && interaction.customId.startsWith('app_create_modal:')) {
      const [, roleId, reviewChannelId] = interaction.customId.split(':');
      const name = interaction.fields.getTextInputValue('name').trim();
      const description = interaction.fields.getTextInputValue('description')?.trim() || '';
      const questions = apps.parseQuestions(interaction.fields.getTextInputValue('questions'));
      if (!questions.length) return interaction.reply({ embeds: [errorEmbed('No questions', 'Add at least one question (one per line).')], ephemeral: true });
      const formId = await apps.createForm({
        guildId: interaction.guildId, name, description, questions,
        roleToGrant: roleId === 'none' ? null : roleId, reviewChannelId, createdBy: interaction.user.id,
      });
      return interaction.reply({ embeds: [successEmbed('Application form created',
        `**${name}** (ID #${formId}) is open.\n${questions.length} question(s) · reviews go to <#${reviewChannelId}>${roleId !== 'none' ? ` · grants <@&${roleId}> on accept` : ''}\nMembers can now use /apply.`)] });
    }

    // --- Apply modal submit ---
    if (interaction.isModalSubmit() && interaction.customId.startsWith('apply_submit:')) {
      const formId = parseInt(interaction.customId.split(':')[1], 10);
      const form = await apps.getForm(formId, interaction.guildId);
      if (!form || !form.is_open) return interaction.reply({ embeds: [errorEmbed('Form closed', 'That form is no longer open.')], ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const answers = form.questions.map((_, i) => interaction.fields.getTextInputValue(`q${i}`) || '');
      const appId = await apps.submitApplication(form, interaction.user.id, answers);
      const app = await apps.getApplication(appId, interaction.guildId);
      const channel = interaction.guild.channels.cache.get(form.review_channel_id)
        || await interaction.guild.channels.fetch(form.review_channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [apps.reviewEmbed(form, app, interaction.user.tag)], components: [apps.reviewRow(appId)] }).catch(() => {});
      }
      return interaction.editReply({ embeds: [successEmbed('Application submitted', `Your application for **${form.name}** was sent for review (application #${appId}). Use /application-status to check on it.`)] });
    }

    // --- Review buttons ---
    if (interaction.isButton() && (interaction.customId.startsWith('app_accept:') || interaction.customId.startsWith('app_deny:'))) {
      const [action, appIdRaw] = interaction.customId.split(':');
      const appId = parseInt(appIdRaw, 10);
      const settings = await getGuildSettings(interaction.guildId);
      if (!apps.isReviewer(interaction.member, settings)) {
        return interaction.reply({ embeds: [errorEmbed('No permission', 'Only admins or the application reviewer role can review applications.')], ephemeral: true });
      }
      if (action === 'app_deny') {
        const modal = new ModalBuilder().setCustomId(`app_deny_modal:${appId}`).setTitle('Deny application');
        modal.addComponents(textRow('reason', 'Denial reason (sent to the applicant)', false));
        return interaction.showModal(modal);
      }
      await interaction.deferReply({ ephemeral: true });
      const app = await apps.getApplication(appId, interaction.guildId);
      if (!app) return interaction.editReply({ embeds: [errorEmbed('Not found', 'That application no longer exists.')] });
      const form = await apps.getForm(app.form_id, interaction.guildId);
      const result = await apps.reviewApplication(interaction.guild, form, app, 'accepted', interaction.user, null);
      if (!result.ok) return interaction.editReply({ embeds: [errorEmbed('Already reviewed', result.error)] });
      return interaction.editReply({ embeds: [successEmbed('Application accepted', `Application #${app.id} (<@${app.user_id}>) for **${form.name}** was accepted${form.role_to_grant ? ' and the role was granted' : ''}.`)] });
    }

    // --- Deny-reason modal ---
    if (interaction.isModalSubmit() && interaction.customId.startsWith('app_deny_modal:')) {
      const appId = parseInt(interaction.customId.split(':')[1], 10);
      const reason = interaction.fields.getTextInputValue('reason')?.trim() || '';
      await interaction.deferReply({ ephemeral: true });
      const app = await apps.getApplication(appId, interaction.guildId);
      if (!app) return interaction.editReply({ embeds: [errorEmbed('Not found', 'That application no longer exists.')] });
      const form = await apps.getForm(app.form_id, interaction.guildId);
      const result = await apps.reviewApplication(interaction.guild, form, app, 'denied', interaction.user, reason);
      if (!result.ok) return interaction.editReply({ embeds: [errorEmbed('Already reviewed', result.error)] });
      return interaction.editReply({ embeds: [successEmbed('Application denied', `Application #${app.id} (<@${app.user_id}>) for **${form.name}** was denied${reason ? `: ${reason}` : ''}.`)] });
    }
  },
};

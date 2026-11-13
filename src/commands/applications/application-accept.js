const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const apps = require('../../utils/applications');
const { getGuildSettings } = require('../../utils/guildSettings');
module.exports = {
  data: new SlashCommandBuilder().setName('application-accept').setDescription('Staff: accept an application by ID.')
    .addIntegerOption((o) => o.setName('application_id').setDescription('Application ID').setRequired(true))
    .addStringOption((o) => o.setName('note').setDescription('Optional note sent to the applicant'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    if (!apps.isReviewer(interaction.member, settings)) return interaction.reply({ embeds: [errorEmbed('No permission', 'Only admins or the application reviewer role can review applications.')], ephemeral: true });
    const app = await apps.getApplication(interaction.options.getInteger('application_id'), interaction.guildId);
    if (!app) return interaction.reply({ embeds: [errorEmbed('Not found', 'No application with that ID in this server.')], ephemeral: true });
    const form = await apps.getForm(app.form_id, interaction.guildId);
    const result = await apps.reviewApplication(interaction.guild, form, app, 'accepted', interaction.user, interaction.options.getString('note'));
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Already reviewed', result.error)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Application accepted', `Application #${app.id} (<@${app.user_id}>) for **${form.name}** was accepted${form.role_to_grant ? ' and the role was granted' : ''}. The applicant was DM'd.`)] });
  },
};

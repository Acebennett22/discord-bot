const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed } = require('../../utils/embeds');
const apps = require('../../utils/applications');
const { getGuildSettings } = require('../../utils/guildSettings');
module.exports = {
  data: new SlashCommandBuilder().setName('application-view').setDescription('Staff: view one full application.')
    .addIntegerOption((o) => o.setName('application_id').setDescription('Application ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    if (!apps.isReviewer(interaction.member, settings)) return interaction.reply({ embeds: [errorEmbed('No permission', 'Only admins or the application reviewer role can view applications.')] });
    const app = await apps.getApplication(interaction.options.getInteger('application_id'), interaction.guildId);
    if (!app) return interaction.reply({ embeds: [errorEmbed('Not found', 'No application with that ID in this server.')] });
    const form = await apps.getForm(app.form_id, interaction.guildId);
    const embed = apps.reviewEmbed(form, app, '—');
    embed.setTitle(`📝 Application #${app.id} — ${form.name} · ${app.status}`);
    return interaction.reply({ embeds: [embed] });
  },
};

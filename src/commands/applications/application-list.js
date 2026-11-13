const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const apps = require('../../utils/applications');
const { getGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder().setName('application-list').setDescription('Staff: list application forms and their pending counts.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    if (!apps.isReviewer(interaction.member, settings)) return interaction.reply({ embeds: [errorEmbed('No permission', 'Only admins or the application reviewer role can list forms.')], ephemeral: true });
    const forms = await apps.listForms(interaction.guildId);
    if (!forms.length) return interaction.reply({ embeds: [infoEmbed('Application forms', 'No forms yet. Create one with /application-create or on the dashboard Applications tab.')] });
    return interaction.reply({ embeds: [infoEmbed('Application forms', forms.map((f) =>
      `**#${f.id} — ${f.name}** ${f.is_open ? '🟢 open' : '🔴 closed'}\n${f.pending_count} pending · ${f.total_count} total · reviews in <#${f.review_channel_id}>${f.role_to_grant ? ` · grants <@&${f.role_to_grant}>` : ''}`).join('\n\n'))] });
  },
};

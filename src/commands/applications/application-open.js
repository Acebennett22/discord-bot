const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const apps = require('../../utils/applications');
module.exports = {
  data: new SlashCommandBuilder().setName('application-open').setDescription('Admin only: open an application form.')
    .addIntegerOption((o) => o.setName('form_id').setDescription('Form ID (see /application-list)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const form = await apps.getForm(interaction.options.getInteger('form_id'), interaction.guildId);
    if (!form) return interaction.reply({ embeds: [errorEmbed('Not found', 'No form with that ID in this server.')], ephemeral: true });
    await apps.setFormOpen(form.id, interaction.guildId, true);
    return interaction.reply({ ephemeral: true, embeds: [successEmbed('Form opened', `**${form.name}** is now open — members can /apply.`)] });
  },
};

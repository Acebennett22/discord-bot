const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const apps = require('../../utils/applications');
module.exports = {
  data: new SlashCommandBuilder().setName('application-close').setDescription('Admin only: close an application form.')
    .addIntegerOption((o) => o.setName('form_id').setDescription('Form ID (see /application-list)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const form = await apps.getForm(interaction.options.getInteger('form_id'), interaction.guildId);
    if (!form) return interaction.reply({ embeds: [errorEmbed('Not found', 'No form with that ID in this server.')], ephemeral: true });
    await apps.setFormOpen(form.id, interaction.guildId, false);
    return interaction.reply({ embeds: [successEmbed('Form closed', `**${form.name}** is now closed — /apply will no longer offer it.`)] });
  },
};

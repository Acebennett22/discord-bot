const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { removeColorRole, getColorRoles } = require('../../utils/colorRoles');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('color-remove-role')
    .setDescription('Admin only: unregister a color role.')
    .addRoleOption((o) => o.setName('role').setDescription('Color role to unregister').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Color roles need MySQL.')] });
    const role = interaction.options.getRole('role');
    const roles = await getColorRoles(interaction.guildId);
    if (!roles.some((r) => r.role_id === role.id)) {
      return interaction.reply({ embeds: [errorEmbed('Not a color role', `**${role.name}** isn't registered as a color role.`)] });
    }
    await removeColorRole(interaction.guildId, role.id);
    return interaction.reply({ embeds: [successEmbed('Color role removed', `🎨 **${role.name}** is no longer a self-assignable color role.`)] });
  },
};

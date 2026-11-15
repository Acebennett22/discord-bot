const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { addColorRole, botCanManageRole } = require('../../utils/colorRoles');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('color-add')
    .setDescription('Admin only: register an existing role as a color role.')
    .addRoleOption((o) => o.setName('role').setDescription('Role to register (must have a non-default color)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Color roles need MySQL.')] });
    const role = interaction.options.getRole('role');
    if (role.color === 0) {
      return interaction.reply({ embeds: [errorEmbed('Role has no color', `**${role.name}** has the default (no) color. Give it a color in Server Settings → Roles first.`)] });
    }
    const check = botCanManageRole(interaction.guild, role);
    if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Bot cannot manage this role', check.reason)] });
    const hex = `#${role.hexColor.slice(1)}`;
    await addColorRole(interaction.guildId, role.id, hex, role.name);
    return interaction.reply({ embeds: [successEmbed('Color role added', `🎨 **${role.name}** (${hex}) is now a self-assignable color role. Members use /color set.`)] });
  },
};

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, statsEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getPremiumSettings, setPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Admin only: manage the role given to new members, and sticky roles.')
    .addSubcommand((s) => s.setName('set').setDescription('Set the auto-role for new members')
      .addRoleOption((o) => o.setName('role').setDescription('Role to give on join').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Turn off the auto-role'))
    .addSubcommand((s) => s.setName('view').setDescription('Show the current auto-role and sticky-role settings'))
    .addSubcommand((s) => s.setName('sticky').setDescription('Turn sticky roles on or off')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Restore roles when a member rejoins?').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Auto-role only works in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to manage auto-role.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so settings can\'t be saved right now.')] });
    const sub = interaction.options.getSubcommand();
    const settings = await getPremiumSettings(interaction.guildId);

    if (sub === 'set') {
      const role = interaction.options.getRole('role');
      const me = interaction.guild.members.me;
      if (role.position >= me.roles.highest.position) {
        return interaction.reply({ embeds: [errorEmbed('Role too high', `I can't assign **${role.name}** — it's above my highest role. Move my role above it and try again.`)] });
      }
      const { saved } = await setPremiumSettings(interaction.guildId, { autoroleId: role.id });
      if (!saved) return interaction.reply({ embeds: [errorEmbed('Not saved', 'Settings were kept in memory only — MySQL is not connected.')] });
      return interaction.reply({ embeds: [successEmbed('Auto-role set', `New members will automatically get the ${role} role when they join.`)] });
    }
    if (sub === 'remove') {
      const { saved } = await setPremiumSettings(interaction.guildId, { autoroleId: '' });
      if (!saved) return interaction.reply({ embeds: [errorEmbed('Not saved', 'Settings were kept in memory only — MySQL is not connected.')] });
      return interaction.reply({ embeds: [successEmbed('Auto-role removed', 'New members will no longer get a role automatically.')] });
    }
    if (sub === 'sticky') {
      const enabled = interaction.options.getBoolean('enabled');
      const { saved } = await setPremiumSettings(interaction.guildId, { stickyRolesEnabled: enabled });
      if (!saved) return interaction.reply({ embeds: [errorEmbed('Not saved', 'Settings were kept in memory only — MySQL is not connected.')] });
      return interaction.reply({ embeds: [successEmbed('Sticky roles updated', enabled ? 'When a member leaves, their roles are saved — and restored if they rejoin.' : 'Sticky roles are off. Roles will no longer be saved/restored on rejoin.')] });
    }
    // view
    const auto = settings.autoroleId ? `<@&${settings.autoroleId}>` : '— none —';
    return interaction.reply({ embeds: [statsEmbed('Auto-role settings', `**Auto-role:** ${auto}\n**Sticky roles:** ${settings.stickyRolesEnabled ? '✅ on' : '❌ off'}`)] });
  },
};

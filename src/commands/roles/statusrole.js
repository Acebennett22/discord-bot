const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const statusRoles = require('../../utils/statusRoles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('statusrole')
    .setDescription('Give a role to members whose custom status contains certain text.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles) // before subcommands (loader-safe order)
    .addSubcommand((s) => s.setName('add').setDescription('Admin: add a status → role rule.')
      .addStringOption((o) => o.setName('text').setDescription('Text to look for in the custom status').setRequired(true).setMaxLength(128))
      .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Admin: remove a status rule.')
      .addStringOption((o) => o.setName('text').setDescription('Trigger text of the rule to remove').setRequired(true).setMaxLength(128)))
    .addSubcommand((s) => s.setName('list').setDescription('List status role rules.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Status roles need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rules = await statusRoles.getStatusRoles(interaction.guildId);
      if (!rules.length) return interaction.reply({ embeds: [infoEmbed('🎭 Status roles', 'No status role rules yet. Add one with /statusrole add.')] });
      const lines = rules.map((r) => `Status contains **"${r.trigger_text}"** → <@&${r.role_id}>`);
      return interaction.reply({ embeds: [infoEmbed('🎭 Status roles', `${lines.join('\n')}\n\n_Note: roles update when Discord sends a presence update, so there can be a short delay. A sweep runs every 10 minutes to catch missed updates._`)] });
    }
    if (!interaction.memberPermissions?.has('ManageRoles')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Roles to change status role rules.')] });
    }
    const text = interaction.options.getString('text').toLowerCase();
    if (sub === 'add') {
      const role = interaction.options.getRole('role');
      const botHighest = interaction.guild.members.me?.roles.highest;
      if (botHighest && role.position >= botHighest.position) {
        return interaction.reply({ embeds: [errorEmbed('Role too high', 'That role sits above my highest role — I cannot grant it. Move my role higher or pick a lower role.')] });
      }
      if (role.managed) return interaction.reply({ embeds: [errorEmbed('Managed role', 'That role is managed by an integration and cannot be granted by the bot.')] });
      await statusRoles.addStatusRole(interaction.guildId, text, role.id, interaction.user.id);
      // Apply immediately to members already matching.
      const members = await interaction.guild.members.fetch().catch(() => null);
      if (members) {
        for (const m of members.values()) await statusRoles.applyStatusRoles(m).catch(() => {});
      }
      return interaction.reply({ embeds: [successEmbed('Status role added', `Members whose custom status contains **"${text}"** will now get <@&${role.id}>. It is removed again when the status stops matching.`)] });
    }
    // remove
    const removed = await statusRoles.removeStatusRole(interaction.guildId, text);
    if (!removed) return interaction.reply({ embeds: [infoEmbed('Not found', `No status role rule for **"${text}"**.`)] });
    return interaction.reply({ embeds: [successEmbed('Status role removed', `The rule for **"${text}"** is gone. Members keep the role unless another rule grants it.`)] });
  },
};

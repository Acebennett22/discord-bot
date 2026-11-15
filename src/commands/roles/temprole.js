const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { parseDuration, grantTempRole, getActiveTempRoles, removeTempRole } = require('../../utils/tempRoles');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temprole')
    .setDescription('Grant a role temporarily (auto-removed at expiry).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) => s.setName('give').setDescription('Grant a temporary role.')
      .addUserOption((o) => o.setName('user').setDescription('Member to give the role to').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('How long (e.g. 24h, 7d)').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false).setMaxLength(255)))
    .addSubcommand((s) => s.setName('list').setDescription('List active temporary roles in this server.'))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a temporary role early.')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true))),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Temporary roles need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = await getActiveTempRoles(interaction.guildId);
      if (!rows.length) return interaction.reply({ embeds: [infoEmbed('Temporary roles', 'No active temporary roles in this server.')] });
      const lines = rows.map((r) => `<@${r.user_id}> — <@&${r.role_id}> until <t:${Math.floor(new Date(r.expires_at).getTime() / 1000)}:R>`);
      return interaction.reply({ embeds: [infoEmbed('⏳ Active temporary roles', lines.join('\n'))] });
    }
    if (sub === 'give') {
      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      const ms = parseDuration(interaction.options.getString('duration'));
      if (!ms) return interaction.reply({ embeds: [errorEmbed('Invalid duration', 'Use a duration like 24h or 7d (up to 365 days).')] });
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ embeds: [errorEmbed('Member not found', 'That user is not in this server.')] });
      if (member.roles.cache.has(role.id)) return interaction.reply({ embeds: [errorEmbed('Already has the role', `<@${user.id}> already has **${role.name}**.`)] });
      const result = await grantTempRole(interaction.guild, member, role, ms, interaction.user, interaction.options.getString('reason'));
      if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not grant role', result.error)] });
      return interaction.reply({ embeds: [successEmbed('Temporary role granted', `⏳ **${role.name}** given to <@${user.id}> until <t:${Math.floor(result.expiresAt.getTime() / 1000)}:R>.`)] });
    }
    // remove
    const user = interaction.options.getUser('user');
    const role = interaction.options.getRole('role');
    const rows = await db.query('SELECT * FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ? AND removed = 0', [interaction.guildId, user.id, role.id]);
    if (!rows?.length) return interaction.reply({ embeds: [errorEmbed('Not a temp role', `**${role.name}** isn't an active temporary role for <@${user.id}>.`)] });
    await removeTempRole(interaction.guild, user.id, role.id, { early: true });
    return interaction.reply({ embeds: [successEmbed('Temporary role removed', `**${role.name}** was removed from <@${user.id}> early.`)] });
  },
};

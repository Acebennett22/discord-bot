const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { listRules, addRule, removeRule } = require('../../utils/inviteRoles');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');

function cleanCode(raw) {
  return (raw || '').trim().replace(/^https?:\/\/(www\.)?discord\.gg\//i, '').replace(/^discord\.gg\//i, '').split(/[/?#]/)[0];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inviterole')
    .setDescription('Admin only: grant a role automatically to members who join via a specific invite link.')
    .addSubcommand((s) => s.setName('add').setDescription('Map an invite code to a role.')
      .addStringOption((o) => o.setName('code').setDescription('Invite code or full discord.gg link').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role to grant on join via this invite').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List all invite-code → role rules.'))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a rule.')
      .addStringOption((o) => o.setName('code').setDescription('Invite code to remove the rule for').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rules = await listRules(interaction.guildId);
      if (!rules.length) {
        return interaction.reply({ embeds: [infoEmbed('📨 Invite role rules', 'No rules yet. Add one with `/inviterole add <code> <role>` — members who join via that invite link get the role automatically.')], ephemeral: true });
      }
      const fields = rules.map((r) => ({
        name: `discord.gg/${r.invite_code}`,
        value: `→ <@&${r.role_id}>`,
      }));
      return interaction.reply({ ephemeral: true, embeds: [infoEmbed('📨 Invite role rules', 'Joining via one of these invite links grants the matching role.', fields)] });
    }
    if (sub === 'remove') {
      const code = cleanCode(interaction.options.getString('code'));
      const removed = await removeRule(interaction.guildId, code);
      if (!removed) return interaction.reply({ embeds: [errorEmbed('Not found', `No rule for invite code \`${code}\`.`)], ephemeral: true });
      return interaction.reply({ ephemeral: true, embeds: [successEmbed('Rule removed', `Members joining via \`discord.gg/${code}\` no longer get <@&${removed.role_id}>.`)] });
    }
    // add
    const code = cleanCode(interaction.options.getString('code'));
    const role = interaction.options.getRole('role');
    if (!code) return interaction.reply({ embeds: [errorEmbed('Invalid code', 'Give a real invite code or a discord.gg link.')], ephemeral: true });
    // The code must be a real invite in this guild.
    const invites = await interaction.guild.invites.fetch().catch(() => null);
    if (!invites || !invites.has(code)) {
      return interaction.reply({ embeds: [errorEmbed('Invite not found', `\`discord.gg/${code}\` is not an active invite in this server. Create the invite first, then add the rule.`)], ephemeral: true });
    }
    const me = interaction.guild.members.me;
    if (me && role.position >= me.roles.highest.position) {
      return interaction.reply({ embeds: [errorEmbed('Role too high', `I can't grant **${role.name}** — it is above my highest role. Move my role above it first.`)], ephemeral: true });
    }
    const rule = await addRule(interaction.guildId, code, role.id, interaction.user.id);
    if (!rule) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Invite role rules need MySQL — connect the database first.')], ephemeral: true });
    return interaction.reply({ ephemeral: true, embeds: [successEmbed('Rule added', `Members who join via \`discord.gg/${code}\` will now automatically get <@&${role.id}>.`)] });
  },
};

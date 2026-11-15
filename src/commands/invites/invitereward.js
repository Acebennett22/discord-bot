const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const inviteRewards = require('../../utils/inviteRewards');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invitereward')
    .setDescription('Manage invite milestones that grant a role or coins.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // before subcommands (loader-safe order)
    .addSubcommand((s) => s.setName('add').setDescription('Admin: add an invite milestone reward.')
      .addIntegerOption((o) => o.setName('invites').setDescription('Valid invites needed').setRequired(true).setMinValue(1).setMaxValue(10000))
      .addStringOption((o) => o.setName('type').setDescription('Reward type').setRequired(true).addChoices({ name: 'Role', value: 'role' }, { name: 'Coins', value: 'coins' }))
      .addRoleOption((o) => o.setName('role').setDescription('Role to grant (for type Role)'))
      .addIntegerOption((o) => o.setName('coins').setDescription('Coins to grant (for type Coins)').setMinValue(1).setMaxValue(1000000)))
    .addSubcommand((s) => s.setName('list').setDescription('List invite milestone rewards.'))
    .addSubcommand((s) => s.setName('remove').setDescription('Admin: remove an invite milestone.')
      .addIntegerOption((o) => o.setName('invites').setDescription('Milestone to remove').setRequired(true).setMinValue(1))),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Invite rewards need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rewards = await inviteRewards.getInviteRewards(interaction.guildId);
      if (!rewards.length) return interaction.reply({ embeds: [infoEmbed('🎉 Invite rewards', 'No invite milestones set. Add one with /invitereward add.')] });
      const lines = rewards.map((r) => `**${r.invites_required} invites** → ${r.reward_type === 'role' ? `<@&${r.role_id}>` : `**${r.coins} coins**`}`);
      return interaction.reply({ embeds: [infoEmbed('🎉 Invite rewards', `${lines.join('\n')}\n\nRewards grant automatically when a member's valid invite count reaches a milestone (once per milestone).`)] });
    }
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Server to change invite rewards.')] });
    }
    if (sub === 'add') {
      const invites = interaction.options.getInteger('invites');
      const type = interaction.options.getString('type');
      const role = interaction.options.getRole('role');
      const coins = interaction.options.getInteger('coins');
      if (type === 'role' && !role) return interaction.reply({ embeds: [errorEmbed('Missing role', 'Pick a role to grant for the Role reward type.')] });
      if (type === 'coins' && !coins) return interaction.reply({ embeds: [errorEmbed('Missing coins', 'Give a coin amount for the Coins reward type.')] });
      if (type === 'role') {
        const botHighest = interaction.guild.members.me?.roles.highest;
        if (botHighest && role.position >= botHighest.position) {
          return interaction.reply({ embeds: [errorEmbed('Role too high', 'That role sits above my highest role — I cannot grant it.')] });
        }
      }
      await inviteRewards.addInviteReward(interaction.guildId, invites, type, role?.id || null, coins || null, interaction.user.id);
      return interaction.reply({ embeds: [successEmbed('Invite reward added', `At **${invites} valid invites** members will earn ${type === 'role' ? `<@&${role.id}>` : `**${coins} coins**`}.`)] });
    }
    const removed = await inviteRewards.removeInviteReward(interaction.guildId, interaction.options.getInteger('invites'));
    if (!removed) return interaction.reply({ embeds: [infoEmbed('Not found', 'No milestone at that invite count.')] });
    return interaction.reply({ embeds: [successEmbed('Invite reward removed', 'That milestone no longer grants a reward.')] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getUserInviteStats } = require('../../utils/inviteTracker');
const inviteRewards = require('../../utils/inviteRewards');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myinviterewards')
    .setDescription('See your invite progress and the next milestone reward.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Invite rewards need MySQL.')], ephemeral: true });
    const stats = await getUserInviteStats(interaction.guildId, interaction.user.id);
    const valid = stats?.valid_invites || 0;
    const rewards = await inviteRewards.getInviteRewards(interaction.guildId);
    const earned = rewards.filter((r) => valid >= r.invites_required);
    const next = await inviteRewards.nextInviteReward(interaction.guildId, valid);
    const lines = [
      `You have **${valid} valid invite${valid === 1 ? '' : 's'}** (${stats?.total_invites || 0} total, ${stats?.leaves || 0} left).`,
    ];
    if (earned.length) lines.push(`\n**Earned:** ${earned.map((r) => `${r.invites_required} → ${r.reward_type === 'role' ? `<@&${r.role_id}>` : `${r.coins} coins`}`).join(', ')}`);
    if (next) {
      lines.push(`\n**Next milestone:** ${next.invites_required} invites → ${next.reward_type === 'role' ? `<@&${next.role_id}>` : `**${next.coins} coins**`} (${next.invites_required - valid} to go)`);
    } else if (rewards.length) {
      lines.push('\n🎉 You have reached every invite milestone!');
    } else {
      lines.push('\nNo invite milestones are set up in this server yet.');
    }
    return interaction.reply({ embeds: [infoEmbed('🎉 Your invite rewards', lines.join('\n'))], ephemeral: true });
  },
};

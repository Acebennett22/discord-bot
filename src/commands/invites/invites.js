const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const { getUserInviteStats } = require('../../utils/inviteTracker');

module.exports = {
  data: new SlashCommandBuilder().setName('invites').setDescription('Show invite stats for yourself or another member.')
    .addUserOption((o) => o.setName('user').setDescription('Member to check (defaults to you)')),
  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const stats = await getUserInviteStats(interaction.guildId, user.id);
    if (!stats) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Invite stats are stored in MySQL.')] });
    return interaction.reply({  embeds: [infoEmbed(`📨 Invite stats — ${user.tag}`,
      `**Total invites:** ${stats.total_invites}\n**Valid invites:** ${stats.valid_invites}\n**Leaves:** ${stats.leaves}\n**Fake invites:** ${stats.fake_invites}\n\nValid = joined and still here, from an account older than the fake threshold (default 7 days).`)] });
  },
};

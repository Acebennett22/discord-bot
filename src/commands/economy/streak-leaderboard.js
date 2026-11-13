const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getStreakLeaderboard } = require('../../utils/streaks');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('streak-leaderboard')
    .setDescription('Top 10 daily streaks in this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Streaks need MySQL.')], ephemeral: true });
    const rows = await getStreakLeaderboard(interaction.guildId, 10);
    if (!rows.length) return interaction.reply({ embeds: [infoEmbed('Streak leaderboard', 'Nobody has a daily streak yet — claim /daily to start one!')], ephemeral: true });
    const lines = await Promise.all(rows.map(async (r, i) => {
      const member = await interaction.guild.members.fetch(r.user_id).catch(() => null);
      return `**${i + 1}.** ${member ? member.user.tag : `<@${r.user_id}>`} — 🔥 ${r.daily_streak} days (best ${r.best_streak})`;
    }));
    return interaction.reply({ embeds: [infoEmbed('🔥 Daily Streak Leaderboard', lines.join('\n'))], ephemeral: true });
  },
};

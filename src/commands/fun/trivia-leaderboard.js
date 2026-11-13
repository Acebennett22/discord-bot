const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getTriviaLeaderboard } = require('../../utils/dailyTrivia');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trivia-leaderboard')
    .setDescription('Top daily-trivia players in this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Daily trivia needs MySQL.')], ephemeral: true });
    const rows = await getTriviaLeaderboard(interaction.guildId, 10);
    if (!rows.length) return interaction.reply({ embeds: [infoEmbed('🧠 Trivia leaderboard', 'No one has won a daily trivia yet. Play with /trivia-daily!')], ephemeral: true });
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, i) => `${medals[i] || `${i + 1}.`} <@${r.user_id}> — **${r.points}** point${r.points === 1 ? '' : 's'} (${r.wins} win${r.wins === 1 ? '' : 's'})`);
    return interaction.reply({ embeds: [infoEmbed('🧠 Trivia leaderboard', lines.join('\n'))], ephemeral: true });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const wordle = require('../../utils/wordle');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wordle-leaderboard')
    .setDescription('Top Wordle players in this server (best streaks and wins).'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Wordle needs MySQL.')], ephemeral: true });
    const rows = await wordle.getWordleLeaderboard(interaction.guildId, 10);
    if (!rows.length) return interaction.reply({ embeds: [infoEmbed('🟩 Wordle leaderboard', 'Nobody has played Wordle here yet — try /wordle!')], ephemeral: true });
    const lines = rows.map((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      return `${medal} <@${r.user_id}> — best streak **${r.best_streak}** · **${r.wins}** win${r.wins === 1 ? '' : 's'} in ${r.games} game${r.games === 1 ? '' : 's'}`;
    });
    return interaction.reply({ embeds: [infoEmbed('🟩 Wordle leaderboard', lines.join('\n'))], ephemeral: true });
  },
};

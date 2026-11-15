const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getVoiceLeaderboard } = require('../../utils/voiceXp');
const db = require('../../utils/database');

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voicelb')
    .setDescription('Top 10 users by total voice time in this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Voice stats need MySQL.')] });
    const rows = await getVoiceLeaderboard(interaction.guildId, 10);
    if (!rows.length) return interaction.reply({ embeds: [infoEmbed('Voice leaderboard', 'Nobody has logged voice time yet.')] });
    const lines = await Promise.all(rows.map(async (r, i) => {
      const member = await interaction.guild.members.fetch(r.user_id).catch(() => null);
      return `**${i + 1}.** ${member ? member.user.tag : `<@${r.user_id}>`} — ${fmtMinutes(r.total_minutes)} in voice (${r.sessions} sessions)`;
    }));
    return interaction.reply({ embeds: [infoEmbed('🎙️ Voice Time Leaderboard', lines.join('\n'))] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const { getLeaderboard } = require('../../utils/leveling');
const { getVoiceLeaderboard } = require('../../utils/voiceXp');

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top 10 members by XP or voice time in this server.')
    .addStringOption((o) => o.setName('sort').setDescription('Sort by XP (default) or voice time').addChoices(
      { name: 'XP', value: 'xp' },
      { name: 'Voice time', value: 'voice' },
    )),
  async execute(interaction) {
    const sort = interaction.options.getString('sort') || 'xp';
    if (sort === 'voice') {
      const rows = await getVoiceLeaderboard(interaction.guildId, 10);
      if (!rows) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Leveling needs MySQL — connect the database first.')] });
      if (!rows.length) return interaction.reply({  embeds: [infoEmbed('Voice leaderboard', 'Nobody has logged voice time yet.')] });
      const lines = await Promise.all(rows.map(async (r, i) => {
        const member = await interaction.guild.members.fetch(r.user_id).catch(() => null);
        return `**${i + 1}.** ${member ? member.user.tag : `<@${r.user_id}>`} — ${fmtMinutes(r.total_minutes)} in voice (${r.sessions} sessions)`;
      }));
      return interaction.reply({  embeds: [infoEmbed('🎙️ Voice Time Leaderboard', lines.join('\n'))] });
    }
    const rows = await getLeaderboard(interaction.guildId, 10);
    if (!rows) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Leveling needs MySQL — connect the database first.')] });
    if (!rows.length) return interaction.reply({  embeds: [infoEmbed('Leaderboard', 'Nobody has earned XP yet — start chatting!')] });
    const lines = await Promise.all(rows.map(async (r, i) => {
      const member = await interaction.guild.members.fetch(r.user_id).catch(() => null);
      return `**${i + 1}.** ${member ? member.user.tag : `<@${r.user_id}>`} — Level ${r.level} · ${r.xp} XP`;
    }));
    return interaction.reply({  embeds: [infoEmbed('🏆 XP Leaderboard', lines.join('\n'))] });
  },
};

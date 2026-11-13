const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const { getLeaderboard } = require('../../utils/leveling');

module.exports = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 members by XP in this server.'),
  async execute(interaction) {
    const rows = await getLeaderboard(interaction.guildId, 10);
    if (!rows) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Leveling needs MySQL — connect the database first.')], ephemeral: true });
    if (!rows.length) return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Leaderboard', 'Nobody has earned XP yet — start chatting!')] });
    const lines = await Promise.all(rows.map(async (r, i) => {
      const member = await interaction.guild.members.fetch(r.user_id).catch(() => null);
      return `**${i + 1}.** ${member ? member.user.tag : `<@${r.user_id}>`} — Level ${r.level} · ${r.xp} XP`;
    }));
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed('🏆 XP Leaderboard', lines.join('\n'))] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { getPrestigeLeaderboard, prestigeMultiplier } = require('../../utils/leveling');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('prestige-leaderboard')
    .setDescription('Show the top prestige users in this server.'),
  async execute(interaction) {
    const rows = await getPrestigeLeaderboard(interaction.guildId, 10);
    if (!rows?.length) {
      return interaction.reply({ embeds: [infoEmbed('⭐ Prestige leaderboard', 'Nobody has prestiged in this server yet. Reach the max level and run `/prestige` to be the first.')], ephemeral: true });
    }
    const fields = rows.map((r, i) => ({
      name: `#${i + 1} — <@${r.user_id}>`,
      value: `⭐ Prestige **${r.prestige}** · x${prestigeMultiplier(r.prestige).toFixed(1)} XP · level ${r.level} (${r.xp} XP)`,
    }));
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed('⭐ Prestige leaderboard', 'Top prestiged members in this server.', fields)] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getSettings } = require('../../utils/counting');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting-leaderboard')
    .setDescription('Top counters in this server, plus the current and highest count.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Counting needs MySQL.')] });
    const settings = await getSettings(interaction.guildId);
    const rows = await db.query(
      'SELECT user_id, correct_counts FROM counting_counts WHERE guild_id = ? ORDER BY correct_counts DESC, user_id ASC LIMIT 10',
      [interaction.guildId],
    ) || [];
    const current = settings?.current_count ?? 0;
    const highest = settings?.highest_count ?? 0;
    const header = `**Current count:** ${current}\n**Highest count:** ${highest}\n**Counting channel:** ${settings?.channel_id ? `<#${settings.channel_id}>` : 'not set (use /counting-setup)'}`;
    if (!rows.length) {
      return interaction.reply({ embeds: [infoEmbed('🔢 Counting leaderboard', `${header}\n\nNo one has counted correctly yet. Be the first!`)] });
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, i) => `${medals[i] || `${i + 1}.`} <@${r.user_id}> — **${r.correct_counts}** correct count${r.correct_counts === 1 ? '' : 's'}`);
    return interaction.reply({ embeds: [infoEmbed('🔢 Counting leaderboard', `${header}\n\n${lines.join('\n')}`)] });
  },
};

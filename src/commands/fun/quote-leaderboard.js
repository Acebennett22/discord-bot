const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quote-leaderboard')
    .setDescription('Most-quoted users in this server (top 10 by quote count).'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Quotes need MySQL.')] });
    const rows = await db.query('SELECT author_id, COUNT(*) AS c FROM quotes WHERE guild_id = ? GROUP BY author_id ORDER BY c DESC LIMIT 10', [interaction.guildId]);
    if (!rows?.length) return interaction.reply({ embeds: [infoEmbed('Quote leaderboard', 'No quotes saved in this server yet. Use /quote to save one.')] });
    const lines = await Promise.all(rows.map(async (r, i) => {
      const user = await interaction.client.users.fetch(r.author_id).catch(() => null);
      return `**${i + 1}.** ${user ? user.tag : `<@${r.author_id}>`} — ${r.c} quote${r.c === 1 ? '' : 's'}`;
    }));
    return interaction.reply({ embeds: [infoEmbed('💬 Quote leaderboard', lines.join('\n'))] });
  },
};

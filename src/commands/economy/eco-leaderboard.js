const { SlashCommandBuilder } = require('discord.js');
const { statsEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eco-leaderboard')
    .setDescription('Top 10 richest members in this server (wallet + bank).'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Economy only works in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected, so the leaderboard is unavailable right now.')], ephemeral: true });
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    const rows = await db.query('SELECT user_id, balance, bank FROM economy_users WHERE guild_id = ? ORDER BY (balance + bank) DESC LIMIT 10', [interaction.guildId]) || [];
    if (!rows.length) return interaction.reply({ embeds: [statsEmbed('💰 Richest members', 'Nobody has earned any coins yet — try /daily or /work!')], ephemeral: true });
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, i) => `${medals[i] || `#${i + 1}`} <@${r.user_id}> — **${r.balance + r.bank} ${name}** (${r.balance} wallet / ${r.bank} bank)`);
    return interaction.reply({ embeds: [statsEmbed('💰 Richest members', lines.join('\n'))], ephemeral: true });
  },
};

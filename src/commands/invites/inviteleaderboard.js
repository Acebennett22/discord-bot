const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('inviteleaderboard').setDescription('Top 10 inviters in this server.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Invite stats are stored in MySQL.')], ephemeral: true });
    const rows = await db.query(
      'SELECT user_id, total_invites, valid_invites, leaves, fake_invites FROM user_invites WHERE guild_id = ? ORDER BY valid_invites DESC, total_invites DESC LIMIT 10',
      [interaction.guildId]) || [];
    if (!rows.length) return interaction.reply({ embeds: [infoEmbed('Invite leaderboard', 'No invites tracked yet — invite tracking starts once the bot is running with Manage Server permission.')] });
    const medals = ['🥇', '🥈', '🥉'];
    return interaction.reply({ embeds: [infoEmbed('🏆 Invite leaderboard', rows.map((r, i) =>
      `${medals[i] || `${i + 1}.`} <@${r.user_id}> — **${r.valid_invites}** valid (${r.total_invites} total, ${r.leaves} left, ${r.fake_invites} fake)`).join('\n'))] });
  },
};

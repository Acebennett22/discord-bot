const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
module.exports = {
  data: new SlashCommandBuilder().setName('application-status').setDescription('See the status of your own applications.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Applications are stored in MySQL.')], ephemeral: true });
    const rows = await db.query(
      `SELECT a.*, f.name AS form_name FROM applications a JOIN application_forms f ON f.id = a.form_id
       WHERE a.guild_id = ? AND a.user_id = ? ORDER BY a.id DESC LIMIT 10`,
      [interaction.guildId, interaction.user.id]) || [];
    if (!rows.length) return interaction.reply({ embeds: [infoEmbed('Your applications', 'You have not submitted any applications in this server yet. Use /apply.')], ephemeral: true });
    const icon = { pending: '⏳', accepted: '✅', denied: '❌' };
    return interaction.reply({ embeds: [infoEmbed('Your applications', rows.map((r) =>
      `${icon[r.status] || ''} **#${r.id} — ${r.form_name}** — ${r.status}${r.review_note ? `\nNote: ${r.review_note}` : ''}`).join('\n\n'))], ephemeral: true });
  },
};

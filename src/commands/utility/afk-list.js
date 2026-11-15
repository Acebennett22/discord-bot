const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk-list')
    .setDescription('List everyone currently AFK in this server.'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'AFK only works in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so the AFK list can\'t be shown right now.')] });
    const rows = await db.query(
      'SELECT user_id, reason, since FROM afk_users WHERE guild_id = ? ORDER BY since ASC LIMIT 25',
      [interaction.guildId],
    ) || [];
    if (!rows.length) {
      return interaction.reply({ embeds: [infoEmbed('💤 AFK list', 'Nobody is AFK right now. Use `/afk` to mark yourself away.')] });
    }
    const lines = rows.map((r) => {
      const since = Math.floor(new Date(r.since).getTime() / 1000);
      return `<@${r.user_id}> — away since <t:${since}:R>${r.reason ? `\n> ${String(r.reason).slice(0, 200)}` : ''}`;
    });
    const extra = rows.length === 25 ? '\n\n*(Showing the first 25.)*' : '';
    return interaction.reply({ embeds: [infoEmbed(`💤 AFK list (${rows.length})`, `${lines.join('\n\n')}${extra}`)] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('botstats').setDescription('Show bot statistics from the database (commands, songs, uptime).'),
  async execute(interaction) {
    if (!db.isEnabled()) {
      return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'MySQL is not connected, so stored stats are unavailable.\nBot uptime is still: ' + Math.floor(interaction.client.uptime / 1000) + 's. Check config.json `database` and run sql/schema.sql.')], ephemeral: true });
    }
    const stats = await db.getGlobalStats();
    if (!stats) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Could not read stats from MySQL right now.')], ephemeral: true });
    const top = stats.topCommands.length
      ? stats.topCommands.map((c, i) => `**${i + 1}.** /${c.command_name} — ${c.uses}`).join('\n')
      : 'No commands logged yet.';
    const uptimeS = Math.floor(interaction.client.uptime / 1000);
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Bot statistics', [
      `**Total commands used:** ${stats.totalCommands}`,
      `**Successful:** ${stats.successes}`,
      `**Songs played:** ${stats.songsPlayed}`,
      `**Guilds tracked:** ${stats.guilds} · **Users tracked:** ${stats.users}`,
      `**Bot uptime:** ${Math.floor(uptimeS / 3600)}h ${Math.floor((uptimeS % 3600) / 60)}m`,
      '',
      '**Top commands:**',
      top,
    ].join('\n'))] });
  },
};

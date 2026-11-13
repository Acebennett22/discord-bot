const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const { requireOwner } = require('../../utils/ownerCheck');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('globalstats').setDescription('Owner only: global totals across all servers.'),
  async execute(interaction) {
    if (!(await requireOwner(interaction))) return;
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'MySQL is not connected, so global stats are unavailable.')], ephemeral: true });
    const stats = await db.getGlobalStats();
    if (!stats) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Could not read stats from MySQL right now.')], ephemeral: true });
    return interaction.reply({ embeds: [infoEmbed('Global statistics', [
      `**Total commands used:** ${stats.totalCommands}`,
      `**Successful:** ${stats.successes}`,
      `**Songs played:** ${stats.songsPlayed}`,
      `**Guilds tracked:** ${stats.guilds} · **Users tracked:** ${stats.users}`,
      '',
      '**Top commands:**',
      stats.topCommands.length ? stats.topCommands.map((c, i) => `**${i + 1}.** /${c.command_name} — ${c.uses}`).join('\n') : 'None yet.',
    ].join('\n'))], ephemeral: true });
  },
};

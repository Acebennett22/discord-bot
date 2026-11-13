const { SlashCommandBuilder } = require('discord.js');
const os = require('os');
const { infoEmbed } = require('../../utils/embeds');
const { version: BOT_VERSION } = require('../../../package.json');

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

module.exports = {
  data: new SlashCommandBuilder().setName('status').setDescription('Show bot and host status (memory, uptime, guilds).'),
  async execute(interaction) {
    const client = interaction.client;
    const mem = process.memoryUsage();
    const embed = infoEmbed('Bot status', [
      `**Bot version:** v${BOT_VERSION}`,
      `**Bot uptime:** ${formatUptime(client.uptime)}`,
      `**Host uptime:** ${formatUptime(os.uptime() * 1000)}`,
      `**Guilds:** ${client.guilds.cache.size}`,
      `**Users (cached):** ${client.users.cache.size}`,
      `**Memory:** ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB heap / ${(mem.rss / 1024 / 1024).toFixed(1)} MB RSS`,
      `**Node:** ${process.version} on ${os.platform()} ${os.arch()}`,
      `**Ping:** ${client.ws.ping}ms`,
    ].join('\n'));
    return interaction.reply({ ephemeral: true, embeds: [embed] });
  },
};

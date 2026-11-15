const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${m}m ${sec}s`;
}

module.exports = {
  data: new SlashCommandBuilder().setName('uptime').setDescription('Show how long the bot has been online.'),
  async execute(interaction) {
    return interaction.reply({  embeds: [infoEmbed('Uptime', `I've been online for **${formatUptime(interaction.client.uptime)}**.`)] });
  },
};

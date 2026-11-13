const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const heist = require('../../utils/heist');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('heist')
    .setDescription('Start a group heist — crew up, beat the odds, split the payout.')
    .addIntegerOption((o) => o.setName('bet').setDescription('Your buy-in in coins (wallet)').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Heists need MySQL.')], ephemeral: true });
    const bet = interaction.options.getInteger('bet');
    const result = await heist.startHeist(interaction, bet);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not start heist', result.error)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Heist started!', `💰 Your heist lobby is posted in <#${interaction.channelId}> — the crew has 60 seconds to join.`)], ephemeral: true });
  },
};

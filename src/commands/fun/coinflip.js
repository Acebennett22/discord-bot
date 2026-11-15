const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin.'),
  async execute(interaction) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return interaction.reply({  embeds: [infoEmbed('🪙 Coin flip', `The coin landed on **${result}**!`)] });
  },
};

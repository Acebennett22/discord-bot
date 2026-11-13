const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Roll dice.')
    .addIntegerOption((o) => o.setName('sides').setDescription('Sides per die (default 6)').setMinValue(2).setMaxValue(100))
    .addIntegerOption((o) => o.setName('count').setDescription('Number of dice (default 1)').setMinValue(1).setMaxValue(10)),
  async execute(interaction) {
    const sides = interaction.options.getInteger('sides') || 6;
    const count = interaction.options.getInteger('count') || 1;
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed('🎲 Dice roll', `Rolled **${count}d${sides}**: ${rolls.join(', ')}\n**Total: ${total}**`)] });
  },
};

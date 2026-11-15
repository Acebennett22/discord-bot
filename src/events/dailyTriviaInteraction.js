// Daily trivia button answers — customId dtrivia:<guildId>:<date>:<optionIdx>
const { Events } = require('discord.js');
const { infoEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { answerDaily } = require('../utils/dailyTrivia');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('dtrivia:')) return;
    const [, guildId, dateStr, idxStr] = interaction.customId.split(':');
    const result = await answerDaily(interaction, guildId, dateStr, Number(idxStr)).catch(() => null);
    if (!result) return interaction.reply({ embeds: [errorEmbed('Trivia error', 'Something went wrong — try again.')] });
    if (result.status === 'correct') return interaction.reply({ embeds: [successEmbed('Correct!', result.message)], ephemeral: true });
    if (result.status === 'wrong') return interaction.reply({ embeds: [infoEmbed('🧠 Daily trivia', result.message)], ephemeral: true });
    return interaction.reply({ embeds: [infoEmbed('🧠 Daily trivia', result.message)], ephemeral: true });
  },
};

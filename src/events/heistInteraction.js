// Heist join button — customId heist_join:<heistId>
const { Events } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { joinHeist } = require('../utils/heist');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('heist_join:')) return;
    const heistId = Number(interaction.customId.split(':')[1]);
    const result = await joinHeist(interaction, heistId).catch(() => null);
    if (!result) return interaction.reply({ embeds: [errorEmbed('Heist error', 'Something went wrong — try again.')], ephemeral: true });
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed("Couldn't join heist", result.error)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('You\'re in!', `💰 You joined the heist with a **${result.bet} coin** buy-in. Good luck!`)], ephemeral: true });
  },
};

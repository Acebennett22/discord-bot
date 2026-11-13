const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

const CHOICES = ['rock', 'paper', 'scissors'];
const EMOJI = { rock: '🪨 Rock', paper: '📄 Paper', scissors: '✂️ Scissors' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Play rock, paper, scissors against the bot.')
    .addStringOption((o) => o.setName('choice').setDescription('Your move').setRequired(true)
      .addChoices(
        { name: 'Rock', value: 'rock' },
        { name: 'Paper', value: 'paper' },
        { name: 'Scissors', value: 'scissors' },
      )),
  async execute(interaction) {
    const user = interaction.options.getString('choice');
    const bot = CHOICES[Math.floor(Math.random() * CHOICES.length)];
    let result;
    if (user === bot) result = "It's a draw!";
    else if ((user === 'rock' && bot === 'scissors') || (user === 'paper' && bot === 'rock') || (user === 'scissors' && bot === 'paper')) result = 'You win! 🎉';
    else result = 'I win! 😎';
    return interaction.reply({ ephemeral: true, embeds: [infoEmbed('Rock, Paper, Scissors', `You: ${EMOJI[user]}\nMe: ${EMOJI[bot]}\n**${result}**`)] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../../utils/embeds');

const ANSWERS = [
  'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.',
  'Ask again later.', 'Cannot predict now.', 'Don\'t count on it.',
  'My reply is no.', 'Very doubtful.', 'Signs point to yes.', 'Outlook not so good.',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a question.')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
  async execute(interaction) {
    const question = interaction.options.getString('question');
    const answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    return interaction.reply({  embeds: [infoEmbed('🎱 Magic 8-ball', `**Q:** ${question}\n**A:** ${answer}`)] });
  },
};

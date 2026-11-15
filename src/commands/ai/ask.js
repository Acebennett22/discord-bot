const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { askAI, isAiConfigured } = require('../../utils/ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI a question.')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!isAiConfigured()) {
      return interaction.reply({ embeds: [errorEmbed('AI not set up', 'The server owner needs to add an OpenAI API key in config.json (ai.apiKey). Any OpenAI-compatible endpoint works — see README.')] });
    }
    await interaction.deferReply();
    const result = await askAI({
      guildId: interaction.guildId,
      guildName: interaction.guild?.name,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      question: interaction.options.getString('question'),
    });
    if (!result.ok) return interaction.editReply({ embeds: [errorEmbed('AI error', result.error)] });
    return interaction.editReply({ embeds: [infoEmbed('💬 AI answer', result.reply)] });
  },
};

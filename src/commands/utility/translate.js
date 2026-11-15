const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const translate = require('../../utils/translate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text into another language.')
    .addStringOption((o) => o.setName('text').setDescription('Text to translate').setRequired(true).setMaxLength(1000))
    .addStringOption((o) => o.setName('to').setDescription('Target language code (e.g. es, fr, de) — default: en').setMaxLength(5)),
  async execute(interaction) {
    const text = interaction.options.getString('text');
    const to = (interaction.options.getString('to') || 'en').toLowerCase();
    if (!translate.SUPPORTED[to]) {
      return interaction.reply({ embeds: [errorEmbed('Unsupported language', `Supported codes: ${Object.keys(translate.SUPPORTED).join(', ')}.`)] });
    }
    await interaction.deferReply();
    try {
      const detected = translate.detectLanguage(text);
      const result = await translate.translateText(text, to);
      if (detected === to) {
        return interaction.editReply({ embeds: [infoEmbed('🌐 Translate', `That text already looks like ${translate.SUPPORTED[to]} — nothing to translate.`) ] });
      }
      return interaction.editReply({ embeds: [infoEmbed('🌐 Translation',
        `${translate.FLAG[detected] || ''} **Original (${translate.SUPPORTED[detected] || detected}):** ${text}\n\n${translate.FLAG[to] || ''} **${translate.SUPPORTED[to]}:** ${result.translated}`)] });
    } catch (e) {
      return interaction.editReply({ embeds: [errorEmbed('Translation failed', 'The translation service did not respond — try again in a bit.')] });
    }
  },
};

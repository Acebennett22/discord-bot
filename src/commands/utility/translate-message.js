const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const translate = require('../../utils/translate');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Translate message')
    .setType(ApplicationCommandType.Message),
  async execute(interaction) {
    const message = interaction.targetMessage;
    const text = (message?.content || '').trim();
    if (!message || !text) {
      return interaction.reply({ embeds: [errorEmbed('Nothing to translate', 'That message has no text to translate.')], ephemeral: true });
    }
    // Guild target language comes from the auto-translate settings
    // (translate_settings.target_lang, set via /translate-setup); English
    // when nothing is configured or the database is unavailable.
    let target = 'en';
    try {
      const settings = await translate.getTranslateSettings(interaction.guildId);
      if (settings?.target_lang && translate.SUPPORTED[settings.target_lang]) target = settings.target_lang;
    } catch {}
    const truncated = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
    await interaction.deferReply({ ephemeral: true });
    try {
      const detected = translate.detectLanguage(text);
      if (detected === target) {
        return interaction.editReply({ embeds: [infoEmbed('🌐 Translate message', `That message already looks like ${translate.SUPPORTED[target]} — nothing to translate.`)] });
      }
      const result = await translate.translateText(text, target);
      return interaction.editReply({ embeds: [infoEmbed('🌐 Translation',
        `${translate.FLAG[detected] || ''} **Original (${translate.SUPPORTED[detected] || detected}):** ${truncated(text, 1500)}\n\n${translate.FLAG[target] || ''} **${translate.SUPPORTED[target]}:** ${truncated(result.translated, 1500)}`)] });
    } catch (e) {
      return interaction.editReply({ embeds: [errorEmbed('Translation failed', 'The translation service did not respond — try again in a bit.')] });
    }
  },
};

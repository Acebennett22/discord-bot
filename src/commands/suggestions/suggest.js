const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { errorEmbed } = require('../../utils/embeds');
const { getGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Submit a suggestion for this server (modal: title + details).'),
  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    if (!settings.suggestionChannelId) {
      return interaction.reply({ embeds: [errorEmbed('Suggestions not set up', 'No suggestions channel is configured — an admin needs to run /suggestions-setup first.')], ephemeral: true });
    }
    const modal = new ModalBuilder().setCustomId('suggest_submit').setTitle('Submit a suggestion');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Suggestion title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('details').setLabel('Details').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000),
      ),
    );
    return interaction.showModal(modal);
  },
};

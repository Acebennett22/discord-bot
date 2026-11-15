const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { errorEmbed } = require('../../utils/embeds');
const { getGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confess')
    .setDescription('Submit an anonymous confession.'),
  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    if (!settings.confessionsEnabled) {
      return interaction.reply({ embeds: [errorEmbed('Confessions disabled', 'Confessions are not enabled in this server.')] });
    }
    const modal = new ModalBuilder()
      .setCustomId('confess_submit')
      .setTitle('Anonymous confession');
    const input = new TextInputBuilder()
      .setCustomId('confession_text')
      .setLabel('Your confession (anonymous)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(5)
      .setMaxLength(2000)
      .setPlaceholder('Type your confession here — nobody will see who wrote it.');
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },
};

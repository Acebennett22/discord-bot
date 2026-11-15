const {
  SlashCommandBuilder, PermissionFlagsBits,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const { errorEmbed } = require('../../utils/embeds');
const { getRules, MAX_TITLE_LENGTH, MAX_CONTENT_LENGTH } = require('../../utils/serverRules');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rules-edit')
    .setDescription('Admin only: edit the server rules (updates the posted message in place).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to edit server rules.')] });
    }
    const existing = await getRules(interaction.guildId);
    if (!existing) {
      return interaction.reply({ embeds: [errorEmbed('No rules set', 'There are no rules to edit yet — run /rules-setup to create them first.')] });
    }
    const modal = new ModalBuilder()
      .setCustomId('rules_edit_modal')
      .setTitle('Edit server rules');
    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Rules title')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(MAX_TITLE_LENGTH)
      .setValue(existing.title.slice(0, MAX_TITLE_LENGTH));
    const rulesInput = new TextInputBuilder()
      .setCustomId('rules')
      .setLabel('Rules (one per line, up to 5)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_CONTENT_LENGTH)
      .setValue(existing.content.slice(0, MAX_CONTENT_LENGTH));
    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(rulesInput),
    );
    return interaction.showModal(modal);
  },
};

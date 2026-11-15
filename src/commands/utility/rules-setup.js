const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const { errorEmbed } = require('../../utils/embeds');
const { getRules, MAX_TITLE_LENGTH, MAX_CONTENT_LENGTH } = require('../../utils/serverRules');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rules-setup')
    .setDescription('Admin only: post the server rules embed (re-running edits the existing message).')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to post the rules in').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to set up server rules.')] });
    }
    const channel = interaction.options.getChannel('channel');
    const existing = await getRules(interaction.guildId);
    const modal = new ModalBuilder()
      .setCustomId(`rules_setup_modal:${channel.id}`)
      .setTitle(existing ? 'Edit server rules' : 'Set up server rules');
    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Rules title')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(MAX_TITLE_LENGTH)
      .setPlaceholder('Server Rules');
    if (existing?.title) titleInput.setValue(existing.title.slice(0, MAX_TITLE_LENGTH));
    const rulesInput = new TextInputBuilder()
      .setCustomId('rules')
      .setLabel('Rules (one per line, up to 5)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_CONTENT_LENGTH)
      .setPlaceholder('1. Be respectful to everyone.\n2. No spam or advertising.\n3. ...');
    if (existing?.content) rulesInput.setValue(existing.content.slice(0, MAX_CONTENT_LENGTH));
    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(rulesInput),
    );
    return interaction.showModal(modal);
  },
};

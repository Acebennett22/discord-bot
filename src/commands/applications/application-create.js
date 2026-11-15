const { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('application-create')
    .setDescription('Admin only: create an application form (name, description, up to 5 questions).')
    .addChannelOption((o) => o.setName('review_channel').setDescription('Channel where submissions are posted for review').setRequired(true))
    .addRoleOption((o) => o.setName('role_to_grant').setDescription('Role granted when an application is accepted (optional)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Applications are stored in MySQL — connect the database first.')] });
    const reviewChannel = interaction.options.getChannel('review_channel');
    const role = interaction.options.getRole('role_to_grant');
    const modal = new ModalBuilder()
      .setCustomId(`app_create_modal:${role?.id || 'none'}:${reviewChannel.id}`)
      .setTitle('Create application form');
    const row = (id, label, style, required = true, placeholder = '') => new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setPlaceholder(placeholder).setMaxLength(id === 'questions' ? 1000 : 200),
    );
    modal.addComponents(
      row('name', 'Form name', TextInputStyle.Short, true, 'e.g. Staff Application'),
      row('description', 'Description', TextInputStyle.Paragraph, false, 'What is this application for?'),
      row('questions', 'Questions (one per line, max 5)', TextInputStyle.Paragraph, true, 'Why do you want to join?\nHow much experience do you have?'),
    );
    return interaction.showModal(modal);
  },
};

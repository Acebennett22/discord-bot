const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { DEFAULT_TEMPLATE, getTemplate, setTemplate, renderTemplate } = require('../../utils/liveChannelTemplate');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream-template')
    .setDescription('Admin only: view or set this server\'s live-channel name template.')
    .addSubcommand((s) => s.setName('view').setDescription('Show the current template and a preview.'))
    .addSubcommand((s) => s.setName('set').setDescription('Set a new template (must contain {name}, max 100 chars).')
      .addStringOption((o) => o.setName('template').setDescription('e.g. 🔴 LIVE: {name} — {game}').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('reset').setDescription('Go back to the default template.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') {
      const tpl = await getTemplate(interaction.guildId);
      return interaction.reply({ embeds: [infoEmbed('Live channel name template',
        `**Current:** \`${tpl}\`\n**Preview:** \`${renderTemplate(tpl, { name: 'ExampleStreamer', game: 'Just Chatting', title: 'Chilling with chat' })}\`\n\nPlaceholders: \`{name}\` (required), \`{game}\`, \`{title}\`. Max 100 characters, one line.\nSet it with \`/stream-template set\` or on the dashboard Streams tab — both read the same database field.`)], ephemeral: true });
    }
    if (sub === 'reset') {
      const { setGuildSettings } = require('../../utils/guildSettings');
      await setGuildSettings(interaction.guildId, { liveChannelNameTemplate: '' });
      return interaction.reply({ embeds: [successEmbed('Template reset', `Back to the default: \`${DEFAULT_TEMPLATE}\``)] });
    }
    const template = interaction.options.getString('template');
    const result = await setTemplate(interaction.guildId, template);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Invalid template', result.error)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Template saved',
      `New template: \`${template}\`\nPreview: \`${renderTemplate(template, { name: 'ExampleStreamer', game: 'Just Chatting', title: 'Chilling with chat' })}\``)] });
  },
};

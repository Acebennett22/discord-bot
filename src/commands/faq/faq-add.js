const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { sanitizeResponse, invalidateFaqs } = require('../../utils/faq');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('faq-add')
    .setDescription('Admin only: add an FAQ auto-response.')
    .addStringOption((o) => o.setName('trigger').setDescription('Phrase that triggers the response').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('response').setDescription('What the bot replies with').setRequired(true).setMaxLength(2000))
    .addStringOption((o) => o.setName('match_type').setDescription('How the trigger matches (default: contains)')
      .addChoices({ name: 'contains — phrase appears anywhere', value: 'contains' }, { name: 'exact — whole message equals the phrase', value: 'exact' }))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'FAQ responses only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to add FAQ responses.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so FAQ responses can\'t be saved right now.')] });
    const trigger = interaction.options.getString('trigger').trim();
    const response = sanitizeResponse(interaction.options.getString('response'));
    const matchType = interaction.options.getString('match_type') || 'contains';
    const count = await db.query('SELECT COUNT(*) AS c FROM faq_responses WHERE guild_id = ?', [interaction.guildId]);
    if ((count?.[0]?.c || 0) >= 50) {
      return interaction.reply({ embeds: [errorEmbed('FAQ limit reached', 'This server already has 50 FAQ responses — remove one before adding another.')] });
    }
    await db.query(
      'INSERT INTO faq_responses (guild_id, trigger_phrase, response, match_type, created_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE response = VALUES(response), match_type = VALUES(match_type), created_by = VALUES(created_by)',
      [interaction.guildId, trigger, response, matchType, interaction.user.id],
    );
    invalidateFaqs(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('FAQ added', `When someone writes **${trigger}** (${matchType} match), I'll reply:\n> ${response.slice(0, 500)}`)] });
  },
};

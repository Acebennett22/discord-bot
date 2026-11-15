const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { statsEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('faq-list')
    .setDescription('Admin/staff only: list this server\'s FAQ auto-responses.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'FAQ responses only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to list FAQ responses.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected right now.')] });
    const rows = await db.query('SELECT trigger_phrase, response, match_type, use_count FROM faq_responses WHERE guild_id = ? ORDER BY created_at ASC', [interaction.guildId]) || [];
    if (!rows.length) return interaction.reply({ embeds: [statsEmbed('FAQ responses', 'No FAQ responses yet — add one with /faq-add.')] });
    const lines = rows.map((r) => `**${r.trigger_phrase}** (${r.match_type}) — used ${r.use_count}×\n> ${r.response.slice(0, 200)}`);
    return interaction.reply({ embeds: [statsEmbed(`FAQ responses (${rows.length}/50)`, lines.join('\n\n').slice(0, 4000))] });
  },
};

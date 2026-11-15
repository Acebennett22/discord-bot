const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { statsEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('custom-list')
    .setDescription('Admin/staff only: list this server\'s custom commands.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Custom commands only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to list custom commands.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected right now.')] });
    const rows = await db.query('SELECT trigger_word, response, use_count FROM custom_commands WHERE guild_id = ? ORDER BY trigger_word', [interaction.guildId]) || [];
    if (!rows.length) return interaction.reply({ embeds: [statsEmbed('Custom commands', 'No custom commands yet — add one with /custom-add.')] });
    const lines = rows.map((r) => `**${r.trigger_word}** — used ${r.use_count}×\n> ${r.response.slice(0, 200)}`);
    return interaction.reply({ embeds: [statsEmbed(`Custom commands (${rows.length})`, lines.join('\n\n').slice(0, 4000))] });
  },
};

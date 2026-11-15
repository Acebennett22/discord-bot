const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('custom-remove')
    .setDescription('Admin only: remove a custom trigger-word command.')
    .addStringOption((o) => o.setName('trigger').setDescription('Trigger word to remove').setRequired(true).setMaxLength(64))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Custom commands only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to remove custom commands.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected right now.')] });
    const trigger = interaction.options.getString('trigger').trim().toLowerCase();
    const result = await db.query('DELETE FROM custom_commands WHERE guild_id = ? AND trigger_word = ?', [interaction.guildId, trigger]);
    if (!result || result.affectedRows === 0) {
      return interaction.reply({ embeds: [errorEmbed('Not found', `There is no custom command with the trigger **${trigger}** in this server.`)] });
    }
    return interaction.reply({ embeds: [successEmbed('Custom command removed', `**${trigger}** will no longer trigger a reply.`)] });
  },
};

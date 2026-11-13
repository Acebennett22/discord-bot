const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { invalidateFaqs } = require('../../utils/faq');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('faq-remove')
    .setDescription('Admin only: remove an FAQ auto-response.')
    .addStringOption((o) => o.setName('trigger').setDescription('Trigger phrase to remove').setRequired(true).setMaxLength(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'FAQ responses only work in a server.')], ephemeral: true });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to remove FAQ responses.')], ephemeral: true });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected right now.')], ephemeral: true });
    const trigger = interaction.options.getString('trigger').trim();
    const result = await db.query('DELETE FROM faq_responses WHERE guild_id = ? AND trigger_phrase = ?', [interaction.guildId, trigger]);
    if (!result || result.affectedRows === 0) {
      return interaction.reply({ embeds: [errorEmbed('Not found', `There is no FAQ response with the trigger **${trigger}** in this server.`)], ephemeral: true });
    }
    invalidateFaqs(interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('FAQ removed', `**${trigger}** will no longer trigger an auto-response.`)], ephemeral: true });
  },
};

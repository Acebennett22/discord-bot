const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule-cancel')
    .setDescription('Admin only: cancel a pending scheduled message.')
    .addIntegerOption((o) => o.setName('id').setDescription('Scheduled message ID (see /schedule-list)').setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Scheduled messages only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to cancel scheduled messages.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected right now.')] });
    const id = interaction.options.getInteger('id');
    const result = await db.query('DELETE FROM scheduled_messages WHERE id = ? AND guild_id = ? AND sent = 0', [id, interaction.guildId]);
    if (!result || result.affectedRows === 0) {
      return interaction.reply({ embeds: [errorEmbed('Not found', `No pending scheduled message with ID #${id} in this server (it may already have been sent).`)] });
    }
    return interaction.reply({ embeds: [successEmbed('Cancelled', `Scheduled message #${id} has been cancelled and will not be posted.`)] });
  },
};

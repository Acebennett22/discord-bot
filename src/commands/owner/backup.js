const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const staff = require('../../utils/staff');
const { runBackup } = require('../../../scripts/backup-db');

module.exports = {
  data: new SlashCommandBuilder().setName('backup').setDescription('Owner only: run a database backup right now.'),
  async execute(interaction) {
    if (!staff.isOwner(interaction.user.id)) return interaction.reply({ embeds: [errorEmbed('Owner only', 'Only the bot owner can run backups.')], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const result = await runBackup();
    if (!result.ok) return interaction.editReply({ embeds: [errorEmbed('Backup failed', result.error)] });
    return interaction.editReply({ embeds: [successEmbed('Backup complete', `**File:** \`${result.filename}\`\n**Size:** ${(result.sizeBytes / 1024).toFixed(1)} KB\nSaved to \`backups/\` and logged in backup_logs. Older backups beyond the 30-day retention were pruned.`)] });
  },
};

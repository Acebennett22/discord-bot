// Server backup restore confirmation (1.5.4): the /serverbackup restore
// command posts a Confirm button; clicking it runs the restore.
const { Events } = require('discord.js');
const db = require('../utils/database');
const { restoreBackup } = require('../utils/serverBackup');
const { successEmbed, errorEmbed, infoEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'serverbackup_cancel') {
      return interaction.update({ embeds: [infoEmbed('Restore cancelled', 'Nothing was changed.')], components: [] });
    }
    if (!interaction.customId.startsWith('serverbackup_restore:')) return;
    const [, idStr, replaceStr] = interaction.customId.split(':');
    const id = parseInt(idStr, 10);
    const replace = replaceStr === '1';
    if (!interaction.memberPermissions?.has('Administrator')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'Only server admins can restore a backup.')], ephemeral: true });
    }
    const rows = await db.query('SELECT * FROM server_backups WHERE id = ? AND guild_id = ?', [id, interaction.guildId]);
    const backup = rows?.[0];
    if (!backup) return interaction.update({ embeds: [errorEmbed('Backup not found', 'That backup no longer exists.')], components: [] });
    await interaction.update({ embeds: [infoEmbed('Restoring…', 'Restoring roles and channels — this can take a moment.')], components: [] });
    try {
      const summary = await restoreBackup(interaction.guild, backup, { replace });
      await interaction.followUp({
        embeds: [successEmbed('Restore complete', `✅ **${backup.name}** restored:\n• Roles: ${summary.rolesCreated} created, ${summary.rolesUpdated} updated${replace ? `, ${summary.rolesDeleted} deleted` : ''}\n• Channels: ${summary.channelsCreated} created, ${summary.channelsUpdated} updated${replace ? `, ${summary.channelsDeleted} deleted` : ''}`)],
        ephemeral: true,
      });
    } catch (err) {
      await interaction.followUp({ embeds: [errorEmbed('Restore failed', err.message)], ephemeral: true });
    }
  },
};

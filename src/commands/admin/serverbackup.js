const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { createBackup, listBackups, restoreBackup } = require('../../utils/serverBackup');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverbackup')
    .setDescription('Admin only: back up and restore this server\'s roles, channels, and bot settings.')
    .addSubcommand((s) => s.setName('create').setDescription('Snapshot roles, channels, and bot settings to a backup file.')
      .addStringOption((o) => o.setName('name').setDescription('Backup name').setRequired(false).setMaxLength(64)))
    .addSubcommand((s) => s.setName('list').setDescription('List server backups.'))
    .addSubcommand((s) => s.setName('restore').setDescription('Restore a backup (asks for confirmation first).')
      .addIntegerOption((o) => o.setName('id').setDescription('Backup ID (see /serverbackup list)').setRequired(true))
      .addBooleanOption((o) => o.setName('replace').setDescription('Also delete roles/channels not in the backup (destructive!)')))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a backup.')
      .addIntegerOption((o) => o.setName('id').setDescription('Backup ID').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Server backups need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      const name = interaction.options.getString('name') || 'backup';
      await interaction.deferReply();
      const result = await createBackup(interaction.guild, interaction.user, name);
      return interaction.editReply({ embeds: [successEmbed('Server backup created', `💾 **${name}** — ${result.roles} roles, ${result.channels} channels, and the bot's settings saved (${(result.size / 1024).toFixed(1)} KB).\n\nMessage history is NOT backed up (Discord doesn't allow reading full history for this). Backup ID: ${result.id ?? '—'}`)] });
    }
    if (sub === 'list') {
      const rows = await listBackups(interaction.guildId);
      if (!rows.length) return interaction.reply({ embeds: [infoEmbed('Server backups', 'No server backups yet. Use /serverbackup create.')] });
      const lines = rows.map((b) => `**#${b.id}** ${b.name} — ${(b.size_bytes / 1024).toFixed(1)} KB · ${b.created_at}`);
      return interaction.reply({ embeds: [infoEmbed('💾 Server backups', lines.join('\n'))] });
    }
    if (sub === 'delete') {
      const id = interaction.options.getInteger('id');
      const rows = await db.query('SELECT * FROM server_backups WHERE id = ? AND guild_id = ?', [id, interaction.guildId]);
      if (!rows?.length) return interaction.reply({ embeds: [errorEmbed('Backup not found', `No backup with ID ${id} in this server.`)] });
      const fs = require('fs');
      try { fs.unlinkSync(rows[0].file_path); } catch {}
      await db.query('DELETE FROM server_backups WHERE id = ?', [id]);
      return interaction.reply({ embeds: [successEmbed('Backup deleted', `Backup **#${id}** (${rows[0].name}) was deleted.`)] });
    }
    // restore — two-step: confirm button first.
    const id = interaction.options.getInteger('id');
    const replace = interaction.options.getBoolean('replace') || false;
    const rows = await db.query('SELECT * FROM server_backups WHERE id = ? AND guild_id = ?', [id, interaction.guildId]);
    if (!rows?.length) return interaction.reply({ embeds: [errorEmbed('Backup not found', `No backup with ID ${id} in this server.`)] });
    const backup = rows[0];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`serverbackup_restore:${id}:${replace ? 1 : 0}`).setLabel('✅ Confirm restore').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('serverbackup_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({
      embeds: [infoEmbed('Restore backup?', `Restore **${backup.name}** (created ${backup.created_at})?\n\n• Roles/channels that don't exist will be created; existing ones are updated by name.\n• **Nothing is deleted by default.**${replace ? '\n• ⚠️ --replace is ON: roles/channels not in the backup WILL be deleted.' : ''}\n\nMessage history is not restored (it was never backed up). Click Confirm to proceed.`)],
      components: [row],
    });
  },
};

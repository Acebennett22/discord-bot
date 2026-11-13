const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const staff = require('../../utils/staff');

module.exports = {
  data: new SlashCommandBuilder().setName('errors-clear').setDescription('Owner only: clear resolved or old error logs.')
    .addBooleanOption((o) => o.setName('confirm').setDescription('You must set this to true to confirm').setRequired(true))
    .addStringOption((o) => o.setName('scope').setDescription('What to clear').addChoices({ name: 'resolved only', value: 'resolved' }, { name: 'older than 30 days', value: 'old' }, { name: 'everything', value: 'all' }))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!staff.isOwner(interaction.user.id)) return interaction.reply({ embeds: [errorEmbed('Owner only', 'Only the bot owner can clear error logs.')], ephemeral: true });
    if (!interaction.options.getBoolean('confirm')) return interaction.reply({ embeds: [errorEmbed('Not confirmed', 'Re-run with `confirm: true` to actually clear logs.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Error logs are stored in MySQL (error_logs).')], ephemeral: true });
    const scope = interaction.options.getString('scope') || 'resolved';
    let sql;
    if (scope === 'resolved') sql = 'DELETE FROM error_logs WHERE resolved = 1';
    else if (scope === 'old') sql = 'DELETE FROM error_logs WHERE created_at < NOW() - INTERVAL 30 DAY';
    else sql = 'DELETE FROM error_logs';
    const result = await db.query(sql);
    return interaction.reply({ embeds: [successEmbed('Error logs cleared', `Removed ${result.affectedRows ?? 0} log entries (${scope}). The local file logs/bot-errors.log is untouched.`)] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const staff = require('../../utils/staff');

module.exports = {
  data: new SlashCommandBuilder().setName('errors').setDescription('Staff only: show the most recent error logs.')
    .addStringOption((o) => o.setName('level').setDescription('Filter by level').addChoices({ name: 'error', value: 'error' }, { name: 'warn', value: 'warn' }, { name: 'info', value: 'info' }))
    .addStringOption((o) => o.setName('command').setDescription('Filter by command/event name')),
  async execute(interaction) {
    if (!(await staff.isStaff(interaction.user.id))) return interaction.reply({ embeds: [errorEmbed('Staff only', 'This command is for the bot owner and approved staff.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Error logs are stored in MySQL (error_logs). Check logs/bot-errors.log on the host as a fallback.')], ephemeral: true });
    const level = interaction.options.getString('level');
    const command = interaction.options.getString('command');
    const where = [];
    const params = [];
    if (level) { where.push('level = ?'); params.push(level); }
    if (command) { where.push('command_name = ?'); params.push(command); }
    const rows = await db.query(
      `SELECT id, level, shard_id, command_name, message, created_at, resolved FROM error_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 10`,
      params) || [];
    if (!rows.length) return interaction.reply({ embeds: [infoEmbed('Recent errors', 'No error logs match — clean slate. 🎉')], ephemeral: true });
    return interaction.reply({ embeds: [infoEmbed('Recent errors (last 10)', rows.map((r) =>
      `**#${r.id}** [${r.level}]${r.shard_id != null ? ` shard ${r.shard_id}` : ''}${r.command_name ? ` \`/${r.command_name}\`` : ''}${r.resolved ? ' ✅ resolved' : ''}\n${r.message.slice(0, 200)}\n<t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:R>`).join('\n\n') + '\n\nUse `/error <id>` for full details.')], ephemeral: true });
  },
};

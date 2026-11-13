const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const staff = require('../../utils/staff');

module.exports = {
  data: new SlashCommandBuilder().setName('error').setDescription('Staff only: show full details of one error log entry.')
    .addIntegerOption((o) => o.setName('id').setDescription('Error log ID (from /errors)').setRequired(true)),
  async execute(interaction) {
    if (!(await staff.isStaff(interaction.user.id))) return interaction.reply({ embeds: [errorEmbed('Staff only', 'This command is for the bot owner and approved staff.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Error logs are stored in MySQL (error_logs).')], ephemeral: true });
    const rows = await db.query('SELECT * FROM error_logs WHERE id = ?', [interaction.options.getInteger('id')]);
    const r = rows?.[0];
    if (!r) return interaction.reply({ embeds: [errorEmbed('Not found', 'No error log with that ID.')], ephemeral: true });
    let context = '';
    try { context = r.context ? JSON.stringify(JSON.parse(r.context), null, 2) : ''; } catch {}
    const desc = `**Level:** ${r.level} · **Shard:** ${r.shard_id ?? '—'} · **Guild:** ${r.guild_id || '—'}\n**Command/event:** ${r.command_name || '—'} · **User:** ${r.user_id || '—'}\n**When:** <t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:F>\n**Resolved:** ${r.resolved ? `yes (by ${r.resolved_by || '?'})` : 'no'}\n\n**Message:** ${r.message}`.slice(0, 1500)
      + (r.stack ? `\n\n**Stack:**\n\`\`\`\n${r.stack.slice(0, 1200)}\n\`\`\`` : '')
      + (context ? `\n\n**Context:**\n\`\`\`json\n${context.slice(0, 800)}\n\`\`\`` : '');
    return interaction.reply({ embeds: [infoEmbed(`Error #${r.id}`, desc.slice(0, 4000))], ephemeral: true });
  },
};

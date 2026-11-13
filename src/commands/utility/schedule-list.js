const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { statsEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { discordTimestamp } = require('../../utils/timeParse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule-list')
    .setDescription('Admin only: list pending scheduled messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Scheduled messages only work in a server.')], ephemeral: true });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to list scheduled messages.')], ephemeral: true });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected right now.')], ephemeral: true });
    const rows = await db.query('SELECT * FROM scheduled_messages WHERE guild_id = ? AND sent = 0 ORDER BY send_at LIMIT 20', [interaction.guildId]) || [];
    if (!rows.length) return interaction.reply({ embeds: [statsEmbed('Scheduled messages', 'Nothing scheduled — use /schedule to add one.')], ephemeral: true });
    const lines = rows.map((r) => {
      const preview = r.content || (() => { try { return JSON.parse(r.embed_json).title; } catch { return '(embed)'; } })();
      return `**#${r.id}** — <#${r.channel_id}> — ${discordTimestamp(r.send_at)}\n> ${String(preview).slice(0, 120)}`;
    });
    return interaction.reply({ embeds: [statsEmbed(`Scheduled messages (${rows.length})`, lines.join('\n\n').slice(0, 4000))], ephemeral: true });
  },
};

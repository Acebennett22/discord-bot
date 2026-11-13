const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const staff = require('../../utils/staff');
const { getJoinStats, raidWatchStatus, botTrackingConfig } = require('../../utils/botTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bottrack')
    .setDescription('Staff only: join stats — total / flagged / bot joins today and this week, plus raid-watch status.'),
  async execute(interaction) {
    if (!(await staff.isStaff(interaction.user.id))) return interaction.reply({ embeds: [errorEmbed('Staff only', 'This command is for the bot owner and approved staff.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Join stats are stored in MySQL (bot_join_stats).')], ephemeral: true });
    const rows = await getJoinStats(interaction.guildId, 7);
    const bt = botTrackingConfig();
    const raid = raidWatchStatus(interaction.guildId);
    const today = rows[0] || { total_joins: 0, bot_joins: 0, flagged_joins: 0 };
    const week = rows.reduce((a, r) => ({ total: a.total + (r.total_joins || 0), bots: a.bots + (r.bot_joins || 0), flagged: a.flagged + (r.flagged_joins || 0) }), { total: 0, bots: 0, flagged: 0 });
    const daily = rows.map((r) => `\`${r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10)}\` — ${r.total_joins} joins · ${r.flagged_joins} flagged · ${r.bot_joins} at/above threshold`).join('\n') || 'No joins recorded in the last 7 days.';
    return interaction.reply({ embeds: [infoEmbed('🤖 Bot tracking — join stats',
      `**Today:** ${today.total_joins} joins · ${today.flagged_joins} flagged · ${today.bot_joins} at/above threshold\n**Last 7 days:** ${week.total} joins · ${week.flagged} flagged · ${week.bots} at/above threshold\n**Raid watch:** ${raid.inRaidWindow ? `🚨 ACTIVE — ${raid.joinsLastWindow} joins in the last ${raid.windowSeconds}s (threshold ${raid.raidThreshold})` : `calm — ${raid.joinsLastWindow} joins in the last ${raid.windowSeconds}s`}\n**Threshold:** ${bt.threshold} (score >= threshold = auto-action; 40–69 = watchlist)\n\n${daily}`)], ephemeral: true });
  },
};

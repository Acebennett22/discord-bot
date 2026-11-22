const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const staff = require('../../utils/staff');
const { getGuildSettings } = require('../../utils/guildSettings');
const { parseWhitelist } = require('../../utils/antinuke');
const { resolveLogChannel } = require('../../utils/logChannels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('antinuke-status')
    .setDescription('Staff only: show anti-nuke settings and recent anti-nuke events.'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Anti-nuke status is per server.')] });
    if (!(await staff.isStaff(interaction.user.id))) return interaction.reply({ embeds: [errorEmbed('Staff only', 'This command is for the bot owner and approved staff.')] });
    const settings = await getGuildSettings(interaction.guildId);
    const whitelist = parseWhitelist(settings.antInukeWhitelistRoles);
    const enabled = settings.antInukeEnabled ?? false;
    const action = settings.antInukeAction || 'kick';
    const threshold = settings.antInukeThreshold ?? 5;
    // 1.16.20: effective anti-nuke log channel (per-type, else master).
    const antinukeLogChannelId = await resolveLogChannel(interaction.guildId, 'antinuke');

    let eventLines = ['No anti-nuke events recorded.'];
    if (db.isEnabled()) {
      const rows = await db.query(
        'SELECT user_id, action, target_id, created_at FROM antinuke_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10',
        [interaction.guildId],
      ) || [];
      if (rows.length) {
        eventLines = rows.map((r) => {
          const when = Math.floor(new Date(r.created_at).getTime() / 1000);
          return `• \`${r.action}\` — <@${r.user_id}> → \`${r.target_id || '—'}\` <t:${when}:R>`;
        });
      }
    }
    return interaction.reply({ embeds: [infoEmbed('🛡️ Anti-nuke status',
      `**Enabled:** ${enabled ? 'Yes' : 'No'}\n**Action:** ${action}\n**Threshold:** ${threshold} destructive actions in 60s\n**Whitelisted roles:** ${whitelist.length ? whitelist.map((id) => `<@&${id}>`).join(', ') : 'None'}\n**Log channel:** ${antinukeLogChannelId ? `<#${antinukeLogChannelId}>` : 'Not set'}`,
      [{ name: 'Recent events (last 10)', value: eventLines.join('\n').slice(0, 1000) }])] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getRank } = require('../../utils/leveling');
const { getGuildSettings } = require('../../utils/guildSettings');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('levelrewards')
    .setDescription('List your next level-up role rewards and how close you are.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Level rewards need MySQL.')], ephemeral: true });
    const settings = await getGuildSettings(interaction.guildId);
    const rewards = settings.levelRoles || {};
    const entries = Object.entries(rewards)
      .map(([lvl, roleId]) => ({ level: parseInt(lvl, 10), roleId }))
      .sort((a, b) => a.level - b.level);
    if (!entries.length) return interaction.reply({ embeds: [infoEmbed('Level rewards', 'No level role rewards are set up in this server yet. Admins set them on the dashboard Leveling tab.')], ephemeral: true });
    const rank = await getRank(interaction.user.id, interaction.guildId);
    const level = rank?.level ?? 0;
    const lines = entries.map((r) => {
      const role = interaction.guild.roles.cache.get(r.roleId);
      const name = role ? role.name : `role ${r.roleId}`;
      if (level >= r.level) return `✅ Level ${r.level} — **${name}** (unlocked)`;
      const away = r.level - level;
      return `🔒 Level ${r.level} — **${name}** (${away} level${away === 1 ? '' : 's'} away)`;
    });
    const reminders = await db.query('SELECT target_level, role_id FROM level_reminders WHERE guild_id = ? AND user_id = ? AND reminded_at IS NULL', [interaction.guildId, interaction.user.id]) || [];
    const remText = reminders.length
      ? `\n\n🔔 Reminders set: ${reminders.map((r) => `level ${r.target_level}`).join(', ')} — I'll DM you when you get there.`
      : '';
    return interaction.reply({ embeds: [infoEmbed(`Your level rewards (you're level ${level})`, `${lines.join('\n')}${remText}`)], ephemeral: true });
  },
};

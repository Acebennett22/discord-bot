// "Remind me" button on level-up messages: stores a reminder and DMs the
// member when they reach that reward level (see leveling.js awardXp).
const { Events } = require('discord.js');
const db = require('../utils/database');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('levelremind:')) return;
    const [, levelStr, roleId] = interaction.customId.split(':');
    const targetLevel = parseInt(levelStr, 10);
    if (!db.isEnabled() || Number.isNaN(targetLevel) || !roleId) {
      return interaction.reply({ embeds: [errorEmbed('Could not set reminder', 'Something went wrong — try again.')] });
    }
    const existing = await db.query(
      'SELECT id FROM level_reminders WHERE guild_id = ? AND user_id = ? AND target_level = ? AND reminded_at IS NULL',
      [interaction.guildId, interaction.user.id, targetLevel],
    );
    if (!existing?.length) {
      await db.query(
        'INSERT INTO level_reminders (guild_id, user_id, target_level, role_id) VALUES (?, ?, ?, ?)',
        [interaction.guildId, interaction.user.id, targetLevel, roleId],
      );
    }
    const role = interaction.guild.roles.cache.get(roleId);
    return interaction.reply({
      embeds: [successEmbed('Reminder set!', `🔔 I'll DM you when you hit **level ${targetLevel}** — that's when you earn the **${role ? role.name : 'reward'}** role.`)],
    });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk-remove')
    .setDescription('Clear your AFK status.'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'AFK only works in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected right now.')], ephemeral: true });
    const result = await db.query('DELETE FROM afk_users WHERE guild_id = ? AND user_id = ?', [interaction.guildId, interaction.user.id]);
    try {
      const nick = interaction.member.nickname;
      if (nick?.startsWith('[AFK] ')) await interaction.member.setNickname(nick.replace(/^\[AFK\] /, '').slice(0, 32) || null);
    } catch {}
    if (!result || result.affectedRows === 0) {
      return interaction.reply({ embeds: [successEmbed('Not AFK', 'You weren\'t marked AFK.')], ephemeral: true });
    }
    return interaction.reply({ embeds: [successEmbed('Welcome back', 'Your AFK status has been cleared.')], ephemeral: true });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Mark yourself AFK — people who mention you will be told why.')
    .addStringOption((o) => o.setName('reason').setDescription('Why you\'re away').setMaxLength(256)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'AFK only works in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so AFK can\'t be set right now.')], ephemeral: true });
    const reason = interaction.options.getString('reason') || 'No reason given';
    await db.query(
      'INSERT INTO afk_users (guild_id, user_id, reason) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason), since = NOW()',
      [interaction.guildId, interaction.user.id, reason],
    );
    // Best-effort "[AFK]" nickname prefix — never fails the command.
    try {
      const me = interaction.guild.members.me;
      if (me?.permissions.has('ManageNicknames') && interaction.member.manageable) {
        const current = interaction.member.nickname || interaction.user.username;
        if (!current.startsWith('[AFK] ')) await interaction.member.setNickname(`[AFK] ${current}`.slice(0, 32));
      }
    } catch {}
    return interaction.reply({ embeds: [successEmbed('You\'re AFK', `I'll tell anyone who mentions you that you're away: **${reason}**\nSend any message to come back.`)], ephemeral: true });
  },
};

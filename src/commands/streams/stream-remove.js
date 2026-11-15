const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream-remove')
    .setDescription('Admin only: stop watching a streamer.')
    .addStringOption((o) => o.setName('platform').setDescription('Platform').setRequired(true)
      .addChoices(...['youtube', 'twitch', 'kick', 'facebook', 'tiktok'].map((p) => ({ name: p, value: p }))))
    .addStringOption((o) => o.setName('channel').setDescription('Channel name/ID as added').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Stream watchers are stored in MySQL.')] });
    const res = await db.query('DELETE FROM streamers WHERE guild_id = ? AND platform = ? AND channel_id_or_name = ?',
      [interaction.guildId, interaction.options.getString('platform'), interaction.options.getString('channel')]);
    if (!res || res.affectedRows === 0) return interaction.reply({ embeds: [errorEmbed('Not found', 'No watched streamer matched that platform + channel in this server.')] });
    return interaction.reply({  embeds: [successEmbed('Streamer removed', `Stopped watching **${interaction.options.getString('channel')}** on **${interaction.options.getString('platform')}**.`)] });
  },
};

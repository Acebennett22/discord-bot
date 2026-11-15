const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream-clip-toggle')
    .setDescription('Admin only: toggle whether a streamer\'s live announcements include their latest clip/video.')
    .addIntegerOption((o) => o.setName('streamer').setDescription('Streamer ID (see /stream-list)').setRequired(true))
    .addBooleanOption((o) => o.setName('enabled').setDescription('Include the latest clip/video?').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Stream settings need MySQL.')] });
    const id = interaction.options.getInteger('streamer');
    const enabled = interaction.options.getBoolean('enabled');
    const rows = await db.query('SELECT * FROM streamers WHERE id = ? AND guild_id = ?', [id, interaction.guildId]);
    if (!rows?.length) return interaction.reply({ embeds: [errorEmbed('Streamer not found', `No tracked streamer with ID ${id} in this server.`)] });
    await db.query('UPDATE streamers SET include_clip = ? WHERE id = ?', [enabled ? 1 : 0, id]);
    const streamer = rows[0];
    return interaction.reply({ embeds: [successEmbed('Clip toggle updated', `🎬 Live announcements for **${streamer.channel_id_or_name}** will ${enabled ? 'now include their latest clip (Twitch) or latest video (YouTube)' : 'no longer include a clip/video'}.`)] });
  },
};

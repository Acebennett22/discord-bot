const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder().setName('stream-list').setDescription('List all watched streamers in this server and whether each is live.'),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Stream watchers are stored in MySQL.')] });
    const rows = await db.query('SELECT platform, channel_id_or_name, notify_channel_id, is_live, live_channel_id FROM streamers WHERE guild_id = ?', [interaction.guildId]);
    if (!rows?.length) return interaction.reply({  embeds: [infoEmbed('Watched streamers', 'No streamers are being watched in this server yet. Add one with /stream-add.')] });
    return interaction.reply({  embeds: [infoEmbed('Watched streamers', rows.map((r) => `${r.is_live ? '🔴 LIVE' : '⚫ offline'} **${r.channel_id_or_name}** (${r.platform}) — announcements in <#${r.notify_channel_id}>${r.live_channel_id ? ` — live channel: <#${r.live_channel_id}>` : ''}`).join('\n'))] });
  },
};

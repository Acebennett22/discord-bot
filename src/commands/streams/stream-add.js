const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');

const PLATFORMS = ['youtube', 'twitch', 'kick', 'facebook', 'tiktok'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream-add')
    .setDescription('Admin only: watch a streamer and announce when they go live.')
    .addStringOption((o) => o.setName('platform').setDescription('Streaming platform').setRequired(true)
      .addChoices(...PLATFORMS.map((p) => ({ name: p, value: p }))))
    .addStringOption((o) => o.setName('channel').setDescription('Channel name/ID (Twitch login, YouTube channel ID, Kick slug, or page name)').setRequired(true))
    .addChannelOption((o) => o.setName('notify_channel').setDescription('Channel to post live announcements in').setRequired(true))
    .addRoleOption((o) => o.setName('ping_role').setDescription('Role to ping when they go live (optional)'))
    .addChannelOption((o) => o.setName('live_channel').setDescription('Optional: channel whose NAME updates to say they are live (voice or text)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Stream watchers are stored in MySQL — connect the database first.')], ephemeral: true });
    const platform = interaction.options.getString('platform');
    const channelName = interaction.options.getString('channel');
    const notify = interaction.options.getChannel('notify_channel');
    const role = interaction.options.getRole('ping_role');
    const liveChannel = interaction.options.getChannel('live_channel');
    if (liveChannel) {
      const clash = await db.query('SELECT channel_id_or_name FROM streamers WHERE guild_id = ? AND live_channel_id = ?', [interaction.guildId, liveChannel.id]);
      if (clash?.length) return interaction.reply({ embeds: [errorEmbed('Live channel already in use', `**<#${liveChannel.id}>** is already the live channel for **${clash[0].channel_id_or_name}** in this server. One streamer per live channel.`)], ephemeral: true });
    }
    const channelUrl = platform === 'twitch' ? `https://twitch.tv/${channelName}`
      : platform === 'kick' ? `https://kick.com/${channelName}`
      : platform === 'youtube' ? `https://www.youtube.com/channel/${channelName}` : null;
    await db.query(
      `INSERT INTO streamers (guild_id, platform, channel_id_or_name, channel_url, notify_channel_id, ping_role_id, live_channel_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notify_channel_id = VALUES(notify_channel_id), ping_role_id = VALUES(ping_role_id), channel_url = VALUES(channel_url), live_channel_id = VALUES(live_channel_id)`,
      [interaction.guildId, platform, channelName, channelUrl, notify.id, role?.id || null, liveChannel?.id || null],
    );
    const note = (platform === 'facebook' || platform === 'tiktok')
      ? '\n\n⚠️ Facebook/TikTok have no public live API — this watcher will NOT auto-detect going live. Use /stream-announce to announce manually.'
      : '';
    return interaction.reply({ embeds: [successEmbed('Streamer added', `Now watching **${channelName}** on **${platform}**.\nAnnouncements go to <#${notify.id}>${role ? `, pinging <@&${role.id}>` : ''}.${liveChannel ? `\nLive channel: <#${liveChannel.id}> — its name becomes the live template while they stream, then restores.` : ''}${note}`)] });
  },
};

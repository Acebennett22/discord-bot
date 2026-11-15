// Stream check (1.14.0): force an immediate live check for one watched
// streamer, instead of waiting for the next poll interval. If the check
// finds a fresh offline -> live transition, the announcement goes out to
// the streamer's notify channel exactly as the poller would post it.
// TikTok / Facebook have no public live API, so they stay manual-only
// (/stream-announce) and this command says so plainly.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { checkOneStreamer, liveEmbed, fetchLatestClip } = require('../../utils/streamNotifier');

const PLATFORMS = ['youtube', 'twitch', 'kick', 'facebook', 'tiktok'];
const MANUAL_ONLY = ['facebook', 'tiktok'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream-check')
    .setDescription('Admin only: check right now whether a watched streamer is live.')
    .addStringOption((o) => o.setName('platform').setDescription('Streaming platform').setRequired(true)
      .addChoices(...PLATFORMS.map((p) => ({ name: p, value: p }))))
    .addStringOption((o) => o.setName('channel').setDescription('Channel name/ID as added with /stream-add').setRequired(true).setMaxLength(128))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Stream checks only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'Stream watchers are stored in MySQL — connect the database first.')] });
    const platform = interaction.options.getString('platform');
    const channelName = interaction.options.getString('channel').trim();
    const rows = await db.query(
      'SELECT * FROM streamers WHERE guild_id = ? AND platform = ? AND channel_id_or_name = ?',
      [interaction.guildId, platform, channelName],
    );
    const row = rows?.[0];
    if (!row) {
      return interaction.reply({ embeds: [errorEmbed('Not watched', `**${channelName}** on **${platform}** isn't being watched in this server. Add them with /stream-add first.`)] });
    }
    if (MANUAL_ONLY.includes(platform)) {
      return interaction.reply({ embeds: [infoEmbed('Manual-only platform', `**${platform}** has no public live-status API, so there's nothing to check automatically. Use /stream-announce to post when **${channelName}** goes live.`)] });
    }
    await interaction.deferReply();
    const wasLive = Boolean(row.is_live);
    const status = await checkOneStreamer(interaction.client, row.id).catch(() => null);
    if (!status || status.error) {
      return interaction.editReply({ embeds: [errorEmbed('Check failed', `Couldn't check **${channelName}** on **${platform}** right now — the platform API may be down, or the credentials for it aren't set. Try again in a bit; the regular poller will keep trying too.`)] });
    }
    if (!status.live) {
      return interaction.editReply({ embeds: [infoEmbed('Offline', `**${channelName}** is not live on **${platform}** right now.`)] });
    }
    const lines = [`**${channelName}** is live on **${platform}**!`];
    if (status.title) lines.push(`**${status.title}**`);
    if (status.game) lines.push(`Category: ${status.game}`);
    if (status.viewers != null) lines.push(`Viewers: ${status.viewers}`);
    if (status.url) lines.push(status.url);
    if (!wasLive) {
      // Fresh transition — announce it to the notify channel like the poller.
      const channel = interaction.guild.channels.cache.get(row.notify_channel_id)
        || await interaction.guild.channels.fetch(row.notify_channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        const ping = row.ping_role_id ? `<@&${row.ping_role_id}> ` : '';
        const embed = liveEmbed(row.platform, row.channel_id_or_name, status);
        if (row.include_clip !== 0) {
          const clip = await fetchLatestClip(row.platform, row.channel_id_or_name).catch(() => null);
          if (clip) embed.addFields({ name: clip.type === 'clip' ? '🎬 Latest clip' : '📺 Latest video', value: `[${clip.title}](${clip.url})` });
        }
        await channel.send({ content: `${ping}🔴 **${row.channel_id_or_name}** just went live!`, embeds: [embed] }).catch(() => {});
        lines.push(`\nAnnounced in <#${row.notify_channel_id}>.`);
      }
    } else {
      lines.push('\nAlready announced — still live, no duplicate post.');
    }
    return interaction.editReply({ embeds: [successEmbed('🔴 Live', lines.join('\n'))] });
  },
};

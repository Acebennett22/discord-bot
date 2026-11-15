const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { liveEmbed } = require('../../utils/streamNotifier');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream-announce')
    .setDescription('Manually announce a stream is live (for Facebook/TikTok, or as an override).')
    .addStringOption((o) => o.setName('platform').setDescription('Platform').setRequired(true)
      .addChoices(...['youtube', 'twitch', 'kick', 'facebook', 'tiktok'].map((p) => ({ name: p, value: p }))))
    .addStringOption((o) => o.setName('url').setDescription('Stream URL').setRequired(true))
    .addStringOption((o) => o.setName('title').setDescription('Stream title (optional)'))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to announce in (defaults to this channel)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const platform = interaction.options.getString('platform');
    const url = interaction.options.getString('url');
    const title = interaction.options.getString('title') || '';
    if (!/^https?:\/\//i.test(url)) return interaction.reply({ embeds: [errorEmbed('Invalid URL', 'Give a full stream URL starting with http(s)://.')] });
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const name = url.split('/').filter(Boolean).pop() || platform;
    await channel.send({ content: `🔴 **${name}** is live on ${platform}!`, embeds: [liveEmbed(platform, name, { title, url, game: '', viewers: null, thumbnail: null })] });
    return interaction.reply({ embeds: [successEmbed('Stream announced', `Announced the ${platform} stream in <#${channel.id}>.`)] });
  },
};

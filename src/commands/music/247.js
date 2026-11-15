const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');
const { ensure247 } = require('../../utils/music247');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('24/7 music mode: keep the bot in a voice channel around the clock.')
    .addSubcommand((s) => s.setName('enable').setDescription('Turn 24/7 mode on for a voice channel.')
      .addChannelOption((o) => o.setName('channel').setDescription('Voice channel to stay in').setRequired(true)))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn 24/7 mode off. The bot will leave the channel.'))
    .addSubcommand((s) => s.setName('status').setDescription('Show whether 24/7 mode is on and where the bot is sitting.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', '24/7 mode only works in a server.')] });
    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);
    if (sub === 'status') {
      const connected = getVoiceConnection(interaction.guildId);
      return interaction.reply({ embeds: [infoEmbed('24/7 music mode', [
        `**Status:** ${settings.music247Enabled ? '✅ enabled' : '❌ disabled'}`,
        `**Channel:** ${settings.music247ChannelId ? `<#${settings.music247ChannelId}>` : '—'}`,
        `**Connected right now:** ${connected ? '✅ yes' : '❌ no'}`,
        settings.music247Enabled ? 'The bot stays connected even when the queue is empty, and rejoins if it gets disconnected or kicked.' : 'Enable it with `/247 enable` and pick a voice channel.',
      ].join('\n'))] });
    }
    if (sub === 'disable') {
      await setGuildSettings(interaction.guildId, { music247Enabled: false, music247ChannelId: '' });
      const { destroyQueue } = require('../../utils/musicQueue');
      destroyQueue(interaction.guildId);
      return interaction.reply({ embeds: [successEmbed('24/7 mode off', 'The bot will no longer stay in voice around the clock, and has left the channel.')] });
    }
    // enable
    const channel = interaction.options.getChannel('channel');
    if (!channel?.isVoiceBased?.() || channel.isThread?.()) {
      return interaction.reply({ embeds: [errorEmbed('Not a voice channel', 'Pick a voice channel for 24/7 mode.')] });
    }
    await setGuildSettings(interaction.guildId, { music247Enabled: true, music247ChannelId: channel.id });
    const joined = await ensure247(interaction.client, interaction.guildId);
    return interaction.reply({ embeds: [successEmbed('24/7 mode on', `The bot will stay in <#${channel.id}> around the clock — even with an empty queue — and rejoin if disconnected or kicked.${joined ? '' : '\n⚠️ Could not join the channel right now (check my voice permissions); it will retry every minute.'}`)] });
  },
};

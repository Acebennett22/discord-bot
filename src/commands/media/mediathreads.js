const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { setGuildSettings, getGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mediathreads')
    .setDescription('Admin only: manage auto-thread media channels.')
    .addSubcommand((s) => s.setName('add').setDescription('Add a channel where media posts get auto-threads.')
      .addChannelOption((o) => o.setName('channel').setDescription('Media channel').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a channel from auto-threads.')
      .addChannelOption((o) => o.setName('channel').setDescription('Media channel').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List the media auto-thread channels.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);
    const channels = settings.mediaChannels || [];
    if (sub === 'list') {
      if (!channels.length) return interaction.reply({ embeds: [infoEmbed('Media auto-threads', 'No media channels configured yet. Use /mediathreads add to add one.')], ephemeral: true });
      return interaction.reply({ embeds: [infoEmbed('Media auto-threads', channels.map((id) => `<#${id}>`).join('\n'))], ephemeral: true });
    }
    const channel = interaction.options.getChannel('channel');
    if (sub === 'add') {
      if (channels.includes(channel.id)) return interaction.reply({ embeds: [infoEmbed('Already added', `<#${channel.id}> already has media auto-threads.`)], ephemeral: true });
      await setGuildSettings(interaction.guildId, { mediaChannels: [...channels, channel.id] });
      return interaction.reply({ embeds: [successEmbed('Media channel added', `🧵 Image/video posts in <#${channel.id}> will now get a discussion thread automatically.`)], ephemeral: true });
    }
    // remove
    if (!channels.includes(channel.id)) return interaction.reply({ embeds: [errorEmbed('Not a media channel', `<#${channel.id}> isn't in the media auto-thread list.`)], ephemeral: true });
    await setGuildSettings(interaction.guildId, { mediaChannels: channels.filter((id) => id !== channel.id) });
    return interaction.reply({ embeds: [successEmbed('Media channel removed', `<#${channel.id}> no longer gets auto-threads.`)], ephemeral: true });
  },
};

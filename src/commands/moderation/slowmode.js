const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const slowmode = require('../../utils/slowmode');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode right now, or list the day/night schedules.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels) // before subcommands (loader-safe order)
    .addSubcommand((s) => s.setName('set').setDescription('Set slowmode right now.')
      .addIntegerOption((o) => o.setName('seconds').setDescription('Seconds between messages (0 = off)').setRequired(true).setMinValue(0).setMaxValue(21600))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel (defaults to this one)')))
    .addSubcommand((s) => s.setName('list').setDescription('List slowmode schedules in this server.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Slowmode schedules need MySQL.')], ephemeral: true });
    if (!interaction.memberPermissions?.has('ManageChannels')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Channels to use slowmode settings.')], ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = await slowmode.listSchedules(interaction.guildId);
      if (!rows.length) return interaction.reply({ embeds: [infoEmbed('⏱️ Slowmode schedules', 'No slowmode schedules set. Use /slowmode-schedule to add one.')], ephemeral: true });
      const lines = rows.map((r) => `<#${r.channel_id}> — day **${r.day_seconds}s** · night **${r.night_seconds}s** (${r.night_start_hour}:00–${r.night_end_hour}:00)`);
      return interaction.reply({ embeds: [infoEmbed('⏱️ Slowmode schedules', lines.join('\n'))], ephemeral: true });
    }
    // set
    const seconds = interaction.options.getInteger('seconds');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (typeof channel.setRateLimitPerUser !== 'function') return interaction.reply({ embeds: [errorEmbed('Not a text channel', 'Slowmode only works in text channels.')], ephemeral: true });
    await channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`).catch(() => null);
    return interaction.reply({ embeds: [successEmbed('Slowmode set', seconds === 0 ? `Slowmode is now **off** in <#${channel.id}>.` : `Slowmode in <#${channel.id}> is now **${seconds} seconds** between messages.`)], ephemeral: true });
  },
};

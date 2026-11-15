const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const slowmode = require('../../utils/slowmode');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode-schedule')
    .setDescription('Admin: set a day/night slowmode schedule for a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true))
    .addIntegerOption((o) => o.setName('day_seconds').setDescription('Slowmode during the day (0 = off)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addIntegerOption((o) => o.setName('night_seconds').setDescription('Slowmode at night (0 = off)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addIntegerOption((o) => o.setName('night_start').setDescription('Night starts at this hour (0-23, default 22)').setMinValue(0).setMaxValue(23))
    .addIntegerOption((o) => o.setName('night_end').setDescription('Night ends at this hour (0-23, default 8)').setMinValue(0).setMaxValue(23)),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Slowmode schedules need MySQL.')] });
    if (!interaction.memberPermissions?.has('ManageChannels')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Channels to use slowmode settings.')] });
    }
    const channel = interaction.options.getChannel('channel');
    if (typeof channel.setRateLimitPerUser !== 'function') return interaction.reply({ embeds: [errorEmbed('Not a text channel', 'Slowmode only works in text channels.')] });
    const preset = {
      name: 'default',
      daySeconds: interaction.options.getInteger('day_seconds'),
      nightSeconds: interaction.options.getInteger('night_seconds'),
      nightStart: interaction.options.getInteger('night_start') ?? 22,
      nightEnd: interaction.options.getInteger('night_end') ?? 8,
    };
    await slowmode.setSchedule(interaction.guildId, channel.id, preset);
    await slowmode.applySchedule(interaction.client, {
      channel_id: channel.id, day_seconds: preset.daySeconds, night_seconds: preset.nightSeconds,
      night_start_hour: preset.nightStart, night_end_hour: preset.nightEnd,
    }).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('Slowmode schedule set', `<#${channel.id}> — day **${preset.daySeconds}s**, night **${preset.nightSeconds}s** (${preset.nightStart}:00–${preset.nightEnd}:00). The timer re-applies it every 15 minutes.`)] });
  },
};

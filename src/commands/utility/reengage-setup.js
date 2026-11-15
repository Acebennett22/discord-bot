const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');
const reengage = require('../../utils/reengage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reengage-setup')
    .setDescription('Set up inactive-member re-engagement messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // before subcommands (loader-safe order)
    .addSubcommand((s) => s.setName('enable').setDescription('Admin: turn re-engagement DMs on.')
      .addIntegerOption((o) => o.setName('days').setDescription('Days of inactivity before messaging (default 30)').setMinValue(7).setMaxValue(180))
      .addChannelOption((o) => o.setName('channel').setDescription('Optional: post in this channel instead of DMing')))
    .addSubcommand((s) => s.setName('disable').setDescription('Admin: turn re-engagement off.'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the current re-engagement settings.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Re-engagement needs MySQL.')] });
    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);
    if (sub === 'status') {
      return interaction.reply({ embeds: [infoEmbed('👋 Re-engagement', settings.reengageEnabled
        ? `**On** — members inactive for **${settings.reengageDays || 30} days** are messaged once per 30 days, ${settings.reengageChannelId ? `in <#${settings.reengageChannelId}>` : 'by DM'}.`
        : 'Off — inactive members are not messaged. Use /reengage-setup enable to turn it on.')] });
    }
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Server to change re-engagement settings.')] });
    }
    if (sub === 'enable') {
      const days = interaction.options.getInteger('days') || 30;
      const channel = interaction.options.getChannel('channel');
      await setGuildSettings(interaction.guildId, { reengageEnabled: 1, reengageDays: days, reengageChannelId: channel?.id || '' });
      return interaction.reply({ embeds: [successEmbed('Re-engagement on', `Members inactive for **${days} days** will get a friendly ${channel ? `message in <#${channel.id}>` : 'DM'} — at most once per 30 days. Members can opt out with /reengage-optout.`)] });
    }
    await setGuildSettings(interaction.guildId, { reengageEnabled: 0 });
    return interaction.reply({ embeds: [successEmbed('Re-engagement off', 'Inactive members will no longer be messaged.')] });
  },
};

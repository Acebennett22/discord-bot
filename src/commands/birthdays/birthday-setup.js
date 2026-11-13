const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed } = require('../../utils/embeds');
const { setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday-setup')
    .setDescription('Admin only: set the birthday announcement channel and hour.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel for birthday announcements').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addIntegerOption((o) => o.setName('hour').setDescription('Hour of day to announce (0-23, bot host local time, default 9)').setMinValue(0).setMaxValue(23))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const hour = interaction.options.getInteger('hour') ?? 9;
    await setGuildSettings(interaction.guildId, { birthdayChannelId: channel.id, birthdayAnnounceHour: hour });
    return interaction.reply({
      embeds: [successEmbed('Birthday announcements set up', `🎂 Birthdays will be announced in <#${channel.id}> at **${hour}:00** (bot host local time).\nMembers set theirs with /birthday set.`)],
      ephemeral: true,
    });
  },
};

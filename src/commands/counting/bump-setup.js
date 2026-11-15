const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { successEmbed } = require('../../utils/embeds');
const { setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bump-setup')
    .setDescription('Admin only: set the channel for bump reminders.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel where "Time to bump!" reminders go').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    await setGuildSettings(interaction.guildId, { bumpChannelId: channel.id });
    return interaction.reply({
      embeds: [successEmbed('Bump reminders set up', `When 2 hours pass since the last bump, the bot will remind everyone in <#${channel.id}>.\nBumps are recorded when someone types \`!d bump\` or when DISBOARD confirms a bump. Use /bump to check the timer.`)],
    });
  },
};

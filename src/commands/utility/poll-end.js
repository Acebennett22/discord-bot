const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getPollByMessage, endPoll } = require('../../utils/polls');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll-end')
    .setDescription('Admin only: end a poll early and post the results.')
    .addStringOption((o) => o.setName('message_id').setDescription('Message ID of the poll to end').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Polls only work in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to end polls.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected right now.')] });
    const messageId = interaction.options.getString('message_id').trim();
    const poll = await getPollByMessage(messageId);
    if (!poll || poll.guild_id !== interaction.guildId) {
      return interaction.reply({ embeds: [errorEmbed('Poll not found', 'No poll with that message ID in this server.')] });
    }
    if (poll.ended) return interaction.reply({ embeds: [errorEmbed('Already ended', 'That poll has already ended.')] });
    await endPoll(interaction.client, poll);
    return interaction.reply({ embeds: [successEmbed('Poll ended', `Results for **${poll.question}** have been posted in <#${poll.channel_id}>.`)] });
  },
};

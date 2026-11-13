const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const polls = require('../../utils/polls');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll-results')
    .setDescription('Show the results of a poll (with a bar chart), live or ended.')
    .addStringOption((o) => o.setName('message').setDescription('Poll message ID or link').setRequired(true)),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Polls need MySQL.')], ephemeral: true });
    const ref = interaction.options.getString('message');
    const link = /discord\.com\/channels\/\d+\/\d+\/(\d+)/.exec(ref || '');
    const messageId = link ? link[1] : (ref || '').trim();
    if (!/^\d{17,20}$/.test(messageId)) return interaction.reply({ embeds: [errorEmbed('Bad reference', 'Give a poll message ID or a full Discord message link.')], ephemeral: true });
    const poll = await polls.getPollByMessage(messageId);
    if (!poll || poll.guild_id !== interaction.guildId) return interaction.reply({ embeds: [errorEmbed('Not found', 'No poll with that message ID in this server.')], ephemeral: true });
    const counts = polls.tallyVotes(poll.votes, poll.options.length);
    const embed = polls.pollEmbed(poll, counts);
    const chart = polls.generatePollChart(poll, counts);
    const files = chart ? [new AttachmentBuilder(chart, { name: 'poll-results.png' })] : [];
    if (chart) embed.setImage('attachment://poll-results.png');
    return interaction.reply({ embeds: [embed], files, ephemeral: true });
  },
};

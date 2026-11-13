const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const daily = require('../../utils/dailyTrivia');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trivia-daily')
    .setDescription("Play today's server-wide daily trivia question.")
    .addSubcommand((s) => s.setName('play').setDescription("Answer today's daily trivia question."))
    .addSubcommand((s) => s.setName('setup').setDescription('Admin: set the daily trivia channel and posting hour.')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to post the daily question in').setRequired(true))
      .addIntegerOption((o) => o.setName('hour').setDescription('Hour (UTC, 0-23) to post at — default 12').setMinValue(0).setMaxValue(23))),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Daily trivia needs MySQL.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') {
      if (!interaction.memberPermissions?.has('ManageGuild')) {
        return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need Manage Server to set up daily trivia.')], ephemeral: true });
      }
      const channel = interaction.options.getChannel('channel');
      const hour = interaction.options.getInteger('hour') ?? 12;
      await daily.saveTriviaSettings(interaction.guildId, { channelId: channel.id, hour, enabled: true });
      return interaction.reply({ embeds: [successEmbed('Daily trivia set up', `🧠 The daily question will post in <#${channel.id}> at **${hour}:00 UTC**. First correct answer wins **${daily.DAILY_WIN_COINS} coins**.`)], ephemeral: true });
    }
    // play
    const now = new Date();
    let row = await daily.getDailyRow(interaction.guildId, now);
    if (!row) {
      row = await daily.postDailyTrivia(interaction.client, interaction.guildId, now);
    }
    if (!row) {
      return interaction.reply({ embeds: [infoEmbed('🧠 Daily trivia', "Daily trivia isn't set up in this server yet — an admin can set it up with /trivia-daily setup.")], ephemeral: true });
    }
    if (row.winner_id) {
      return interaction.reply({ embeds: [infoEmbed('🧠 Daily trivia', `Today's question was already answered by <@${row.winner_id}> — the answer was **${row.answer}**. Come back tomorrow!`)], ephemeral: true });
    }
    const options = JSON.parse(row.options_json || '[]');
    const q = { question: row.question, answer: row.answer };
    return interaction.reply({
      embeds: [daily.dailyEmbed(interaction.guildId, now, q, options, null)],
      components: [daily.dailyRow(interaction.guildId, now, options)],
      ephemeral: true,
    });
  },
};

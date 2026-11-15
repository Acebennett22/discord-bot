const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { NUMBER_EMOJIS, pollEmbed, tallyVotes } = require('../../utils/polls');
const { parseTime } = require('../../utils/timeParse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Start a poll with up to 5 options (reactions, one vote each).')
    .addStringOption((o) => o.setName('question').setDescription('The poll question').setRequired(true).setMaxLength(256))
    .addStringOption((o) => o.setName('option1').setDescription('First option').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('option2').setDescription('Second option').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('option3').setDescription('Third option').setMaxLength(100))
    .addStringOption((o) => o.setName('option4').setDescription('Fourth option').setMaxLength(100))
    .addStringOption((o) => o.setName('option5').setDescription('Fifth option').setMaxLength(100))
    .addStringOption((o) => o.setName('duration').setDescription('Optional: when it ends, e.g. "in 2h" or "tomorrow 9am"')),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Polls only work in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so polls can\'t be created right now.')] });
    const question = interaction.options.getString('question');
    const options = [];
    for (let i = 1; i <= 5; i++) {
      const opt = interaction.options.getString(`option${i}`);
      if (opt) options.push(opt);
    }
    let endsAt = null;
    const durationRaw = interaction.options.getString('duration');
    if (durationRaw) {
      endsAt = parseTime(durationRaw);
      if (!endsAt) return interaction.reply({ embeds: [errorEmbed('Bad duration', 'I couldn\'t understand that time. Try "in 2h", "tomorrow 9am", or "2026-11-14 15:00".')] });
    }
    const poll = { question, options, votes: {}, ends_at: endsAt, ended: false };
    // Post the PUBLIC poll embed in the channel (the exception to ephemeral).
    const sent = await interaction.channel.send({ embeds: [pollEmbed(poll, tallyVotes({}, options.length))] });
    for (let i = 0; i < options.length; i++) {
      await sent.react(NUMBER_EMOJIS[i]).catch(() => {});
    }
    const result = await db.query(
      'INSERT INTO polls (guild_id, message_id, channel_id, question, options, votes, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [interaction.guildId, sent.id, interaction.channelId, question, JSON.stringify(options), '{}', endsAt, interaction.user.id],
    );
    // Auto-end timer for polls with a duration.
    if (endsAt) {
      const delay = endsAt.getTime() - Date.now();
      if (delay > 0 && delay < 7 * 24 * 60 * 60_000) {
        setTimeout(async () => {
          const { getPollByMessage, endPoll } = require('../../utils/polls');
          const fresh = await getPollByMessage(sent.id);
          if (fresh && !fresh.ended) await endPoll(interaction.client, fresh);
        }, delay).unref?.();
      }
    }
    const jump = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${sent.id}`;
    return interaction.reply({ embeds: [successEmbed('Poll started', `Your poll is live — [jump to it](${jump}).${endsAt ? ` It ends <t:${Math.floor(endsAt.getTime() / 1000)}:R>.` : ' End it anytime with /poll-end.'}`)] });
  },
};

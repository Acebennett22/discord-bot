const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { parseTime, discordTimestamp } = require('../../utils/timeParse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Set a personal reminder — I\'ll DM you when it\'s due.')
    .addStringOption((o) => o.setName('time').setDescription('When: "in 2h", "tomorrow 9am", or "2026-11-14 15:00"').setRequired(true))
    .addStringOption((o) => o.setName('text').setDescription('What to remind you about').setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Reminders only work in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so reminders can\'t be set right now.')] });
    const remindAt = parseTime(interaction.options.getString('time'));
    if (!remindAt) {
      return interaction.reply({ embeds: [errorEmbed('Bad time', 'I couldn\'t understand that time. Try "in 2h", "tomorrow 9am", or "2026-11-14 15:00" — it must be in the future.')] });
    }
    const text = interaction.options.getString('text');
    const result = await db.query(
      'INSERT INTO reminders (guild_id, user_id, channel_id, text, remind_at) VALUES (?, ?, ?, ?, ?)',
      [interaction.guildId, interaction.user.id, interaction.channelId, text, remindAt],
    );
    return interaction.reply({ embeds: [successEmbed('Reminder set', `I'll remind you ${discordTimestamp(remindAt)}:\n> ${text.slice(0, 500)}\n\nI'll DM you — if your DMs are closed, I'll post it in this channel instead. (Reminder #${result.insertId})`)] });
  },
};

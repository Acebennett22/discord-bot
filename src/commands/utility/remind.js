const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { parseTime, discordTimestamp } = require('../../utils/timeParse');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set, list, or cancel your personal reminders.')
    .addSubcommand((s) => s.setName('set').setDescription('Set a personal reminder — I\'ll DM you when it\'s due.')
      .addStringOption((o) => o.setName('time').setDescription('When: "in 2h", "tomorrow 9am", or "2026-11-14 15:00"').setRequired(true))
      .addStringOption((o) => o.setName('text').setDescription('What to remind you about').setRequired(true).setMaxLength(1000)))
    .addSubcommand((s) => s.setName('list').setDescription('List your pending reminders in this server.'))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel one of your pending reminders.')
      .addIntegerOption((o) => o.setName('id').setDescription('Reminder ID (see /remind list)').setRequired(true).setMinValue(1))),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Reminders only work in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database offline', 'The database is not connected, so reminders can\'t be used right now.')] });
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const remindAt = parseTime(interaction.options.getString('time'));
      if (!remindAt) {
        return interaction.reply({ embeds: [errorEmbed('Bad time', 'I couldn\'t understand that time. Try "in 2h", "tomorrow 9am", or "2026-11-14 15:00" — it must be in the future.')] });
      }
      const text = interaction.options.getString('text');
      const result = await db.query(
        'INSERT INTO reminders (guild_id, user_id, channel_id, text, remind_at) VALUES (?, ?, ?, ?, ?)',
        [interaction.guildId, interaction.user.id, interaction.channelId, text, remindAt],
      );
      return interaction.reply({ embeds: [successEmbed('Reminder set', `I'll remind you ${discordTimestamp(remindAt)}:\n> ${text.slice(0, 500)}\n\nI'll DM you — if your DMs are closed, I'll post it in this channel instead. (Reminder #${result.insertId})`)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'list') {
      const rows = await db.query(
        'SELECT id, text, remind_at FROM reminders WHERE guild_id = ? AND user_id = ? AND sent = 0 ORDER BY remind_at LIMIT 25',
        [interaction.guildId, interaction.user.id],
      ) || [];
      if (!rows.length) {
        return interaction.reply({ embeds: [infoEmbed('Your reminders', 'You have no pending reminders in this server. Use `/remind set` to add one.')], flags: MessageFlags.Ephemeral });
      }
      const lines = rows.map((r) => `**#${r.id}** — ${discordTimestamp(r.remind_at)}\n> ${String(r.text).slice(0, 200)}`);
      const extra = rows.length === 25 ? '\n\n*(Showing the first 25 — cancel old ones to see more.)*' : '';
      return interaction.reply({ embeds: [infoEmbed(`Your reminders (${rows.length})`, `${lines.join('\n\n')}${extra}`)], flags: MessageFlags.Ephemeral });
    }

    // cancel
    const id = interaction.options.getInteger('id');
    const result = await db.query(
      'DELETE FROM reminders WHERE id = ? AND guild_id = ? AND user_id = ? AND sent = 0',
      [id, interaction.guildId, interaction.user.id],
    );
    if (!result || result.affectedRows === 0) {
      return interaction.reply({ embeds: [errorEmbed('Not found', `No pending reminder **#${id}** belongs to you in this server. Check the ID with \`/remind list\`.`)] });
    }
    return interaction.reply({ embeds: [successEmbed('Reminder cancelled', `Reminder **#${id}** has been cancelled.`)] });
  },
};

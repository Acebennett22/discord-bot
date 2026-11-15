const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { isValidBirthday, isBirthdayToday, ageOn } = require('../../utils/birthdays');
const db = require('../../utils/database');

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Manage your birthday in this server.')
    .addSubcommand((s) => s.setName('set').setDescription('Set your birthday (year is optional).')
      .addIntegerOption((o) => o.setName('month').setDescription('Month (1-12)').setMinValue(1).setMaxValue(12).setRequired(true))
      .addIntegerOption((o) => o.setName('day').setDescription('Day of the month').setMinValue(1).setMaxValue(31).setRequired(true))
      .addIntegerOption((o) => o.setName('year').setDescription('Birth year (optional — only used to show your age)').setMinValue(1900).setMaxValue(new Date().getFullYear())))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove your birthday from this server.'))
    .addSubcommand((s) => s.setName('list').setDescription('See upcoming birthdays in this server.'))
    .addSubcommand((s) => s.setName('today').setDescription("See whose birthday it is today in this server."))
    .addSubcommand((s) => s.setName('next').setDescription('See the next upcoming birthday in this server.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Birthdays need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      const month = interaction.options.getInteger('month');
      const day = interaction.options.getInteger('day');
      const year = interaction.options.getInteger('year');
      if (!isValidBirthday(month, day, year ?? null)) {
        return interaction.reply({ embeds: [errorEmbed('Not a real date', `${MONTH_NAMES[month]} ${day}${year ? `, ${year}` : ''} is not a valid date.`)], ephemeral: true });
      }
      await db.query(
        'INSERT INTO birthdays (guild_id, user_id, month, day, year, announced_last_year) VALUES (?, ?, ?, ?, ?, NULL) ON DUPLICATE KEY UPDATE month = VALUES(month), day = VALUES(day), year = VALUES(year), announced_last_year = NULL',
        [interaction.guildId, interaction.user.id, month, day, year ?? null],
      );
      return interaction.reply({ embeds: [successEmbed('Birthday saved', `🎂 Your birthday is set to **${MONTH_NAMES[month]} ${day}**${year ? `, ${year}` : ''} in this server. The bot will celebrate it on the day!`)], ephemeral: true });
    }
    if (sub === 'remove') {
      await db.query('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?', [interaction.guildId, interaction.user.id]);
      return interaction.reply({ embeds: [successEmbed('Birthday removed', 'Your birthday was removed from this server.')] });
    }
    if (sub === 'today') {
      const now = new Date();
      const rows = await db.query('SELECT user_id, month, day, year FROM birthdays WHERE guild_id = ?', [interaction.guildId]) || [];
      const todays = rows.filter((r) => isBirthdayToday(r, now));
      if (!todays.length) return interaction.reply({ embeds: [infoEmbed('🎂 Birthdays today', 'No birthdays today in this server. See who is next with /birthday next.')] });
      const lines = todays.map((r) => {
        const age = ageOn(r.month, r.day, r.year, now);
        return `<@${r.user_id}> — **${MONTH_NAMES[r.month]} ${r.day}**${age !== null ? ` (turning ${age})` : ''}`;
      });
      return interaction.reply({ embeds: [infoEmbed('🎂 Birthdays today', `🎉 Happy birthday to:\n${lines.join('\n')}`)] });
    }
    if (sub === 'next') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const rows = await db.query('SELECT user_id, month, day, year FROM birthdays WHERE guild_id = ?', [interaction.guildId]) || [];
      if (!rows.length) return interaction.reply({ embeds: [infoEmbed('🎂 Next birthday', 'No birthdays saved in this server yet. Set yours with /birthday set.')] });
      const upcoming = rows.map((r) => {
        let next = new Date(now.getFullYear(), r.month - 1, r.day);
        if (next < todayStart) next = new Date(now.getFullYear() + 1, r.month - 1, r.day);
        const days = Math.round((next - todayStart) / 86_400_000);
        return { ...r, days, nextYear: next.getFullYear() };
      }).sort((a, b) => a.days - b.days);
      const r = upcoming[0];
      const age = r.year ? r.nextYear - r.year : null;
      return interaction.reply({ embeds: [infoEmbed('🎂 Next birthday', `<@${r.user_id}> — **${MONTH_NAMES[r.month]} ${r.day}**${age !== null ? ` (turning ${age})` : ''} — ${r.days === 0 ? '🎂 **today!**' : r.days === 1 ? 'tomorrow!' : `in **${r.days}** days`}`)] });
    }
    // list — next 10 upcoming birthdays, sorted by days until.
    const rows = await db.query('SELECT user_id, month, day, year FROM birthdays WHERE guild_id = ?', [interaction.guildId]) || [];
    if (!rows.length) return interaction.reply({ embeds: [infoEmbed('Birthdays', 'No birthdays saved in this server yet. Set yours with /birthday set.')] });
    const now = new Date();
    const upcoming = rows.map((r) => {
      let next = new Date(now.getFullYear(), r.month - 1, r.day);
      if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next = new Date(now.getFullYear() + 1, r.month - 1, r.day);
      const days = Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
      return { ...r, days };
    }).sort((a, b) => a.days - b.days).slice(0, 10);
    const lines = upcoming.map((r) => {
      const turning = r.year ? ` (turning ${r.days === 0 ? now.getFullYear() - r.year : (new Date(now.getFullYear(), r.month - 1, r.day) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) ? now.getFullYear() - r.year : now.getFullYear() + 1 - r.year)})` : '';
      return `<@${r.user_id}> — **${MONTH_NAMES[r.month]} ${r.day}**${turning} — ${r.days === 0 ? '🎂 **today!**' : `in ${r.days} day(s)`}`;
    });
    return interaction.reply({ embeds: [infoEmbed('🎂 Upcoming birthdays', lines.join('\n'))] });
  },
};

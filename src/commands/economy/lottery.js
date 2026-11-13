const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getPremiumSettings } = require('../../utils/premiumSettings');
const {
  buyTicket, jackpotForWeek, getUserTicket, validateNumbers,
  weekStartOf, formatWeekStart, nextDrawDate, formatDuration,
} = require('../../utils/lottery');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lottery')
    .setDescription('Weekly economy lottery: buy a ticket, check the jackpot, see winners.')
    .addSubcommand((s) => s.setName('buy').setDescription('Buy this week\'s lottery ticket (one per user per week).')
      .addIntegerOption((o) => o.setName('n1').setDescription('First number (1-30)').setMinValue(1).setMaxValue(30))
      .addIntegerOption((o) => o.setName('n2').setDescription('Second number (1-30)').setMinValue(1).setMaxValue(30))
      .addIntegerOption((o) => o.setName('n3').setDescription('Third number (1-30)').setMinValue(1).setMaxValue(30)))
    .addSubcommand((s) => s.setName('status').setDescription('Show the jackpot, your ticket this week, and time until the draw.'))
    .addSubcommand((s) => s.setName('winners').setDescription('Show the results of the last lottery draw.')),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'The lottery only runs in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected, so the lottery is unavailable right now.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const premium = await getPremiumSettings(interaction.guildId);
    const emoji = premium.economyCurrencyEmoji || '🪙';
    const currency = premium.economyCurrencyName || 'coins';
    const week = formatWeekStart(new Date());

    if (sub === 'buy') {
      const given = ['n1', 'n2', 'n3'].map((n) => interaction.options.getInteger(n));
      const anyGiven = given.some((n) => n !== null && n !== undefined);
      if (anyGiven && given.some((n) => n === null || n === undefined)) {
        return interaction.reply({ embeds: [errorEmbed('Numbers incomplete', 'If you pick numbers, give all three (n1, n2 and n3). Leave them all blank for random numbers.')], ephemeral: true });
      }
      if (anyGiven) {
        const check = validateNumbers(given);
        if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Invalid numbers', check.error)], ephemeral: true });
      }
      const result = await buyTicket(interaction.guildId, interaction.user.id, anyGiven ? given : null);
      if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not buy ticket', result.error)], ephemeral: true });
      const drawAt = Math.floor(nextDrawDate().getTime() / 1000);
      return interaction.reply({ embeds: [successEmbed('Lottery ticket bought!', `${emoji} You paid **${result.price} ${currency}** for this week's ticket.\n**Your numbers:** ${result.numbers.join(', ')}\n**Draw:** Sunday 20:00 (server time) — <t:${drawAt}:R>\nGood luck! 🍀`)], ephemeral: true });
    }

    if (sub === 'status') {
      const jackpot = await jackpotForWeek(interaction.guildId, week);
      const ticket = await getUserTicket(interaction.guildId, interaction.user.id, week);
      const drawAt = nextDrawDate();
      const drawUnix = Math.floor(drawAt.getTime() / 1000);
      const weekStart = weekStartOf(new Date()).toLocaleDateString('en-GB');
      return interaction.reply({ embeds: [infoEmbed('🎰 Weekly lottery', `**Jackpot:** ${emoji} ${jackpot} ${currency} (50% of this week's ticket sales)\n**Your ticket:** ${ticket ? ticket.join(', ') : 'None yet — use `/lottery buy`!'}\n**Week started:** ${weekStart} (Monday)\n**Draw:** <t:${drawUnix}:F> (<t:${drawUnix}:R> — ${formatDuration(drawAt - Date.now())} left)`, [
        { name: 'How it works', value: 'Pick 3 numbers from 1–30 (or go random). Match all 3 to split the jackpot; match 2 for a 100-coin consolation. One ticket per user per week.' },
      ])], ephemeral: true });
    }

    // winners — last draw for this guild.
    const rows = await db.query(
      'SELECT week_start, winning_numbers, winner_id, prize FROM lottery_draws WHERE guild_id = ? ORDER BY week_start DESC, drawn_at DESC LIMIT 20',
      [interaction.guildId],
    ) || [];
    if (!rows.length) {
      return interaction.reply({ embeds: [infoEmbed('🎰 Lottery winners', 'No lottery draw has happened in this server yet. The first draw runs Sunday at 20:00 (server time).')], ephemeral: true });
    }
    const lastWeek = rows[0].week_start;
    const lastWeekRows = rows.filter((r) => String(r.week_start) === String(lastWeek));
    let winning = [];
    try { winning = JSON.parse(lastWeekRows[0].winning_numbers || '[]'); } catch {}
    // Draw rows don't record match counts (see lottery_draws schema), so
    // winners are listed together: jackpot winners split the jackpot, and
    // 2-match consolation prizes are always exactly 100 coins.
    const prizeRows = lastWeekRows.filter((r) => r.winner_id);
    const winnerLines = prizeRows.map((r) => `• <@${r.winner_id}> — ${emoji} ${r.prize} ${currency}`);
    const weekLabel = new Date(lastWeek).toLocaleDateString('en-GB');
    const body = `**Week of:** ${weekLabel}\n**Winning numbers:** ${winning.length ? winning.join(', ') : '—'}\n\n**Winners:**\n${winnerLines.length ? winnerLines.join('\n') : 'No winners — the jackpot went unclaimed.'}\n\n_Jackpot winners split the jackpot; 2-match consolation prizes are ${emoji} 100 ${currency} each._`;
    return interaction.reply({ embeds: [infoEmbed('🎰 Last lottery draw', body)], ephemeral: true });
  },
};

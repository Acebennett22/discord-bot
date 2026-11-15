const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getBalance, addCoins, randInt, cooldownRemaining, formatRemaining, WORK_JOBS } = require('../../utils/economy');
const { getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work a shift and earn coins (once per hour).'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Economy only works in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected, so work is unavailable right now.')] });
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    const bal = await getBalance(interaction.guildId, interaction.user.id);
    const remaining = cooldownRemaining(bal.last_work, 60 * 60_000);
    if (remaining > 0) {
      return interaction.reply({ embeds: [errorEmbed('Still on break', `You can work again in **${formatRemaining(remaining)}**.`)] });
    }
    // Work jobs (1.12.3): a member's chosen job sets the payout + flavor.
    const { getUserJob, jobPayout } = require('../../utils/workJobs');
    const userJob = await getUserJob(interaction.guildId, interaction.user.id).catch(() => null);
    const amount = userJob ? jobPayout(userJob) : randInt(settings.economyWorkMin, settings.economyWorkMax);
    const job = userJob ? userJob.flavor_text : WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
    const jobLine = userJob ? ` as a **${userJob.name}**` : '';
    await addCoins(interaction.guildId, interaction.user.id, amount, 'work', `Work: ${job}`);
    await db.query('UPDATE economy_users SET last_work = NOW() WHERE guild_id = ? AND user_id = ?', [interaction.guildId, interaction.user.id]);
    return interaction.reply({ embeds: [successEmbed('Shift complete', `You ${job}${jobLine} and earned ${emoji} **${amount} ${name}**!` )] });
  },
};

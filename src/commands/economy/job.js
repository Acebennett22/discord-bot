const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getPremiumSettings } = require('../../utils/premiumSettings');
const { listJobs, getJobByName, getUserJob, buyJob, setUserJob } = require('../../utils/workJobs');
const { getRank } = require('../../utils/leveling');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('job')
    .setDescription('Choose or unlock a work job — /work pays based on your job.')
    .addSubcommand((s) => s.setName('set').setDescription('Choose a job you have already unlocked.')
      .addStringOption((o) => o.setName('job').setDescription('Job name').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('buy').setDescription('Unlock a job with coins (needs the level requirement).')
      .addStringOption((o) => o.setName('job').setDescription('Job name').setRequired(true).setAutocomplete(true))),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Jobs only work in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const name = interaction.options.getString('job');
    const job = await getJobByName(interaction.guildId, name);
    if (!job) {
      const jobs = await listJobs(interaction.guildId);
      return interaction.reply({ embeds: [errorEmbed('No such job', `There is no job called **${name}** in this server.${jobs.length ? ` Available jobs: ${jobs.map((j) => j.name).join(', ')}` : ''}`)], ephemeral: true });
    }
    const rank = await getRank(interaction.user.id, interaction.guildId).catch(() => null);
    const level = rank?.level ?? 0;
    if (sub === 'set') {
      const owned = await db.query('SELECT 1 FROM user_jobs WHERE guild_id = ? AND user_id = ? AND job_id = ?', [interaction.guildId, interaction.user.id, job.id]);
      // Jobs with cost 0 are free — anyone can pick them.
      if (!owned?.length && (job.cost || 0) > 0) {
        return interaction.reply({ embeds: [errorEmbed('Job not unlocked', `You haven't unlocked **${job.name}** yet — buy it with \`/job buy ${job.name}\` (${job.cost} coins, needs level ${job.required_level}).`)], ephemeral: true });
      }
      await setUserJob(interaction.guildId, interaction.user.id, job.id);
      return interaction.reply({ embeds: [successEmbed('Job set', `You're now working as a **${job.name}** — /work pays ${job.min_payout}–${job.max_payout} coins per shift.`)], ephemeral: true });
    }
    // buy
    const result = await buyJob(interaction.guildId, interaction.user.id, job, level);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Cannot unlock job', result.error)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Job unlocked', `🎉 You unlocked **${job.name}**${job.cost ? ` for ${job.cost} coins` : ''} — and it's now your job. /work pays ${job.min_payout}–${job.max_payout} coins per shift.`)], ephemeral: true });
  },
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const jobs = await listJobs(interaction.guildId).catch(() => []);
    const matches = jobs.filter((j) => j.name.toLowerCase().includes(String(focused || '').toLowerCase())).slice(0, 25);
    await interaction.respond(matches.map((j) => ({ name: `${j.name} (${j.min_payout}–${j.max_payout} coins)`, value: j.name }))).catch(() => {});
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { listJobs, getUserJob } = require('../../utils/workJobs');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jobs')
    .setDescription('List this server\'s work jobs — payouts, unlock cost, and level requirement.'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Jobs only work in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected.')] });
    const jobs = await listJobs(interaction.guildId);
    if (!jobs.length) return interaction.reply({ embeds: [infoEmbed('Jobs', 'No jobs are set up in this server yet. Admins add them from the dashboard Economy tab.')] });
    const current = await getUserJob(interaction.guildId, interaction.user.id);
    const lines = jobs.map((j) => {
      const cost = (j.cost || 0) > 0 ? `${j.cost} coins to unlock` : 'free';
      return `**${j.name}**${current?.id === j.id ? ' ⭐ (your job)' : ''} — ${j.min_payout}–${j.max_payout} coins/shift · ${cost} · needs level ${j.required_level || 0}${j.flavor_text ? `\n_${j.flavor_text}_` : ''}`;
    });
    return interaction.reply({ embeds: [infoEmbed('💼 Work jobs', `${lines.join('\n\n')}\n\nUnlock one with \`/job buy <name>\`, then pick it with \`/job set <name>\`. /work pays based on your job.`)]  });
  },
};

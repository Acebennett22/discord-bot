const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getStreak } = require('../../utils/streaks');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('streak')
    .setDescription('Show a daily streak (current + best + next milestone).')
    .addUserOption((o) => o.setName('user').setDescription('Whose streak to show (default: you)')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Streaks need MySQL.')] });
    const user = interaction.options.getUser('user') || interaction.user;
    const s = await getStreak(interaction.guildId, user.id);
    const nextMilestone = [7, 30, 100].find((m) => m > (s.daily_streak || 0));
    return interaction.reply({
      embeds: [infoEmbed(`🔥 Daily streak — ${user.username}`, `**Current streak:** ${s.daily_streak || 0} day${(s.daily_streak || 0) === 1 ? '' : 's'}\n**Best streak:** ${s.best_streak || 0} days\n${nextMilestone ? `**Next milestone:** ${nextMilestone} days (${nextMilestone - (s.daily_streak || 0)} to go — earns a bonus crate)` : '**All milestones reached!**'}\n\nClaim /daily every day to keep it going — missing a day resets it to 1.`)],
    });
  },
};

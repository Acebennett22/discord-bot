const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { QUESTS, getQuestStates, claimQuest } = require('../../utils/quests');
const { getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quest')
    .setDescription('Daily quests — complete them to earn coins and XP.')
    .addSubcommand((s) => s.setName('list').setDescription('Show today\'s quests and your progress.'))
    .addSubcommand((s) => s.setName('claim').setDescription('Claim a completed quest (or all completed quests).')
      .addStringOption((o) => o.setName('quest').setDescription('Quest ID to claim (omit to claim all completed ones)')
        .addChoices(...QUESTS.map((q) => ({ name: `${q.name} (+${q.coins} coins, +${q.xp} XP)`, value: q.id }))))),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Quests only work in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Quests offline', 'The database is not connected, so quests are unavailable right now.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';

    if (sub === 'list') {
      const { date, states } = await getQuestStates(interaction.guildId, interaction.user.id);
      const lines = states.map((q) => {
        const status = q.claimed ? '✅ Claimed' : q.done ? '🎉 Ready to claim!' : '⬜ Not done yet';
        return `**${q.name}** (\`${q.id}\`) — ${emoji} ${q.coins} ${name} + ${q.xp} XP\n${q.description}\n${status}`;
      });
      return interaction.reply({ embeds: [infoEmbed(`📜 Daily quests — ${date}`, `${lines.join('\n\n')}\n\nClaim with \`/quest claim [quest]\`.` )], ephemeral: true });
    }

    // claim
    const questId = interaction.options.getString('quest');
    if (questId) {
      const res = await claimQuest(interaction.guild, interaction.member, questId);
      if (!res.ok) return interaction.reply({ embeds: [errorEmbed('Could not claim quest', res.error)], ephemeral: true });
      return interaction.reply({ embeds: [successEmbed('Quest complete!', `🎉 **${res.quest.name}** — you earned ${emoji} **${res.coins} ${name}** and **${res.xp} XP**!${res.leveledUp ? `\n🆙 You leveled up to **level ${res.newLevel}**!` : ''}`)], ephemeral: true });
    }
    const { states } = await getQuestStates(interaction.guildId, interaction.user.id);
    const claimable = states.filter((q) => q.done && !q.claimed);
    if (!claimable.length) {
      return interaction.reply({ embeds: [infoEmbed('Nothing to claim', 'No completed, unclaimed quests today. Check your progress with /quest list.')], ephemeral: true });
    }
    const results = [];
    for (const q of claimable) {
      const res = await claimQuest(interaction.guild, interaction.member, q.id);
      if (res.ok) results.push(res);
    }
    if (!results.length) return interaction.reply({ embeds: [errorEmbed('Could not claim quests', 'Something went wrong claiming your quests — please try again.')], ephemeral: true });
    const totalCoins = results.reduce((s, r) => s + r.coins, 0);
    const totalXp = results.reduce((s, r) => s + r.xp, 0);
    const leveled = results.find((r) => r.leveledUp);
    const lines = results.map((r) => `✅ **${r.quest.name}** — ${emoji} ${r.coins} ${name} + ${r.xp} XP`);
    return interaction.reply({ embeds: [successEmbed('Quests claimed!', `${lines.join('\n')}\n\n**Total: ${emoji} ${totalCoins} ${name} + ${totalXp} XP**${leveled ? `\n🆙 You leveled up to **level ${leveled.newLevel}**!` : ''}`)], ephemeral: true });
  },
};

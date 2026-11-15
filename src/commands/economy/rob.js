const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getGuildSettings } = require('../../utils/guildSettings');
const { getPremiumSettings } = require('../../utils/premiumSettings');
const { lastRobAttempt, robCooldownRemaining, attemptRob } = require('../../utils/robbery');
const { formatRemaining } = require('../../utils/economy');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Try to steal coins from another member\'s wallet (35% success).')
    .addUserOption((o) => o.setName('user').setDescription('Who to rob').setRequired(true)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Robbery only works in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected.')] });
    const settings = await getGuildSettings(interaction.guildId);
    if (settings.robberyEnabled === false) {
      return interaction.reply({ embeds: [errorEmbed('Robbery is off', 'Robbery is disabled in this server.')] });
    }
    const target = interaction.options.getUser('user');
    if (target.bot) return interaction.reply({ embeds: [errorEmbed('Nice try', 'You cannot rob a bot.')] });
    if (target.id === interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Nice try', 'You cannot rob yourself.')] });
    const last = await lastRobAttempt(interaction.guildId, interaction.user.id);
    const remaining = robCooldownRemaining(last);
    if (remaining > 0) {
      return interaction.reply({ embeds: [errorEmbed('Lay low', `You're still cooling off — you can rob again in **${formatRemaining(remaining)}**.`)] });
    }
    const premium = await getPremiumSettings(interaction.guildId);
    const emoji = premium.economyCurrencyEmoji || '🪙';
    const name = premium.economyCurrencyName || 'coins';
    const result = await attemptRob(interaction.guildId, interaction.user.id, target.id);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Robbery failed', result.error)] });
    if (result.success) {
      // Let the victim know (best effort — closed DMs are fine).
      await target.send({ embeds: [infoEmbed('🦹 You were robbed!', `<@${interaction.user.id}> stole ${emoji} **${result.amount} ${name}** from your wallet in **${interaction.guild.name}**. Keep coins in your bank (/deposit) — the bank can't be robbed.`)] }).catch(() => {});
      return interaction.reply({ embeds: [successEmbed('Clean getaway!', `🦹 You slipped away with ${emoji} **${result.amount} ${name}** from <@${target.id}>'s wallet!`)] });
    }
    const fineText = result.fine > 0
      ? ` You were caught and paid a ${emoji} **${result.fine} ${name}** fine to <@${target.id}>.`
      : ' You were caught, but you had nothing to pay the fine with.';
    return interaction.reply({ embeds: [errorEmbed('Caught!', `🚨 Your robbery of <@${target.id}> failed.${fineText}`)] });
  },
};

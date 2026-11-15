const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, statsEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const casino = require('../../utils/casino');
const { getPremiumSettings } = require('../../utils/premiumSettings');

// Casino dice — distinct from the fun /dice (no bet). Exact guess = x5.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('gamble-dice')
    .setDescription('Casino: guess the die roll (1-6) — exact guess pays x5.')
    .addIntegerOption((o) => o.setName('bet').setDescription('Coins to bet (min 10, max 10000)').setRequired(true).setMinValue(1))
    .addIntegerOption((o) => o.setName('guess').setDescription('Your guess (1-6)').setRequired(true).setMinValue(1).setMaxValue(6)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Casino games only work in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Casino offline', 'The database is not connected, so casino games are unavailable right now.')] });
    const bet = interaction.options.getInteger('bet');
    const guess = interaction.options.getInteger('guess');
    const remaining = casino.cooldownRemainingMs(interaction.user.id);
    if (remaining > 0) return interaction.reply({ embeds: [errorEmbed('Slow down', `Wait **${Math.ceil(remaining / 1000)}s** between casino games.`)] });
    const check = await casino.validateBet(interaction.guildId, interaction.user.id, bet);
    if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Bet rejected', check.error)] });
    casino.markPlayed(interaction.user.id);
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    await casino.placeBet(interaction.guildId, interaction.user.id, bet);

    const roll = 1 + Math.floor(Math.random() * 6);
    const won = roll === guess;
    if (won) await casino.payout(interaction.guildId, interaction.user.id, bet * 5, 'Dice exact guess x5');
    return interaction.reply({
      embeds: [statsEmbed(
        won ? '🎲 Dice — you won!' : '🎲 Dice — you lost',
        `The die landed on **${roll}** — you guessed **${guess}**.\n**Bet:** ${emoji} ${bet} ${name}\n**Return:** ${emoji} ${won ? bet * 5 : 0} ${name}\n**Net:** ${won ? `+${bet * 4}` : `-${bet}`} ${name}`,
      )],
    });
  },
};

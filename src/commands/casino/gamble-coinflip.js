const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, statsEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const casino = require('../../utils/casino');
const { getPremiumSettings } = require('../../utils/premiumSettings');

// Casino coin flip — distinct from the fun /coinflip (no bet). Win = x2.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('gamble-coinflip')
    .setDescription('Casino: bet on a coin flip — win pays x2.')
    .addIntegerOption((o) => o.setName('bet').setDescription('Coins to bet (min 10, max 10000)').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('choice').setDescription('Heads or tails').setRequired(true)
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Casino games only work in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Casino offline', 'The database is not connected, so casino games are unavailable right now.')] });
    const bet = interaction.options.getInteger('bet');
    const choice = interaction.options.getString('choice');
    const remaining = casino.cooldownRemainingMs(interaction.user.id);
    if (remaining > 0) return interaction.reply({ embeds: [errorEmbed('Slow down', `Wait **${Math.ceil(remaining / 1000)}s** between casino games.`)] });
    const check = await casino.validateBet(interaction.guildId, interaction.user.id, bet);
    if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Bet rejected', check.error)] });
    casino.markPlayed(interaction.user.id);
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    await casino.placeBet(interaction.guildId, interaction.user.id, bet);

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === choice;
    if (won) await casino.payout(interaction.guildId, interaction.user.id, bet * 2, 'Coin flip win x2');
    return interaction.reply({
      embeds: [statsEmbed(
        won ? '🪙 Coin flip — you won!' : '🪙 Coin flip — you lost',
        `The coin landed on **${result}** — you picked **${choice}**.\n**Bet:** ${emoji} ${bet} ${name}\n**Return:** ${emoji} ${won ? bet * 2 : 0} ${name}\n**Net:** ${won ? `+${bet}` : `-${bet}`} ${name}`,
      )],
    });
  },
};

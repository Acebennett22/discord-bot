const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, statsEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const casino = require('../../utils/casino');
const { getPremiumSettings } = require('../../utils/premiumSettings');

const REELS = ['🍒', '🍋', '🍇', '💎', '7️⃣', '⭐'];
const PAYOUTS = { '💎💎💎': 10, '7️⃣7️⃣7️⃣': 7 };

function spin() {
  return [0, 1, 2].map(() => REELS[Math.floor(Math.random() * REELS.length)]);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Casino: spin the 3-reel slot machine. Three of a kind wins big!')
    .addIntegerOption((o) => o.setName('bet').setDescription('Coins to bet (min 10, max 10000)').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Casino games only work in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Casino offline', 'The database is not connected, so casino games are unavailable right now.')], ephemeral: true });
    const bet = interaction.options.getInteger('bet');
    const remaining = casino.cooldownRemainingMs(interaction.user.id);
    if (remaining > 0) return interaction.reply({ embeds: [errorEmbed('Slow down', `Wait **${Math.ceil(remaining / 1000)}s** between casino games.`)], ephemeral: true });
    const check = await casino.validateBet(interaction.guildId, interaction.user.id, bet);
    if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Bet rejected', check.error)], ephemeral: true });
    casino.markPlayed(interaction.user.id);
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    await casino.placeBet(interaction.guildId, interaction.user.id, bet);

    const reels = spin();
    const [a, b, c] = reels;
    let multiplier = 0;
    let resultText = 'No match — you lose your bet.';
    if (a === b && b === c) {
      multiplier = PAYOUTS[reels.join('')] || 5;
      resultText = `🎉 **JACKPOT!** Three of a kind — **x${multiplier}**!`;
    } else if (a === b || b === c || a === c) {
      multiplier = 2;
      resultText = 'Two of a kind — **x2**!';
    }
    if (multiplier > 0) {
      await casino.payout(interaction.guildId, interaction.user.id, bet * multiplier, `Slots ${reels.join('')} x${multiplier}`);
    }
    const net = multiplier > 0 ? bet * multiplier - bet : -bet;
    const title = multiplier > 0 ? '🎰 Slots — you won!' : '🎰 Slots — you lost';
    return interaction.reply({
      embeds: [statsEmbed(title,
        `${reels.join(' | ')}\n\n${resultText}\n**Bet:** ${emoji} ${bet} ${name}\n**Return:** ${emoji} ${bet * multiplier} ${name}\n**Net:** ${net >= 0 ? '+' : ''}${net} ${name}`)],
      ephemeral: true,
    });
  },
};

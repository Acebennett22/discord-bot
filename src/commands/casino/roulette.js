const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, statsEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const casino = require('../../utils/casino');
const { getPremiumSettings } = require('../../utils/premiumSettings');

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function colorOf(n) {
  if (n === 0) return 'green';
  return REDS.has(n) ? 'red' : 'black';
}
const COLOR_EMOJI = { red: '🔴', black: '⚫', green: '🟢' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Casino: bet on red/black (x2), green 0 (x14), or an exact number (x35).')
    .addIntegerOption((o) => o.setName('bet').setDescription('Coins to bet (min 10, max 10000)').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('choice').setDescription('red, black, green, or a number 0-36').setRequired(true)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Casino games only work in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Casino offline', 'The database is not connected, so casino games are unavailable right now.')], ephemeral: true });
    const bet = interaction.options.getInteger('bet');
    const rawChoice = interaction.options.getString('choice').trim().toLowerCase();
    let kind;
    let number = null;
    if (['red', 'black', 'green'].includes(rawChoice)) kind = rawChoice;
    else if (/^\d+$/.test(rawChoice) && parseInt(rawChoice, 10) >= 0 && parseInt(rawChoice, 10) <= 36) { kind = 'number'; number = parseInt(rawChoice, 10); }
    else {
      return interaction.reply({ embeds: [errorEmbed('Invalid bet', 'Choice must be **red**, **black**, **green**, or a number **0–36**.')], ephemeral: true });
    }
    const remaining = casino.cooldownRemainingMs(interaction.user.id);
    if (remaining > 0) return interaction.reply({ embeds: [errorEmbed('Slow down', `Wait **${Math.ceil(remaining / 1000)}s** between casino games.`)], ephemeral: true });
    const check = await casino.validateBet(interaction.guildId, interaction.user.id, bet);
    if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Bet rejected', check.error)], ephemeral: true });
    casino.markPlayed(interaction.user.id);
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    await casino.placeBet(interaction.guildId, interaction.user.id, bet);

    const winningNumber = Math.floor(Math.random() * 37);
    const winningColor = colorOf(winningNumber);
    let multiplier = 0;
    if (kind === 'number' && number === winningNumber) multiplier = 35;
    else if (kind === 'green' && winningColor === 'green') multiplier = 14;
    else if ((kind === 'red' || kind === 'black') && winningColor === kind) multiplier = 2;
    if (multiplier > 0) await casino.payout(interaction.guildId, interaction.user.id, bet * multiplier, `Roulette ${kind} x${multiplier}`);
    const betText = kind === 'number' ? `number ${number}` : kind;
    return interaction.reply({
      embeds: [statsEmbed(
        multiplier > 0 ? '🎡 Roulette — you won!' : '🎡 Roulette — you lost',
        `The ball landed on ${COLOR_EMOJI[winningColor]} **${winningNumber} ${winningColor}** — you bet on **${betText}**.\n${multiplier > 0 ? `Payout **x${multiplier}**!` : 'No win this time.'}\n**Bet:** ${emoji} ${bet} ${name}\n**Return:** ${emoji} ${bet * multiplier} ${name}\n**Net:** ${multiplier > 0 ? `+${bet * multiplier - bet}` : `-${bet}`} ${name}`,
      )],
      ephemeral: true,
    });
  },
};

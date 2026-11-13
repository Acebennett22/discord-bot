const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed, statsEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const casino = require('../../utils/casino');
const { createGame, endGame, dealerPlay } = require('../../utils/blackjack');
const { handValue, formatHand } = require('../../utils/casino');
const { getPremiumSettings } = require('../../utils/premiumSettings');

function buttons(gameId, disabled) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`blackjack:hit:${gameId}`).setLabel('Hit').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`blackjack:stand:${gameId}`).setLabel('Stand').setStyle(ButtonStyle.Success).setDisabled(disabled),
  )];
}

function gameEmbed(game, revealDealer, titleOverride) {
  const playerValue = handValue(game.player);
  const dealerShown = revealDealer ? game.dealer : [game.dealer[0]];
  const dealerValue = revealDealer ? handValue(game.dealer) : handValue(dealerShown);
  const dealerLine = revealDealer
    ? `**Dealer:** ${formatHand(game.dealer)} (${dealerValue})`
    : `**Dealer:** ${formatHand(dealerShown)} + ❓ (${dealerValue}+)`;
  const title = titleOverride || '🃏 Blackjack';
  return statsEmbed(title, `${dealerLine}\n**You:** ${formatHand(game.player)} (${playerValue})\n\n**Bet:** ${game.bet} coins`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Casino: play blackjack vs the dealer. Blackjack pays 3:2, win pays x2, push returns your bet.')
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
    await casino.placeBet(interaction.guildId, interaction.user.id, bet);

    const game = createGame({ guildId: interaction.guildId, userId: interaction.user.id, bet });
    const playerValue = handValue(game.player);
    const dealerValue = handValue(game.dealer);
    const playerBJ = playerValue === 21 && game.player.length === 2;
    const dealerBJ = dealerValue === 21 && game.dealer.length === 2;

    if (playerBJ || dealerBJ) {
      // Immediate resolution — no buttons needed.
      if (playerBJ && dealerBJ) {
        await casino.refund(game.guildId, game.userId, bet);
        endGame(game.id);
        return interaction.reply({ embeds: [gameEmbed(game, true, '🃏 Blackjack — push!')], components: [], ephemeral: true });
      }
      if (playerBJ) {
        // 3:2 — credit stake + 1.5x stake, rounded down to whole coins.
        const payoutAmount = bet + Math.floor(bet * 3 / 2);
        await casino.payout(game.guildId, game.userId, payoutAmount, 'Blackjack 3:2');
        endGame(game.id);
        return interaction.reply({ embeds: [gameEmbed(game, true, '🃏 BLACKJACK! You win 3:2!')], components: [], ephemeral: true });
      }
      // Dealer blackjack — stake already deducted, game over.
      endGame(game.id);
      return interaction.reply({ embeds: [gameEmbed(game, true, '🃏 Dealer blackjack — you lose')], components: [], ephemeral: true });
    }

    await interaction.reply({ embeds: [gameEmbed(game, false)], components: buttons(game.id, false), ephemeral: true });
    // Auto-stand after 2 minutes of inactivity so the game can't hang forever.
    setTimeout(async () => {
      const stillThere = require('../../utils/blackjack').getGame(game.id);
      if (!stillThere || stillThere.over) return;
      stillThere.over = true;
      try {
        dealerPlay(stillThere);
        const pv = handValue(stillThere.player);
        const dv = handValue(stillThere.dealer);
        let title = '🃏 Blackjack — time out, auto-stand';
        if (dv > 21 || pv > dv) { await casino.payout(stillThere.guildId, stillThere.userId, bet * 2, 'Blackjack win x2'); title = '🃏 Blackjack — you won! (auto-stand)'; }
        else if (pv === dv) { await casino.refund(stillThere.guildId, stillThere.userId, bet); title = '🃏 Blackjack — push (auto-stand)'; }
        await interaction.editReply({ embeds: [gameEmbed(stillThere, true, title)], components: [] });
      } catch { /* interaction may be gone; nothing to do */ }
      endGame(game.id);
    }, 120000).unref?.();
  },
};

// Button handler for /blackjack (Hit / Stand). Runs as a normal event
// listener — interactionCreate.js only handles slash commands, so
// button clicks need their own listener. Only the player who started
// the game can press its buttons.
const { errorEmbed, statsEmbed } = require('../utils/embeds');
const casino = require('../utils/casino');
const { getGame, endGame, dealerPlay } = require('../utils/blackjack');
const { handValue, formatHand } = require('../utils/casino');

function gameEmbed(game, revealDealer, title) {
  const playerValue = handValue(game.player);
  const dealerShown = revealDealer ? game.dealer : [game.dealer[0]];
  const dealerValue = revealDealer ? handValue(game.dealer) : handValue(dealerShown);
  const dealerLine = revealDealer
    ? `**Dealer:** ${formatHand(game.dealer)} (${dealerValue})`
    : `**Dealer:** ${formatHand(dealerShown)} + ❓ (${dealerValue}+)`;
  return statsEmbed(title, `${dealerLine}\n**You:** ${formatHand(game.player)} (${playerValue})\n\n**Bet:** ${game.bet} coins`);
}

async function settle(interaction, game, title) {
  game.over = true;
  endGame(game.id);
  await interaction.update({ embeds: [gameEmbed(game, true, title)], components: [] });
}

module.exports = {
  name: 'blackjackInteraction',
  once: false,
  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('blackjack:')) return;
    const [, action, gameId] = interaction.customId.split(':');
    const game = getGame(gameId);
    if (!game || game.over) {
      return interaction.reply({ embeds: [errorEmbed('Game over', 'This blackjack hand has already finished.')] });
    }
    if (interaction.user.id !== game.userId) {
      return interaction.reply({ embeds: [errorEmbed('Not your game', 'Only the player who started this hand can hit or stand.')] });
    }

    if (action === 'hit') {
      game.player.push(game.deck.pop());
      const value = handValue(game.player);
      if (value > 21) {
        // Bust — stake already deducted, nothing to credit.
        return settle(interaction, game, '🃏 Bust! You lose');
      }
      if (value === 21) {
        // Auto-stand on 21.
        dealerPlay(game);
        const dv = handValue(game.dealer);
        if (dv > 21 || value > dv) { await casino.payout(game.guildId, game.userId, game.bet * 2, 'Blackjack win x2'); return settle(interaction, game, '🃏 You win!'); }
        if (value === dv) { await casino.refund(game.guildId, game.userId, game.bet); return settle(interaction, game, '🃏 Push — bet returned'); }
        return settle(interaction, game, '🃏 Dealer wins');
      }
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`blackjack:hit:${game.id}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`blackjack:stand:${game.id}`).setLabel('Stand').setStyle(ButtonStyle.Success),
      );
      return interaction.update({ embeds: [gameEmbed(game, false, '🃏 Blackjack')], components: [row] });
    }

    if (action === 'stand') {
      dealerPlay(game);
      const pv = handValue(game.player);
      const dv = handValue(game.dealer);
      if (dv > 21 || pv > dv) { await casino.payout(game.guildId, game.userId, game.bet * 2, 'Blackjack win x2'); return settle(interaction, game, '🃏 You win!'); }
      if (pv === dv) { await casino.refund(game.guildId, game.userId, game.bet); return settle(interaction, game, '🃏 Push — bet returned'); }
      return settle(interaction, game, '🃏 Dealer wins');
    }
  },
};

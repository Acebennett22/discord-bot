// In-memory blackjack game state (one active game per user).
// Games live only in memory — a restart ends any in-progress hand
// (the stake was already deducted, so no coins are created or lost
// by the restart; the hand simply cannot be finished).
const { createDeck, handValue } = require('./casino');

const games = new Map(); // gameId -> game
let counter = 0;

function newGameId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function createGame({ guildId, userId, bet }) {
  const deck = createDeck();
  const game = {
    id: newGameId(),
    guildId,
    userId,
    bet,
    deck,
    player: [deck.pop(), deck.pop()],
    dealer: [deck.pop(), deck.pop()],
    over: false,
    createdAt: Date.now(),
  };
  games.set(game.id, game);
  return game;
}

function getGame(id) {
  return games.get(id);
}

function endGame(id) {
  games.delete(id);
}

function dealerPlay(game) {
  while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop());
  return game.dealer;
}

module.exports = { createGame, getGame, endGame, dealerPlay };

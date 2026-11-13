const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const wordle = require('../../utils/wordle');

function boardEmbed(game, guildName) {
  const done = game.won || game.attempts >= wordle.MAX_GUESSES;
  const title = game.won ? '🟩 Wordle — you got it!' : done ? '⬜ Wordle — out of guesses' : '🟩 Wordle';
  const lines = [
    `**${guildName}** — ${game.date}`,
    '',
    wordle.renderBoard(game.guesses, game.word),
    '',
    `Guesses: **${game.attempts}/${wordle.MAX_GUESSES}** · Streak: **${game.streak}**`,
  ];
  if (game.won) lines.push(`\n🎉 The word was **${game.word.toUpperCase()}** — come back tomorrow!`);
  else if (done) lines.push(`\nThe word was **${game.word.toUpperCase()}**. Better luck tomorrow!`);
  else lines.push('\nGuess a 5-letter word — 🟩 right letter, right spot · 🟨 right letter, wrong spot · ⬜ not in the word.');
  return infoEmbed(title, lines.join('\n'));
}

function guessRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wordle:guess').setLabel('🔤 Guess a word').setStyle(ButtonStyle.Primary),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wordle')
    .setDescription("Play today's Wordle — one word per server per day, 6 guesses."),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Wordle needs MySQL.')], ephemeral: true });
    const game = await wordle.getOrCreateGame(interaction.guildId, interaction.user.id);
    const done = game.won || game.attempts >= wordle.MAX_GUESSES;
    return interaction.reply({
      embeds: [boardEmbed(game, interaction.guild?.name || 'Wordle')],
      components: done ? [] : [guessRow()],
      ephemeral: true,
    });
  },
};

// Shared helpers for the modal + button event handler.
module.exports.boardEmbed = boardEmbed;
module.exports.guessRow = guessRow;
module.exports.openGuessModal = (interaction) => {
  const modal = new ModalBuilder()
    .setCustomId('wordle:guess')
    .setTitle('Wordle — your guess');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('word')
      .setLabel('5-letter word')
      .setStyle(TextInputStyle.Short)
      .setMinLength(5)
      .setMaxLength(5)
      .setRequired(true)
      .setPlaceholder('e.g. CRANE'),
  ));
  return interaction.showModal(modal);
};

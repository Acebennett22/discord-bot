// Wordle modal + Guess button — customId 'wordle:guess'.
const { MessageFlags, Events } = require('discord.js');
const { errorEmbed, infoEmbed, successEmbed } = require('../utils/embeds');
const wordle = require('../utils/wordle');
const wordleCmd = require('../commands/fun/wordle');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (interaction.isButton() && interaction.customId === 'wordle:guess') {
      return wordleCmd.openGuessModal(interaction);
    }
    if (!interaction.isModalSubmit() || interaction.customId !== 'wordle:guess') return;
    const guess = (interaction.fields.getTextInputValue('word') || '').toLowerCase().trim();
    const result = await wordle.submitGuess(interaction.guildId, interaction.user.id, guess).catch(() => null);
    if (!result) return interaction.reply({ embeds: [errorEmbed('Wordle error', 'Something went wrong — try again.')] });
    if (result.status === 'invalid') {
      return interaction.reply({ embeds: [errorEmbed('Not a word', `"${guess.toUpperCase()}" isn't in the word list — try another 5-letter word.`)], flags: MessageFlags.Ephemeral });
    }
    const game = result.game;
    const done = game.won || game.attempts >= wordle.MAX_GUESSES;
    const embed = wordleCmd.boardEmbed(game, interaction.guild?.name || 'Wordle');
    if (result.status === 'won') {
      return interaction.reply({ embeds: [successEmbed('🎉 You got it!', `**${game.word.toUpperCase()}** in ${game.attempts} guess${game.attempts === 1 ? '' : 'es'} — streak **${game.streak}**!`), embed], components: [], flags: MessageFlags.Ephemeral });
    }
    if (result.status === 'lost') {
      return interaction.reply({ embeds: [infoEmbed('⬜ Out of guesses', `The word was **${game.word.toUpperCase()}**. Your streak resets — try again tomorrow!`), embed], components: [], flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ embeds: [embed], components: done ? [] : [wordleCmd.guessRow()], flags: MessageFlags.Ephemeral });
  },
};

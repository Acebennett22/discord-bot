const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Deterministic hash (FNV-1a) of the two user IDs, order-independent, so the
// same pair always gets the same compatibility score.
function compatibilityScore(idA, idB) {
  const [first, second] = [idA, idB].sort();
  const input = `${first}:${second}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 101; // 0–100
}

function compatibilityBar(score, length = 10) {
  const filled = Math.round((score / 100) * length);
  return '💖'.repeat(filled) + '🤍'.repeat(length - filled);
}

function compatibilityLabel(score) {
  if (score >= 90) return 'A match made in heaven! 💍';
  if (score >= 75) return 'Serious chemistry! 🔥';
  if (score >= 60) return 'Looking good! 😊';
  if (score >= 40) return 'There\'s potential… 🤔';
  if (score >= 20) return 'Might need some work… 😅';
  return 'Just friends, probably. 💔';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ship')
    .setDescription('Check the compatibility between two members.')
    .addUserOption((o) => o.setName('user').setDescription('First member').setRequired(true))
    .addUserOption((o) => o.setName('user2').setDescription('Second member (defaults to you)')),
  async execute(interaction) {
    const userA = interaction.options.getUser('user');
    const userB = interaction.options.getUser('user2') || interaction.user;
    const score = compatibilityScore(userA.id, userB.id);
    const embed = new EmbedBuilder()
      .setColor(0xff69b4)
      .setTitle('💘 Ship check!')
      .setDescription(`${userA} ❤️ ${userB}\n\n**Compatibility: ${score}%**\n${compatibilityBar(score)}\n\n*${compatibilityLabel(score)}*`)
      .setTimestamp()
      .setFooter({ text: 'Vikings Hall • /utility help' });
    // Public post: a ship result is meant to be seen in the channel.
    return interaction.reply({ embeds: [embed] });
  },
};

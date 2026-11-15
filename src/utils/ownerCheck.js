// Owner-only guard. Never leaks the owner ID in the reply.
const config = require('./config');
const { errorEmbed } = require('./embeds');

function isOwner(userId) {
  return Boolean(config.ownerId) && userId === config.ownerId;
}

async function requireOwner(interaction) {
  if (isOwner(interaction.user.id)) return true;
  await interaction.reply({
    embeds: [errorEmbed('Owner only', '⛔ This command is owner-only.')],
  }).catch(() => {});
  return false;
}

module.exports = { isOwner, requireOwner };

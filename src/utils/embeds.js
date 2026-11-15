// THE single embed builder — every command reply must be an embed.
// Styling: color from config.json embedColor (brand color), timestamp on
// every embed, footer "Vikings Hall • /utility help". Success = green, error = red,
// info/stats = brand color. Never reply with plain text as the main response.
const { EmbedBuilder } = require('discord.js');
const config = require('./config');

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(config.embedColor || '#5865F2')
    .setTimestamp()
    .setFooter({ text: 'Vikings Hall • /utility help' });
}

function successEmbed(title, description) {
  return baseEmbed().setColor(0x57f287).setTitle(`✅ ${title}`).setDescription(description);
}

function errorEmbed(title, description) {
  return baseEmbed().setColor(0xed4245).setTitle(`❌ ${title}`).setDescription(description);
}

function infoEmbed(title, description, fields) {
  const embed = baseEmbed().setTitle(title).setDescription(description);
  if (fields?.length) embed.addFields(fields);
  return embed;
}

// Stats pages use the brand color with the same base styling.
function statsEmbed(title, description, fields) {
  return infoEmbed(title, description, fields);
}

module.exports = { baseEmbed, successEmbed, errorEmbed, infoEmbed, statsEmbed };

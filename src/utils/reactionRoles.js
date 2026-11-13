// Reaction roles — button-based (preferred). Classic reactions are NOT used:
// buttons are reliable, don't need the GuildMessageReactions intent, and
// can't be spoofed by reacting to the wrong message.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');

function emojiLabel(emoji) {
  // Custom emoji <:name:id> -> show name; unicode -> itself.
  const m = /^<a?:(\w+):\d+>$/.exec(emoji);
  return m ? m[1] : emoji;
}

function emojiButton(emoji, roleId) {
  const btn = new ButtonBuilder().setCustomId(`rr:${roleId}`).setLabel(emojiLabel(emoji)).setStyle(ButtonStyle.Secondary);
  // Custom emoji need the raw <...:...> form; unicode emoji go in directly.
  if (/^<a?:\w+:\d+>$/.test(emoji)) {
    const [,, id] = emoji.replace(/[<>]/g, '').split(':');
    btn.setEmoji(id);
  } else {
    btn.setEmoji(emoji);
  }
  return btn;
}

async function getMappings(messageId) {
  if (!db.isEnabled()) return [];
  return (await db.query('SELECT * FROM reaction_roles WHERE message_id = ?', [messageId])) || [];
}

async function buildRows(messageId) {
  const mappings = await getMappings(messageId);
  const rows = [];
  for (let i = 0; i < mappings.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      ...mappings.slice(i, i + 5).map((m) => emojiButton(m.emoji, m.role_id)),
    ));
  }
  return rows;
}

module.exports = { emojiLabel, emojiButton, getMappings, buildRows };

// Ticket ratings (1.8.2): when a ticket closes, the creator is DM'd a
// 1–5 star prompt (buttons + optional comment modal). Ratings feed the
// Staff → Tickets dashboard page and /ticket-ratings. DMs closed = skip
// silently and log it.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('./database');
const { infoEmbed, successEmbed } = require('./embeds');
const errorLogger = require('./errorLogger');

const STARS = ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];

function ratingRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) => new ButtonBuilder()
      .setCustomId(`trating:${ticketId}:${n}`)
      .setLabel(`${n}⭐`)
      .setStyle(n >= 4 ? ButtonStyle.Success : n === 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  );
}

function commentRow(ticketId, rating) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`trating-addcomment:${ticketId}:${rating}`).setLabel('💬 Add a comment').setStyle(ButtonStyle.Secondary),
  );
}

async function promptRating(client, guildId, ticketId, userId, channelName) {
  if (!db.isEnabled()) return;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (!member) return;
  await member.send({
    embeds: [infoEmbed('⭐ Rate your support', `Your ticket **#${channelName}** was closed. How was the support you received?\n\nTap a star rating below — you can add a comment after.` )],
    components: [ratingRow(ticketId)],
  }).catch(() => {
    errorLogger.log({ level: 'info', guildId, commandName: 'ticket-ratings', message: `Rating DM skipped — user ${userId} has DMs closed (ticket #${ticketId}).` });
  });
}

async function saveRating(ticketId, guildId, userId, rating, comment) {
  await db.query(
    'INSERT INTO ticket_ratings (ticket_id, guild_id, user_id, rating, comment) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)',
    [ticketId, guildId, userId, rating, comment || null],
  );
}

async function getRatingStats(guildId) {
  if (!db.isEnabled()) return { average: null, count: 0, recent: [] };
  const rows = await db.query('SELECT AVG(rating) AS avg, COUNT(*) AS n FROM ticket_ratings WHERE guild_id = ?', [guildId]) || [];
  const recent = await db.query('SELECT * FROM ticket_ratings WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10', [guildId]) || [];
  return { average: rows[0]?.avg ? Number(rows[0].avg) : null, count: rows[0]?.n || 0, recent };
}

function commentModal(ticketId, rating) {
  const modal = new ModalBuilder().setCustomId(`trating-comment:${ticketId}:${rating}`).setTitle('Add a comment (optional)');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('comment').setLabel('Anything to add?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500).setPlaceholder('Tell us what went well — or what could be better…'),
  ));
  return modal;
}

module.exports = { STARS, ratingRow, commentRow, promptRating, saveRating, getRatingStats, commentModal };

// Suggestions: members submit ideas, the server votes with 👍/👎 buttons
// (one vote per user, changeable), staff approve/deny/mark implemented.
// Everything in MySQL (suggestions + suggestion_votes); the suggestion
// channel is guild_settings.suggestion_channel_id. Vote counts on the
// embed are kept in sync with the DB on every vote.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const { getGuildSettings } = require('./guildSettings');

const STATUS_LABEL = { pending: '⏳ Pending', approved: '✅ Approved', denied: '❌ Denied', implemented: '🚀 Implemented' };
const STATUS_COLOR = { pending: 0x5865f2, approved: 0x57f287, denied: 0xed4245, implemented: 0xfee75c };

async function getSuggestion(id, guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM suggestions WHERE id = ? AND guild_id = ?', [id, guildId]);
  return rows?.[0] || null;
}

async function createSuggestion(guildId, userId, channelId, title, text) {
  const res = await db.query(
    'INSERT INTO suggestions (guild_id, user_id, suggestion_channel_id, title, text) VALUES (?, ?, ?, ?, ?)',
    [guildId, userId, channelId, title, text],
  );
  return res.insertId;
}

function suggestionEmbed(s) {
  return new EmbedBuilder()
    .setColor(STATUS_COLOR[s.status] ?? 0x5865f2)
    .setTitle(`💡 ${s.title}`)
    .setDescription(s.text.slice(0, 4000))
    .addFields(
      { name: 'Suggested by', value: `<@${s.user_id}>`, inline: true },
      { name: 'Status', value: STATUS_LABEL[s.status] || s.status, inline: true },
      { name: 'Votes', value: `👍 ${s.votes_up} · 👎 ${s.votes_down}`, inline: true },
    )
    .setFooter({ text: `Suggestion #${s.id} • Ace Bot` })
    .setTimestamp(new Date(s.created_at));
}

function voteRow(suggestionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`suggest_up:${suggestionId}`).setEmoji('👍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`suggest_down:${suggestionId}`).setEmoji('👎').setStyle(ButtonStyle.Secondary),
  );
}

function reviewRow(suggestionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`suggest_approve:${suggestionId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`suggest_deny:${suggestionId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`suggest_implement:${suggestionId}`).setLabel('Mark implemented').setStyle(ButtonStyle.Primary),
  );
}

// One vote per user; voting the same way again removes the vote (toggle),
// voting the other way switches it. Counts are recalculated from
// suggestion_votes so the DB and the embed can never drift apart.
async function castVote(suggestionId, guildId, userId, vote) {
  const s = await getSuggestion(suggestionId, guildId);
  if (!s) return { ok: false, error: 'Suggestion not found.' };
  if (s.status !== 'pending') return { ok: false, error: `That suggestion is already ${s.status}.` };
  const existing = await db.query('SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?', [suggestionId, userId]);
  if (existing?.length && existing[0].vote === vote) {
    await db.query('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?', [suggestionId, userId]);
  } else {
    await db.query(
      'INSERT INTO suggestion_votes (suggestion_id, user_id, vote) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE vote = VALUES(vote)',
      [suggestionId, userId, vote],
    );
  }
  const counts = await db.query(
    "SELECT SUM(vote = 'up') AS up, SUM(vote = 'down') AS down FROM suggestion_votes WHERE suggestion_id = ?",
    [suggestionId]);
  const up = Number(counts?.[0]?.up || 0);
  const down = Number(counts?.[0]?.down || 0);
  await db.query('UPDATE suggestions SET votes_up = ?, votes_down = ? WHERE id = ?', [up, down, suggestionId]);
  return { ok: true, up, down, suggestion: { ...s, votes_up: up, votes_down: down } };
}

async function syncEmbed(guild, suggestion) {
  if (!suggestion.message_id) return;
  const channel = guild.channels.cache.get(suggestion.suggestion_channel_id)
    || await guild.channels.fetch(suggestion.suggestion_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(suggestion.message_id).catch(() => null);
  if (!message) return;
  const components = suggestion.status === 'pending'
    ? [voteRow(suggestion.id), reviewRow(suggestion.id)]
    : [];
  await message.edit({ embeds: [suggestionEmbed(suggestion)], components }).catch(() => {});
}

async function isReviewer(member, settings) {
  if (!member) return false;
  if (member.permissions?.has('Administrator')) return true;
  const reviewerRole = settings.applicationReviewerRoleId;
  return reviewerRole ? member.roles.cache.has(reviewerRole) : false;
}

async function reviewSuggestion(guild, suggestion, decision, reviewer) {
  if (suggestion.status !== 'pending') return { ok: false, error: `Already ${suggestion.status}.` };
  await db.query(
    "UPDATE suggestions SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
    [decision, reviewer.id, suggestion.id],
  );
  const updated = { ...suggestion, status: decision };
  await syncEmbed(guild, updated);
  // DM the suggester (best effort — closed DMs are not fatal).
  try {
    const user = await guild.client.users.fetch(suggestion.user_id);
    await user.send(`Your suggestion **"${suggestion.title}"** (#${suggestion.id}) in **${guild.name}** was **${decision}** by ${reviewer.user?.tag || reviewer.id}.`);
  } catch {}
  return { ok: true, suggestion: updated };
}

module.exports = {
  STATUS_LABEL, STATUS_COLOR, getSuggestion, createSuggestion,
  suggestionEmbed, voteRow, reviewRow, castVote, syncEmbed,
  isReviewer, reviewSuggestion, getGuildSettings,
};

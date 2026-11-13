// Polls: reaction-based voting (1️⃣–5️⃣), one vote per user, live tally
// stored in MySQL. The embed is re-rendered on every vote and on end.
const { EmbedBuilder } = require('discord.js');
const db = require('./database');

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

function tallyVotes(votes, optionCount) {
  const counts = Array(optionCount).fill(0);
  for (const idx of Object.values(votes || {})) {
    if (Number.isInteger(idx) && idx >= 0 && idx < optionCount) counts[idx]++;
  }
  return counts;
}

function pollEmbed(poll, counts) {
  const options = poll.options;
  const total = counts.reduce((a, b) => a + b, 0);
  const lines = options.map((opt, i) => {
    const n = counts[i];
    const pct = total ? Math.round((n / total) * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    return `${NUMBER_EMOJIS[i]} **${opt}** — ${n} vote${n === 1 ? '' : 's'} (${pct}%)\n${bar}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📊 ${poll.question}`)
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: poll.ended ? `Poll ended • ${total} total vote${total === 1 ? '' : 's'}` : `Poll • ${total} total vote${total === 1 ? '' : 's'} • React to vote` })
    .setTimestamp(poll.ends_at ? new Date(poll.ends_at) : new Date());
  return embed;
}

async function getPollByMessage(messageId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM polls WHERE message_id = ?', [messageId]);
  if (!rows?.length) return null;
  const poll = rows[0];
  try { poll.options = JSON.parse(poll.options); } catch { poll.options = []; }
  try { poll.votes = JSON.parse(poll.votes); } catch { poll.votes = {}; }
  return poll;
}

async function saveVotes(poll) {
  await db.query('UPDATE polls SET votes = ? WHERE id = ?', [JSON.stringify(poll.votes), poll.id]);
}

async function refreshPollMessage(client, poll) {
  try {
    const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(poll.message_id).catch(() => null);
    if (!msg) return;
    const counts = tallyVotes(poll.votes, poll.options.length);
    await msg.edit({ embeds: [pollEmbed(poll, counts)] }).catch(() => {});
  } catch {}
}

async function endPoll(client, poll) {
  if (poll.ended) return poll;
  await db.query('UPDATE polls SET ended = 1 WHERE id = ?', [poll.id]);
  poll.ended = true;
  const counts = tallyVotes(poll.votes, poll.options.length);
  const top = Math.max(...counts, 0);
  const winners = poll.options.filter((_, i) => counts[i] === top && top > 0);
  try {
    const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(poll.message_id).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [pollEmbed(poll, counts)] }).catch(() => {});
        await msg.reactions.removeAll().catch(() => {});
      }
      await channel.send({
        embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`📊 Poll ended: ${poll.question}`)
          .setDescription(winners.length ? `🏆 **Winner:** ${winners.join(', ')} (${top} vote${top === 1 ? '' : 's'})` : 'No votes were cast.')],
      }).catch(() => {});
    }
  } catch {}
  return poll;
}

module.exports = { NUMBER_EMOJIS, tallyVotes, pollEmbed, getPollByMessage, saveVotes, refreshPollMessage, endPoll };

// Giveaways: button entry (one entry per user), timer checks for ended
// giveaways, random winner pick, announcement + winner DM.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const { successEmbed } = require('./embeds');

function parseDuration(str) {
  const m = /^(\d+)([smhd])$/.exec(String(str).trim().toLowerCase());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return n * mult;
}

function giveawayEmbed(giveaway, entrants = 0) {
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`🎉 Giveaway: ${giveaway.prize}`)
    .setDescription(`Click **🎉 Enter** below to join!\n\n**Winners:** ${giveaway.winners_count}\n**Entries:** ${entrants}\n**Ends:** <t:${Math.floor(new Date(giveaway.ends_at).getTime() / 1000)}:R>`)
    .setTimestamp(new Date(giveaway.ends_at));
}

function enterRow(giveawayId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway_enter:${giveawayId}`).setLabel('🎉 Enter').setStyle(ButtonStyle.Primary),
  );
}

function pickWinners(entrants, count) {
  const pool = [...entrants];
  const winners = [];
  while (pool.length && winners.length < count) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return winners;
}

async function endGiveaway(client, giveaway, { reroll = false } = {}) {
  const entrants = await db.query('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?', [giveaway.id]) || [];
  const winnerIds = pickWinners(entrants.map((e) => e.user_id), giveaway.winners_count);
  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  const winnersText = winnerIds.length ? winnerIds.map((id) => `<@${id}>`).join(', ') : 'No entries — no winner.';
  if (channel?.isTextBased()) {
    await channel.send({
      content: winnerIds.length ? `🎉 **Giveaway ended!** Congratulations ${winnersText} — you won **${giveaway.prize}**!` : `🎉 Giveaway for **${giveaway.prize}** ended with no entries.`,
      embeds: [new EmbedBuilder().setColor(0xffd700).setTitle(`Giveaway ${reroll ? 're-rolled' : 'ended'}: ${giveaway.prize}`).setDescription(`**Winner(s):** ${winnersText}`)],
    }).catch(() => {});
    // DM winners if possible.
    for (const id of winnerIds) {
      const user = await client.users.fetch(id).catch(() => null);
      if (user) await user.send({ embeds: [successEmbed('You won!', `🎉 You won **${giveaway.prize}** in ${channel.guild?.name || 'a server'}!`)] }).catch(() => {});
    }
  }
  await db.query("UPDATE giveaways SET status = 'ended' WHERE id = ?", [giveaway.id]);
  return winnerIds;
}

async function checkEndedGiveaways(client) {
  if (!db.isEnabled()) return;
  const rows = await db.query("SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= NOW()");
  for (const g of rows || []) {
    await endGiveaway(client, g).catch((e) => console.warn('[giveaway] end failed:', e.message));
  }
}

function startGiveawayChecker(client) {
  setInterval(() => checkEndedGiveaways(client).catch(() => {}), 30_000);
}

module.exports = { parseDuration, giveawayEmbed, enterRow, pickWinners, endGiveaway, checkEndedGiveaways, startGiveawayChecker };

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
  const reqs = [
    giveaway.required_role_id ? `Requires the <@&${giveaway.required_role_id}> role` : null,
    giveaway.min_days_in_server !== null && giveaway.min_days_in_server !== undefined ? `Requires ${giveaway.min_days_in_server}+ days in the server` : null,
    giveaway.min_level !== null && giveaway.min_level !== undefined ? `Requires leveling level ${giveaway.min_level}+` : null,
  ].filter(Boolean);
  const bonus = [
    giveaway.bonus_role_id ? `Holders of <@&${giveaway.bonus_role_id}> get +${giveaway.bonus_entries || 1} bonus entries` : null,
    giveaway.bonus_role_id || giveaway.bonus_entries ? 'Nitro boosters get +1 bonus entry' : null,
  ].filter(Boolean);
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`🎉 Giveaway: ${giveaway.prize}`)
    .setDescription(`Click **🎉 Enter** below to join!\n\n**Winners:** ${giveaway.winners_count}\n**Entries:** ${entrants}\n**Ends:** <t:${Math.floor(new Date(giveaway.ends_at).getTime() / 1000)}:R>${reqs.length ? `\n\n**Requirements:** ${reqs.join(' · ')}` : ''}${bonus.length ? `\n\n**Bonus entries:** ${bonus.join(' · ')}` : ''}`)
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

// Weighted draw (1.12.4): each entrant holds 1 + bonus entries. `weights`
// is [{ userId, entries }]; a winner's tickets are removed after winning,
// so one person can never win twice in the same draw.
function pickWeightedWinners(weights, count, rand = Math.random) {
  const pool = weights.filter((w) => w.entries > 0).map((w) => ({ ...w }));
  const winners = [];
  while (pool.length && winners.length < count) {
    const total = pool.reduce((s, w) => s + w.entries, 0);
    let roll = rand() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= pool[idx].entries;
      if (roll < 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    winners.push(pool[idx].userId);
    pool.splice(idx, 1);
  }
  return winners;
}

// Bonus entries for one entrant (1.12.4): +N for holding the giveaway's
// bonus role, +1 for being a Nitro booster when the guild has a booster
// role configured. Returns { bonus, reasons[] }.
async function computeBonusEntries(giveaway, member) {
  let bonus = 0;
  const reasons = [];
  if (giveaway.bonus_role_id && member.roles.cache.has(giveaway.bonus_role_id)) {
    const n = giveaway.bonus_entries || 1;
    bonus += n;
    reasons.push(`+${n} for the <@&${giveaway.bonus_role_id}> role`);
  }
  if (member.premiumSince) {
    const { getGuildSettings } = require('./guildSettings');
    const settings = await getGuildSettings(member.guild.id).catch(() => null);
    if (settings?.boosterRoleId) {
      bonus += 1;
      reasons.push('+1 Nitro booster');
    }
  }
  return { bonus, reasons };
}

async function recordBonusEntry(giveawayId, userId, bonus, reason) {
  if (!bonus) return;
  await db.query(
    'INSERT INTO giveaway_bonus (giveaway_id, user_id, bonus_entries, reason) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE bonus_entries = VALUES(bonus_entries), reason = VALUES(reason)',
    [giveawayId, userId, bonus, reason || null],
  );
}

async function getEntryWeights(giveawayId) {
  const entrants = await db.query('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?', [giveawayId]) || [];
  const bonuses = await db.query('SELECT user_id, bonus_entries FROM giveaway_bonus WHERE giveaway_id = ?', [giveawayId]) || [];
  const bonusByUser = new Map(bonuses.map((b) => [b.user_id, b.bonus_entries]));
  return entrants.map((e) => ({ userId: e.user_id, entries: 1 + (bonusByUser.get(e.user_id) || 0) }));
}

async function endGiveaway(client, giveaway, { reroll = false } = {}) {
  const weights = await getEntryWeights(giveaway.id);
  const winnerIds = pickWeightedWinners(weights, giveaway.winners_count);
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

module.exports = { parseDuration, giveawayEmbed, enterRow, pickWinners, pickWeightedWinners, computeBonusEntries, recordBonusEntry, getEntryWeights, endGiveaway, checkEndedGiveaways, startGiveawayChecker };

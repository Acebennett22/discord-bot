// Economy heist — a group gamble. One player starts a heist with a bet;
// others join with a button within 60 seconds. Success chance is 40% +
// 10% per extra crew member (cap 90%). Success: everyone gets their bet
// back x2. Failure: everyone loses their bet. Bets use the wallet balance.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const config = require('./config');
const { getBalance, addCoins } = require('./economy');
const { infoEmbed, successEmbed, errorEmbed } = require('./embeds');
const errorLogger = require('./errorLogger');

const HEIST_WINDOW_MS = 60_000;
const HEIST_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per user.

const activeHeists = new Map(); // heistId -> { guildId, channelId, messageId, bet, members: Set, timer }
const cooldowns = new Map(); // userId -> timestamp of last heist

function heistLimits() {
  const eco = config.economy || {};
  return { min: eco.heistMinBet ?? 50, max: eco.heistMaxBet ?? 5000 };
}

function successChance(memberCount) {
  return Math.min(90, 40 + 10 * Math.max(0, memberCount - 1));
}

// Pure logic, stub-testable: resolve a heist from crew size + a roll 0-99.
function resolveHeist(memberCount, roll) {
  return roll < successChance(memberCount);
}

async function startHeist(interaction, bet) {
  const { min, max } = heistLimits();
  if (bet < min || bet > max) return { ok: false, error: `Heist bets must be between ${min} and ${max} coins.` };
  const last = cooldowns.get(interaction.user.id) || 0;
  if (Date.now() - last < HEIST_COOLDOWN_MS) {
    const mins = Math.ceil((HEIST_COOLDOWN_MS - (Date.now() - last)) / 60_000);
    return { ok: false, error: `You're on heist cooldown — try again in about ${mins} minutes.` };
  }
  const bal = await getBalance(interaction.guildId, interaction.user.id);
  if (!bal) return { ok: false, error: 'Database unavailable — the economy is offline right now.' };
  if (bal.balance < bet) return { ok: false, error: `You only have ${bal.balance} coins in your wallet.` };
  const deducted = await addCoins(interaction.guildId, interaction.user.id, -bet, 'heist_bet', 'Heist buy-in');
  if (!deducted) return { ok: false, error: 'Could not take your bet — try again.' };

  const rows = await db.query(
    'INSERT INTO heists (guild_id, channel_id, bet, members_json, status) VALUES (?, ?, ?, ?, ?)',
    [interaction.guildId, interaction.channelId, bet, JSON.stringify([interaction.user.id]), 'forming'],
  );
  const heistId = rows?.insertId;
  if (!heistId) return { ok: false, error: 'Could not start the heist — try again.' };
  cooldowns.set(interaction.user.id, Date.now());

  const embed = infoEmbed('💰 Heist forming!',
    `<@${interaction.user.id}> is planning a heist — buy-in **${bet} coins**.\n\nJoin within 60 seconds! Success chance grows with the crew: **${successChance(1)}%** with 1 member, +10% per extra member (max 90%).\n\nCrew so far (1): <@${interaction.user.id}>`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`heist_join:${heistId}`).setLabel('Join the heist').setStyle(ButtonStyle.Success).setEmoji('💰'),
  );
  const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
  const heist = { id: heistId, guildId: interaction.guildId, channelId: interaction.channelId, messageId: msg.id, bet, members: new Set([interaction.user.id]) };
  heist.timer = setTimeout(() => finishHeist(interaction.client, heist).catch((e) => errorLogger.log({ level: 'error', guildId: heist.guildId, commandName: 'heist', message: `Heist finish failed: ${e.message}`, stack: e.stack })), HEIST_WINDOW_MS);
  activeHeists.set(heistId, heist);
  return { ok: true, heistId, messageId: msg.id };
}

async function joinHeist(interaction, heistId) {
  const heist = activeHeists.get(heistId);
  if (!heist) return { ok: false, error: 'That heist has already started or ended.' };
  if (heist.members.has(interaction.user.id)) return { ok: false, error: "You're already in this heist!" };
  const last = cooldowns.get(interaction.user.id) || 0;
  if (Date.now() - last < HEIST_COOLDOWN_MS) return { ok: false, error: "You're on heist cooldown — sit this one out." };
  const bal = await getBalance(heist.guildId, interaction.user.id);
  if (!bal) return { ok: false, error: 'Database unavailable — the economy is offline right now.' };
  if (bal.balance < heist.bet) return { ok: false, error: `You need ${heist.bet} coins in your wallet to join (you have ${bal.balance}).` };
  const deducted = await addCoins(heist.guildId, interaction.user.id, -heist.bet, 'heist_bet', 'Heist buy-in');
  if (!deducted) return { ok: false, error: 'Could not take your bet — try again.' };
  cooldowns.set(interaction.user.id, Date.now());
  heist.members.add(interaction.user.id);
  await db.query('UPDATE heists SET members_json = ? WHERE id = ?', [JSON.stringify([...heist.members]), heist.id]);
  const channel = interaction.guild.channels.cache.get(heist.channelId)
    || await interaction.guild.channels.fetch(heist.channelId).catch(() => null);
  const msg = channel ? await channel.messages.fetch(heist.messageId).catch(() => null) : null;
  if (msg) {
    const crew = [...heist.members].map((id) => `<@${id}>`).join(', ');
    await msg.edit({ embeds: [infoEmbed('💰 Heist forming!',
      `Buy-in **${heist.bet} coins**. Join within 60 seconds!\n\nSuccess chance with this crew: **${successChance(heist.members.size)}%**.\n\nCrew (${heist.members.size}): ${crew}`)] }).catch(() => {});
  }
  return { ok: true, bet: heist.bet };
}

async function finishHeist(client, heist) {
  activeHeists.delete(heist.id);
  const roll = Math.floor(Math.random() * 100);
  const success = resolveHeist(heist.members.size, roll);
  const members = [...heist.members];
  if (success) {
    for (const id of members) await addCoins(heist.guildId, id, heist.bet * 2, 'heist_win', 'Heist success payout');
  }
  await db.query('UPDATE heists SET status = ? WHERE id = ?', [success ? 'success' : 'failed', heist.id]);
  const guild = client.guilds.cache.get(heist.guildId) || await client.guilds.fetch(heist.guildId).catch(() => null);
  const channel = guild?.channels.cache.get(heist.channelId) || await guild?.channels.fetch(heist.channelId).catch(() => null);
  const msg = channel ? await channel.messages.fetch(heist.messageId).catch(() => null) : null;
  const crew = members.map((id) => `<@${id}>`).join(', ');
  const embed = success
    ? successEmbed('💰 Heist succeeded!', `The crew pulled it off! (${successChance(members.length)}% chance, rolled ${roll}.)\n\n${crew}\nEach member gets **${heist.bet * 2} coins** (bet back x2).`)
    : errorEmbed('💰 Heist failed!', `The crew got caught! (${successChance(members.length)}% chance, rolled ${roll}.)\n\n${crew}\nEveryone lost their **${heist.bet} coin** buy-in.`);
  if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
  else if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { activeHeists, cooldowns, heistLimits, successChance, resolveHeist, startHeist, joinHeist, finishHeist, HEIST_WINDOW_MS };

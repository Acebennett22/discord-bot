const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getBalance, addCoins, randInt, cooldownRemaining, formatRemaining } = require('../../utils/economy');
const { getPremiumSettings } = require('../../utils/premiumSettings');
const inv = require('../../utils/inventory');

// Daily loot table (on top of the coin reward — see README "Daily items"):
//   50.0%  +50–150 bonus coins
//   25.0%  Common Crate
//   15.0%  Lucky Coin (consumable, /use for 50–200 coins)
//    7.0%  Rare Crate
//    2.5%  Legendary Crate
//    0.5%  2,500-coin jackpot
async function grantDailyLoot(interaction, emoji, name) {
  await inv.ensureDefaultItems(interaction.guildId);
  const roll = randInt(1, 1000);
  if (roll <= 500) {
    const bonus = randInt(50, 150);
    await addCoins(interaction.guildId, interaction.user.id, bonus, 'daily_bonus', 'Daily loot: bonus coins');
    return `Plus a bonus **${emoji} ${bonus} ${name}**!`;
  }
  if (roll <= 750) return grantItem(interaction, 'Common Crate');
  if (roll <= 900) return grantItem(interaction, 'Lucky Coin');
  if (roll <= 970) return grantItem(interaction, 'Rare Crate');
  if (roll <= 995) return grantItem(interaction, 'Legendary Crate');
  await addCoins(interaction.guildId, interaction.user.id, 2500, 'daily_bonus', 'Daily loot: JACKPOT');
  return `🎉 **JACKPOT!** Plus **${emoji} 2,500 ${name}**!`;
}

async function grantItem(interaction, itemName) {
  const item = await inv.getShopItemByName(interaction.guildId, itemName);
  if (!item) return 'Plus a mystery reward that vanished into the void (shop item missing).';
  await inv.addItem(interaction.guildId, interaction.user.id, item.id, 1);
  await db.query('INSERT INTO economy_transactions (guild_id, user_id, amount, type, reason) VALUES (?, ?, ?, ?, ?)',
    [interaction.guildId, interaction.user.id, 0, 'daily_item', `Daily loot: ${item.name}`]);
  const verb = item.type === 'crate' ? 'Open it with /open-crate!' : item.type === 'consumable' ? 'Use it with /use!' : 'See /inventory!';
  return `Plus a ${inv.itemLabel(item)}! ${verb}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily coins (once every 24 hours).'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Economy only works in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Economy offline', 'The database is not connected, so daily rewards are unavailable right now.')], ephemeral: true });
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    const bal = await getBalance(interaction.guildId, interaction.user.id);
    const remaining = cooldownRemaining(bal.last_daily, 24 * 60 * 60_000);
    if (remaining > 0) {
      return interaction.reply({ embeds: [errorEmbed('Daily already claimed', `Come back in **${formatRemaining(remaining)}** for your next daily reward.`)], ephemeral: true });
    }
    const amount = randInt(settings.economyDailyMin, settings.economyDailyMax);
    await addCoins(interaction.guildId, interaction.user.id, amount, 'daily', 'Daily reward');
    await db.query('UPDATE economy_users SET last_daily = NOW() WHERE guild_id = ? AND user_id = ?', [interaction.guildId, interaction.user.id]);
    const loot = await grantDailyLoot(interaction, emoji, name);
    return interaction.reply({ embeds: [successEmbed('Daily reward', `${emoji} You claimed **${amount} ${name}**!\n${loot}\nCome back tomorrow for more.`)], ephemeral: true });
  },
};

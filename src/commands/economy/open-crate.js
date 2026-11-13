const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const inv = require('../../utils/inventory');
const { addCoins, randInt } = require('../../utils/economy');

// 10s per-user cooldown (in-memory) so crates can't be spammed open.
const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('open-crate')
    .setDescription('Open one crate from your inventory and reveal the loot.')
    .addIntegerOption((o) => o.setName('item').setDescription('Crate item ID (see /inventory)').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Crates only work in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Offline', 'The database is not connected, so crates are unavailable right now.')], ephemeral: true });
    const last = cooldowns.get(interaction.user.id);
    if (last && Date.now() - last < 10_000) {
      return interaction.reply({ embeds: [errorEmbed('Slow down', `Wait **${Math.ceil((10_000 - (Date.now() - last)) / 1000)}s** before opening another crate.`)], ephemeral: true });
    }
    const itemId = interaction.options.getInteger('item');
    await inv.ensureDefaultItems(interaction.guildId);
    const item = await inv.getShopItem(interaction.guildId, itemId);
    if (!item) return interaction.reply({ embeds: [errorEmbed('Not found', `No shop item with ID #${itemId}.`)], ephemeral: true });
    if (item.type !== 'crate') return interaction.reply({ embeds: [errorEmbed('Not a crate', `**${item.name}** is a ${item.type} item, not a crate.`)], ephemeral: true });
    const have = await inv.getInventoryQuantity(interaction.guildId, interaction.user.id, itemId);
    if (have < 1) return interaction.reply({ embeds: [errorEmbed('No crate', `You don't have a ${inv.itemLabel(item)} in your inventory. Buy one with /buy ${itemId}.`)], ephemeral: true });
    const entry = inv.rollCrateContents(item);
    if (!entry) return interaction.reply({ embeds: [errorEmbed('Empty crate', 'This crate has no rewards configured — ask an admin to set its contents with /shop-add.')], ephemeral: true });
    cooldowns.set(interaction.user.id, Date.now());
    setTimeout(() => cooldowns.delete(interaction.user.id), 11_000).unref?.();

    const removed = await inv.removeItem(interaction.guildId, interaction.user.id, itemId, 1);
    if (!removed) return interaction.reply({ embeds: [errorEmbed('Open failed', 'Your inventory changed — try again.')], ephemeral: true });

    const settings = await require('../../utils/premiumSettings').getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const cname = settings.economyCurrencyName || 'coins';
    let lootLine = '';
    let coinsWon = 0;
    if (entry.kind === 'coins') {
      coinsWon = randInt(entry.min ?? 0, entry.max ?? entry.min ?? 0);
      await addCoins(interaction.guildId, interaction.user.id, coinsWon, 'crate_open', `Opened ${item.name} (#${item.id}): ${coinsWon} coins`);
      lootLine = `${emoji} **${coinsWon} ${cname}**`;
    } else if (entry.kind === 'item') {
      const reward = await inv.getShopItemByName(interaction.guildId, entry.item_name);
      if (reward) {
        await inv.addItem(interaction.guildId, interaction.user.id, reward.id, 1);
        await db.query('INSERT INTO economy_transactions (guild_id, user_id, amount, type, reason) VALUES (?, ?, ?, ?, ?)',
          [interaction.guildId, interaction.user.id, 0, 'crate_open', `Opened ${item.name} (#${item.id}): won ${reward.name}`]);
        lootLine = `${inv.itemLabel(reward)} (added to your inventory!)`;
      } else {
        // Named reward doesn't exist in this guild's shop — fall back to coins.
        coinsWon = 100;
        await addCoins(interaction.guildId, interaction.user.id, coinsWon, 'crate_open', `Opened ${item.name} (#${item.id}): fallback ${coinsWon} coins (reward item missing)`);
        lootLine = `${emoji} **${coinsWon} ${cname}** (the crate's item reward wasn't in the shop, so you got coins instead)`;
      }
    }
    return interaction.reply({ embeds: [successEmbed(`📦 You opened a ${item.name}!`, `Inside you found:\n${lootLine}`)], ephemeral: true });
  },
};

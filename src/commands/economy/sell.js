const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const inv = require('../../utils/inventory');
const { addCoins } = require('../../utils/economy');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Sell items from your inventory back for coins.')
    .addIntegerOption((o) => o.setName('item').setDescription('Shop item ID (see /inventory)').setRequired(true).setMinValue(1))
    .addIntegerOption((o) => o.setName('quantity').setDescription('How many (default 1)').setMinValue(1).setMaxValue(99)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Selling only works in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Shop offline', 'The database is not connected, so selling is unavailable right now.')] });
    const itemId = interaction.options.getInteger('item');
    const quantity = interaction.options.getInteger('quantity') || 1;
    const item = await inv.getShopItem(interaction.guildId, itemId);
    if (!item) return interaction.reply({ embeds: [errorEmbed('Not found', `No shop item with ID #${itemId}.`)] });
    if (item.type === 'role') return interaction.reply({ embeds: [errorEmbed("Can't sell that", 'Role items are granted as Discord roles, not inventory items — they can\'t be sold back.')] });
    const have = await inv.getInventoryQuantity(interaction.guildId, interaction.user.id, itemId);
    if (have < quantity) return interaction.reply({ embeds: [errorEmbed('Not enough', `You only have ${have}x ${inv.itemLabel(item)} in your inventory.`)] });
    const unitPrice = inv.sellPriceOf(item);
    const total = unitPrice * quantity;
    const removed = await inv.removeItem(interaction.guildId, interaction.user.id, itemId, quantity);
    if (!removed) return interaction.reply({ embeds: [errorEmbed('Sell failed', 'Your inventory changed — try again.')] });
    await addCoins(interaction.guildId, interaction.user.id, total, 'shop_sell', `Sold ${quantity}x ${item.name} (#${item.id})`);
    const settings = await require('../../utils/premiumSettings').getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    return interaction.reply({ embeds: [successEmbed('Sold!', `You sold ${inv.itemLabel(item)} x${quantity} for ${emoji} ${total} ${name} (${unitPrice} each).`)] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { statsEmbed, errorEmbed, successEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const inv = require('../../utils/inventory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse the server shop — or buy an item by ID.')
    .addIntegerOption((o) => o.setName('buy').setDescription('Item ID to buy (see the list first)').setMinValue(1)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'The shop only works in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Shop offline', 'The database is not connected, so the shop is unavailable right now.')] });
    const settings = await require('../../utils/premiumSettings').getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    await inv.ensureDefaultItems(interaction.guildId);
    const buyId = interaction.options.getInteger('buy');

    if (buyId) {
      const item = await inv.getShopItem(interaction.guildId, buyId);
      if (!item) return interaction.reply({ embeds: [errorEmbed('Not found', `No shop item with ID #${buyId}. Use /shop to see the list.`)] });
      const res = await inv.buyItem(interaction, item, 1);
      if (!res.ok) return interaction.reply({ embeds: [errorEmbed('Could not buy', res.error)] });
      const where = item.type === 'role' ? 'The role has been granted.' : 'It has been added to your inventory — see /inventory.';
      return interaction.reply({ embeds: [successEmbed('Purchase complete', `${inv.itemLabel(item)} — ${emoji} ${res.total} ${name}${res.onDeal ? ' (daily deal price!)' : ''}.\n${where}${res.roleNote || ''}`)] });
    }

    const items = await inv.getShopItems(interaction.guildId);
    const deal = await inv.getDailyDeal(interaction.guildId);
    if (!items.length) return interaction.reply({ embeds: [statsEmbed('🛒 Shop', 'The shop is empty — an admin can add items with /shop-add.')] });
    const lines = items.map((i) => {
      const price = inv.dealPrice(i, deal);
      const onDeal = deal && String(deal.item_id) === String(i.id);
      const tag = i.type === 'role' ? ` (grants <@&${i.role_id}>)` : i.type === 'crate' ? ' (open with /open-crate)' : i.type === 'consumable' ? ' (use with /use)' : '';
      const sell = i.type === 'role' ? '' : ` — sells for ${emoji} ${inv.sellPriceOf(i)}`;
      return `${onDeal ? '⭐ **DAILY DEAL −25%** ' : ''}**#${i.id} — ${i.emoji ? `${i.emoji} ` : ''}${i.name}** — ${onDeal ? `~~${i.price}~~ ` : ''}${emoji} ${price} ${name}${sell}${tag}${i.description ? `\n  ${i.description}` : ''}`;
    });
    return interaction.reply({ embeds: [statsEmbed('🛒 Shop', `${lines.join('\n\n')}\n\nBuy with \`/buy <id> [quantity]\` or \`/shop buy:<id>\`. Sell back with \`/sell <id> [quantity]\`.` )] });
  },
};

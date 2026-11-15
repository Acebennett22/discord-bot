const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const inv = require('../../utils/inventory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy an item from the server shop (wallet balance).')
    .addIntegerOption((o) => o.setName('item').setDescription('Shop item ID (see /shop)').setRequired(true).setMinValue(1))
    .addIntegerOption((o) => o.setName('quantity').setDescription('How many (default 1)').setMinValue(1).setMaxValue(99)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'The shop only works in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Shop offline', 'The database is not connected, so the shop is unavailable right now.')] });
    const itemId = interaction.options.getInteger('item');
    const quantity = interaction.options.getInteger('quantity') || 1;
    await inv.ensureDefaultItems(interaction.guildId);
    const item = await inv.getShopItem(interaction.guildId, itemId);
    if (!item) return interaction.reply({ embeds: [errorEmbed('Not found', `No shop item with ID #${itemId}. Use /shop to see the list.`)] });
    const res = await inv.buyItem(interaction, item, quantity);
    if (!res.ok) return interaction.reply({ embeds: [errorEmbed('Could not buy', res.error)] });
    const settings = await require('../../utils/premiumSettings').getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    const where = item.type === 'role' ? 'The role has been granted.' : 'It has been added to your inventory — see /inventory.';
    return interaction.reply({
      embeds: [successEmbed('Purchase complete', `${inv.itemLabel(item)} x${quantity} — ${emoji} ${res.total} ${name}${res.onDeal ? ' (daily deal price!)' : ''}.\n${where}${res.roleNote || ''}`)],
    });
  },
};

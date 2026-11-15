const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const inv = require('../../utils/inventory');
const { addCoins, randInt } = require('../../utils/economy');

// Consumable effects. Only Lucky Coin has one so far — other consumables
// are kept, not consumed, until an effect is added for them.
async function applyConsumable(interaction, item) {
  if (item.name === 'Lucky Coin') {
    const amount = randInt(50, 200);
    await addCoins(interaction.guildId, interaction.user.id, amount, 'consumable_use', 'Used a Lucky Coin');
    return { ok: true, text: `🍀 The Lucky Coin sparkles and turns into **${amount} coins**!` };
  }
  return { ok: false, text: `**${item.name}** doesn't do anything yet — kept in your inventory.` };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use a consumable item from your inventory.')
    .addIntegerOption((o) => o.setName('item').setDescription('Consumable item ID (see /inventory)').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Items only work in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Offline', 'The database is not connected, so items are unavailable right now.')] });
    const itemId = interaction.options.getInteger('item');
    const item = await inv.getShopItem(interaction.guildId, itemId);
    if (!item) return interaction.reply({ embeds: [errorEmbed('Not found', `No shop item with ID #${itemId}.`)] });
    if (item.type !== 'consumable') return interaction.reply({ embeds: [errorEmbed('Not usable', `**${item.name}** is a ${item.type} item — only consumables can be used.`)] });
    const have = await inv.getInventoryQuantity(interaction.guildId, interaction.user.id, itemId);
    if (have < 1) return interaction.reply({ embeds: [errorEmbed('Not owned', `You don't have a ${inv.itemLabel(item)} in your inventory.`)] });
    const res = await applyConsumable(interaction, item);
    if (!res.ok) return interaction.reply({ embeds: [errorEmbed('No effect', res.text)] });
    await inv.removeItem(interaction.guildId, interaction.user.id, itemId, 1);
    return interaction.reply({ embeds: [successEmbed('Used!', res.text)] });
  },
};

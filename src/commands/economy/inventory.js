const { SlashCommandBuilder } = require('discord.js');
const { statsEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const inv = require('../../utils/inventory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Show your items (or another member\'s).')
    .addUserOption((o) => o.setName('user').setDescription('Whose inventory to show (default: you)')),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'Inventories only exist in a server.')] });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Offline', 'The database is not connected, so inventories are unavailable right now.')] });
    const target = interaction.options.getUser('user') || interaction.user;
    const items = await inv.getInventory(interaction.guildId, target.id);
    const bal = await inv.getBalance(interaction.guildId, target.id);
    const settings = await require('../../utils/premiumSettings').getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';
    const title = target.id === interaction.user.id ? '🎒 Your inventory' : `🎒 ${target.username}'s inventory`;
    if (!items.length) {
      return interaction.reply({ embeds: [statsEmbed(title, `Empty — buy something with /buy or open a crate!\n**Wallet:** ${emoji} ${bal?.balance ?? 0} ${name} | **Bank:** ${emoji} ${bal?.bank ?? 0} ${name}`)] });
    }
    const lines = items.map((i) => `${i.emoji ? `${i.emoji} ` : ''}**${i.name}** x${i.quantity} — ${i.type}${i.type !== 'role' ? ` (sells for ${emoji} ${inv.sellPriceOf(i)} each)` : ''}`);
    return interaction.reply({ embeds: [statsEmbed(title, `${lines.join('\n')}\n\n**Wallet:** ${emoji} ${bal?.balance ?? 0} ${name} | **Bank:** ${emoji} ${bal?.bank ?? 0} ${name}\n\nSell with \`/sell <item id> [quantity]\` — item IDs are in /shop.`)] });
  },
};

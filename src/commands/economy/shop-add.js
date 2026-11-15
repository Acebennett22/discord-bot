const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getPremiumSettings } = require('../../utils/premiumSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop-add')
    .setDescription('Admin only: add an item to the server shop.')
    .addStringOption((o) => o.setName('name').setDescription('Item name').setRequired(true).setMaxLength(128))
    .addIntegerOption((o) => o.setName('price').setDescription('Price in coins').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('description').setDescription('What the item is').setMaxLength(512))
    .addRoleOption((o) => o.setName('role').setDescription('Role granted when someone buys this item (makes it a role item)'))
    .addStringOption((o) => o.setName('type').setDescription('Item type (default: collectible; role is auto-set when a role is given)')
      .addChoices({ name: 'Role (grants a role)', value: 'role' }, { name: 'Crate (open with /open-crate)', value: 'crate' }, { name: 'Consumable (use with /use)', value: 'consumable' }, { name: 'Collectible (inventory only)', value: 'collectible' }))
    .addStringOption((o) => o.setName('emoji').setDescription('Emoji shown with the item (e.g. 📦)').setMaxLength(16))
    .addIntegerOption((o) => o.setName('sell_price').setDescription('Sell-back price (default: half the buy price, never above it)').setMinValue(0))
    .addStringOption((o) => o.setName('crate_contents').setDescription('Crate only: JSON rewards, e.g. [{"kind":"coins","min":50,"max":150,"weight":60}]').setMaxLength(2000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'The shop only works in a server.')] });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'You need the Manage Server permission to add shop items.')] });
    }
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Shop offline', 'The database is not connected, so items can\'t be added right now.')] });
    const itemName = interaction.options.getString('name');
    const price = interaction.options.getInteger('price');
    const description = interaction.options.getString('description');
    const role = interaction.options.getRole('role');
    let type = interaction.options.getString('type') || (role ? 'role' : 'collectible');
    if (role) type = 'role';
    const emojiOpt = interaction.options.getString('emoji');
    let sellPrice = interaction.options.getInteger('sell_price');
    if (sellPrice != null && sellPrice > price) {
      return interaction.reply({ embeds: [errorEmbed('Invalid sell price', `Sell price (${sellPrice}) can't be above the buy price (${price}). Leave it unset for half price.`)] });
    }
    let crateContents = null;
    const crateJson = interaction.options.getString('crate_contents');
    if (crateJson) {
      if (type !== 'crate') return interaction.reply({ embeds: [errorEmbed('Wrong type', 'crate_contents only applies to crate items — set type to Crate.')] });
      try {
        const parsed = JSON.parse(crateJson);
        if (!Array.isArray(parsed) || !parsed.length) throw new Error('must be a non-empty array');
        for (const e of parsed) {
          if (!['coins', 'item'].includes(e.kind)) throw new Error('each entry needs kind "coins" or "item"');
          if (e.kind === 'coins' && (typeof e.min !== 'number' || typeof e.max !== 'number' || e.min > e.max)) throw new Error('coin entries need min <= max numbers');
          if (e.kind === 'item' && typeof e.item_name !== 'string') throw new Error('item entries need item_name');
        }
        crateContents = JSON.stringify(parsed);
      } catch (err) {
        return interaction.reply({ embeds: [errorEmbed('Bad crate_contents JSON', `Couldn't parse the rewards: ${err.message}\nExample: \`[{"kind":"coins","min":50,"max":150,"weight":60},{"kind":"item","item_name":"Rare Crate","weight":10}]\``)] });
      }
    }
    if (type === 'crate' && !crateContents) {
      return interaction.reply({ embeds: [errorEmbed('Crate needs contents', 'A crate item needs crate_contents — the weighted rewards players roll when they open it. See the example in the option description.')] });
    }
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const cname = settings.economyCurrencyName || 'coins';
    const result = await db.query(
      'INSERT INTO shop_items (guild_id, name, description, price, role_id, emoji, type, sell_price, crate_contents, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [interaction.guildId, itemName, description || null, price, role?.id || null, emojiOpt || null, type, sellPrice ?? null, crateContents, interaction.user.id],
    );
    return interaction.reply({ embeds: [successEmbed('Item added', `**${itemName}** (#${result.insertId}, ${type}) is now in the shop for ${emoji} ${price} ${cname}.${role ? ` Buyers get the ${role} role.` : ''}${type === 'crate' ? ' Open it with /open-crate.' : ''}`)] });
  },
};

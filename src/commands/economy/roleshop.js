const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const db = require('../../utils/database');
const { getBalance, addCoins } = require('../../utils/economy');
const { getPremiumSettings } = require('../../utils/premiumSettings');
const { botCanManageRole } = require('../../utils/xpShop');

async function getShopItems(guildId) {
  if (!db.isEnabled()) return [];
  return await db.query('SELECT role_id, price FROM roleshop_items WHERE guild_id = ? ORDER BY price', [guildId]) || [];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roleshop')
    .setDescription('Buy roles with your wallet coins — one-time purchases.')
    .addSubcommand((s) => s.setName('list').setDescription('Show the roles for sale.'))
    .addSubcommand((s) => s.setName('buy').setDescription('Buy a role from the shop.')
      .addRoleOption((o) => o.setName('role').setDescription('The role to buy').setRequired(true)))
    .addSubcommand((s) => s.setName('add').setDescription('Admin only: put a role up for sale.')
      .addRoleOption((o) => o.setName('role').setDescription('The role to sell').setRequired(true))
      .addIntegerOption((o) => o.setName('price').setDescription('Price in coins').setRequired(true).setMinValue(1).setMaxValue(1000000)))
    .addSubcommand((s) => s.setName('remove').setDescription('Admin only: take a role off sale.')
      .addRoleOption((o) => o.setName('role').setDescription('The role to remove').setRequired(true))),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('Server only', 'The role shop only works in a server.')], ephemeral: true });
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Role shop offline', 'The database is not connected, so the role shop is unavailable right now.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const settings = await getPremiumSettings(interaction.guildId);
    const emoji = settings.economyCurrencyEmoji || '🪙';
    const name = settings.economyCurrencyName || 'coins';

    if (sub === 'list') {
      const items = await getShopItems(interaction.guildId);
      if (!items.length) return interaction.reply({ embeds: [infoEmbed('🛒 Role shop', 'No roles are for sale yet — an admin can add some with /roleshop add.')], ephemeral: true });
      const purchased = await db.query('SELECT role_id FROM roleshop_purchases WHERE guild_id = ? AND user_id = ?', [interaction.guildId, interaction.user.id]) || [];
      const ownedIds = new Set(purchased.map((p) => p.role_id));
      const lines = items.map((i) => {
        const role = interaction.guild.roles.cache.get(i.role_id);
        const label = role ? `**${role.name}**` : `\`${i.role_id}\` (role deleted)`;
        const state = ownedIds.has(i.role_id) || interaction.member.roles.cache.has(i.role_id) ? ' ✅ Owned' : '';
        return `${label} — ${emoji} ${i.price} ${name}${state}`;
      });
      return interaction.reply({ embeds: [infoEmbed('🛒 Role shop', `${lines.join('\n')}\n\nBuy with \`/roleshop buy <role>\`. Purchases are one-time — no refunds, no re-buys.`)], ephemeral: true });
    }

    if (sub === 'buy') {
      const role = interaction.options.getRole('role');
      const items = await getShopItems(interaction.guildId);
      const item = items.find((i) => i.role_id === role.id);
      if (!item) return interaction.reply({ embeds: [errorEmbed('Not for sale', `**${role.name}** is not in the role shop.`)], ephemeral: true });
      if (interaction.member.roles.cache.has(role.id)) {
        return interaction.reply({ embeds: [errorEmbed('Already yours', `You already have the **${role.name}** role.`)], ephemeral: true });
      }
      const purchased = await db.query('SELECT 1 AS x FROM roleshop_purchases WHERE guild_id = ? AND user_id = ? AND role_id = ?', [interaction.guildId, interaction.user.id, role.id]);
      if (purchased?.length) {
        return interaction.reply({ embeds: [errorEmbed('Already purchased', `You already bought **${role.name}** once — role shop purchases are one-time. If the role was removed from you, ask an admin to re-grant it.`)], ephemeral: true });
      }
      const check = botCanManageRole(interaction.guild, role);
      if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Bot cannot grant this role', check.reason)], ephemeral: true });
      const bal = await getBalance(interaction.guildId, interaction.user.id);
      if (!bal || bal.balance < item.price) {
        return interaction.reply({ embeds: [errorEmbed('Not enough coins', `**${role.name}** costs ${emoji} ${item.price} ${name} — you have ${emoji} ${bal?.balance ?? 0} in your wallet.`)], ephemeral: true });
      }
      // Grant the role first: if Discord refuses, nobody has been charged.
      let granted = true;
      try { await interaction.member.roles.add(role); } catch { granted = false; }
      if (!granted) {
        return interaction.reply({ embeds: [errorEmbed('Could not grant role', `Discord wouldn't let me grant **${role.name}** — you have not been charged.`)], ephemeral: true });
      }
      await addCoins(interaction.guildId, interaction.user.id, -item.price, 'roleshop', `Role shop: ${role.name}`);
      const inserted = await db.query(
        'INSERT INTO roleshop_purchases (guild_id, user_id, role_id, price) VALUES (?, ?, ?, ?)',
        [interaction.guildId, interaction.user.id, role.id, item.price],
      );
      if (!inserted) {
        // Charge went through but the purchase record didn't — roll back
        // fully (refund + remove role) so nobody pays for an unrecorded buy.
        await addCoins(interaction.guildId, interaction.user.id, item.price, 'roleshop_refund', `Refund: ${role.name} purchase not recorded`).catch(() => {});
        await interaction.member.roles.remove(role).catch(() => {});
        return interaction.reply({ embeds: [errorEmbed('Purchase failed', `Your purchase of **${role.name}** could not be recorded, so you were refunded and the role was removed. Please try again.`)] });
      }
      return interaction.reply({ embeds: [successEmbed('Role purchased!', `🛒 You bought **${role.name}** for ${emoji} ${item.price} ${name}.`)], ephemeral: true });
    }

    // add / remove — admin only (checked at runtime: subcommand-level
    // default permissions don't exist, so the whole command can't be
    // locked to admins without locking list/buy too).
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'Only server admins can manage the role shop catalog.')], ephemeral: true });
    }
    const role = interaction.options.getRole('role');
    if (sub === 'add') {
      const price = interaction.options.getInteger('price');
      if (role.managed) return interaction.reply({ embeds: [errorEmbed('Cannot sell this role', `**${role.name}** is a managed role (bot/integration role) and can't be sold.`)], ephemeral: true });
      if (role.id === interaction.guild.id) return interaction.reply({ embeds: [errorEmbed('Cannot sell this role', 'The @everyone role can\'t be sold.')], ephemeral: true });
      const check = botCanManageRole(interaction.guild, role);
      if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Bot cannot grant this role', check.reason)], ephemeral: true });
      await db.query(
        'INSERT INTO roleshop_items (guild_id, role_id, price) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE price = VALUES(price)',
        [interaction.guildId, role.id, price],
      );
      return interaction.reply({ embeds: [successEmbed('Role listed', `🛒 **${role.name}** is now for sale at ${emoji} ${price} ${name}.`)], ephemeral: true });
    }
    // remove
    const res = await db.query('DELETE FROM roleshop_items WHERE guild_id = ? AND role_id = ?', [interaction.guildId, role.id]);
    if (!res?.affectedRows) return interaction.reply({ embeds: [errorEmbed('Not listed', `**${role.name}** isn't in the role shop.`)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Role removed', `**${role.name}** is no longer for sale. Members who already bought it keep the role.`)], ephemeral: true });
  },
};

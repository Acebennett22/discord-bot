const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { removeShopItem, getShopItems } = require('../../utils/xpShop');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xpshop-remove')
    .setDescription('Admin only: remove a role from THIS server\'s XP shop.')
    .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'The XP shop needs MySQL.')], ephemeral: true });
    const role = interaction.options.getRole('role');
    const items = await getShopItems(interaction.guildId);
    if (!items.some((i) => i.role_id === role.id)) {
      return interaction.reply({ embeds: [errorEmbed('Not in the shop', `**${role.name}** isn't in this server's XP shop.`)], ephemeral: true });
    }
    await removeShopItem(interaction.guildId, role.id);
    return interaction.reply({ embeds: [successEmbed('XP shop item removed', `🛒 **${role.name}** was removed from this server's XP shop.`)], ephemeral: true });
  },
};

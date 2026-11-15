const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { addShopItem, botCanManageRole } = require('../../utils/xpShop');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xpshop-add')
    .setDescription('Admin only: add a role to THIS server\'s XP shop.')
    .addRoleOption((o) => o.setName('role').setDescription('Role to sell').setRequired(true))
    .addIntegerOption((o) => o.setName('xp_price').setDescription('XP price').setRequired(true).setMinValue(1).setMaxValue(1000000))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'The XP shop needs MySQL.')] });
    const role = interaction.options.getRole('role');
    const price = interaction.options.getInteger('xp_price');
    const check = botCanManageRole(interaction.guild, role);
    if (!check.ok) return interaction.reply({ embeds: [errorEmbed('Bot cannot manage this role', check.reason)] });
    await addShopItem(interaction.guildId, role.id, price, interaction.user.id);
    return interaction.reply({ embeds: [successEmbed('XP shop item added', `🛒 **${role.name}** is now in this server's XP shop for **${price} XP**.`)] });
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getShopItems, buyShopRole } = require('../../utils/xpShop');
const { getRank } = require('../../utils/leveling');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xpshop')
    .setDescription('Spend your leveling XP on roles in this server\'s XP shop.')
    .addSubcommand((s) => s.setName('list').setDescription('Show this server\'s XP shop.'))
    .addSubcommand((s) => s.setName('buy').setDescription('Buy a role with your XP.')
      .addRoleOption((o) => o.setName('role').setDescription('Role to buy').setRequired(true))),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'The XP shop needs MySQL.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const items = await getShopItems(interaction.guildId);
    if (sub === 'list') {
      if (!items.length) return interaction.reply({ embeds: [infoEmbed('XP shop', 'This server\'s XP shop is empty — admins add roles with /xpshop-add.')], ephemeral: true });
      const rank = await getRank(interaction.user.id, interaction.guildId);
      const xp = rank?.xp || 0;
      const lines = items.map((i) => {
        const role = interaction.guild.roles.cache.get(i.role_id);
        const afford = xp >= i.xp_price ? '✅' : '🔒';
        return `${afford} **${role ? role.name : i.role_id}** — ${i.xp_price} XP`;
      });
      return interaction.reply({ embeds: [infoEmbed(`🛒 XP shop (you have ${xp} XP)`, lines.join('\n'))], ephemeral: true });
    }
    // buy
    const role = interaction.options.getRole('role');
    const result = await buyShopRole(interaction.guild, interaction.member, role.id);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not buy role', result.error)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Role purchased!', `🛒 You bought **${result.role.name}** for ${result.price} XP. You have ${result.remainingXp} XP left.`)], ephemeral: true });
  },
};

// Role menu select — customId rolemenu:<menuId>. Selecting an option
// toggles that role; requirements (1.2.6) are checked before granting.
const { Events } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { getMenuItems, checkItemRequirements } = require('../utils/roleMenus');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith('rolemenu:')) return;
    const menuId = Number(interaction.customId.split(':')[1]);
    const roleId = interaction.values?.[0];
    if (!roleId) return;
    const items = await getMenuItems(menuId);
    const item = items.find((i) => i.role_id === roleId);
    if (!item) return interaction.reply({ embeds: [errorEmbed('Unavailable', 'That role is no longer on this menu.')] });
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ embeds: [errorEmbed('Role gone', 'That role no longer exists.')] });
    if (interaction.member.roles.cache.has(roleId)) {
      await interaction.member.roles.remove(role).catch(() => {});
      return interaction.reply({ embeds: [successEmbed('Role removed', `➖ Removed the **${role.name}** role.`)], ephemeral: true });
    }
    const missed = await checkItemRequirements(interaction.member, item);
    if (missed.length) {
      return interaction.reply({
        embeds: [errorEmbed('You don\'t meet the requirements', `You can't take the **${role.name}** role yet:\n${missed.map((m) => `• ${m}`).join('\n')}`)],
        ephemeral: true,
      });
    }
    await interaction.member.roles.add(role).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('Role added', `➕ You now have the **${role.name}** role!`)], ephemeral: true });
  },
};

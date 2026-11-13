// Reaction-role button clicks toggle the role (one click = on, again = off).
const { Events } = require('discord.js');
const { getMappings } = require('../utils/reactionRoles');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('rr:')) return;
    const roleId = interaction.customId.split(':')[1];
    const mappings = await getMappings(interaction.message.id);
    const mapping = mappings.find((m) => m.role_id === roleId);
    if (!mapping) return interaction.reply({ embeds: [errorEmbed('Unavailable', 'That role is no longer available on this message.')], ephemeral: true });
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ embeds: [errorEmbed('Role gone', 'That role no longer exists.')], ephemeral: true });
    if (interaction.member.roles.cache.has(roleId)) {
      await interaction.member.roles.remove(role).catch(() => {});
      return interaction.reply({ embeds: [successEmbed('Role removed', `➖ Removed the **${role.name}** role.`)], ephemeral: true });
    }
    await interaction.member.roles.add(role).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('Role added', `➕ You now have the **${role.name}** role!`)], ephemeral: true });
  },
};

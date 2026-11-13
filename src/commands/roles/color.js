const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getColorRoles, setMemberColor, removeMemberColor } = require('../../utils/colorRoles');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('color')
    .setDescription('Pick a color role for yourself.')
    .addSubcommand((s) => s.setName('list').setDescription('Show the available color roles.'))
    .addSubcommand((s) => s.setName('set').setDescription('Set your color role.')
      .addRoleOption((o) => o.setName('color').setDescription('The color role to wear').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove your color role.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Color roles need MySQL.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const roles = await getColorRoles(interaction.guildId);
      if (!roles.length) return interaction.reply({ embeds: [infoEmbed('Color roles', 'No color roles are set up in this server yet. Admins register them with /color-add.')], ephemeral: true });
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🎨 Color roles').setDescription('Pick one with /color set — you can only wear one at a time.');
      for (const r of roles) {
        const role = interaction.guild.roles.cache.get(r.role_id);
        embed.addFields({ name: `${role ? role.name : r.name || r.role_id}`, value: `Color: \`${r.hex}\``, inline: true });
      }
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    if (sub === 'set') {
      const role = interaction.options.getRole('color');
      const result = await setMemberColor(interaction.member, role.id);
      if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not set color', result.error)], ephemeral: true });
      return interaction.reply({ embeds: [successEmbed('Color set!', `🎨 You're now wearing **${result.role.name}**.`)], ephemeral: true });
    }
    // remove
    const result = await removeMemberColor(interaction.member);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('No color to remove', result.error)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed('Color removed', 'Your color role has been removed.')], ephemeral: true });
  },
};

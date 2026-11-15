const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getColorRoles, setMemberColor, removeMemberColor, getUserColorRole, ensureUserColorRole } = require('../../utils/colorRoles');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('color')
    .setDescription('Pick a color role for yourself.')
    .addSubcommand((s) => s.setName('list').setDescription('Show the available color roles.'))
    .addSubcommand((s) => s.setName('set').setDescription('Set your color role.')
      .addRoleOption((o) => o.setName('color').setDescription('The color role to wear').setRequired(true)))
    .addSubcommand((s) => s.setName('custom').setDescription('Set a custom color — creates your own personal color role.')
      .addStringOption((o) => o.setName('hex').setDescription('Hex color, e.g. #ff69b4').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove your color role.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'Color roles need MySQL.')] });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const roles = await getColorRoles(interaction.guildId);
      const personalId = await getUserColorRole(interaction.guildId, interaction.user.id);
      const personalRole = personalId ? interaction.guild.roles.cache.get(personalId) : null;
      if (!roles.length && !personalRole) return interaction.reply({ embeds: [infoEmbed('Color roles', 'No color roles are set up in this server yet. Admins register them with /color-add, or set your own with /color custom <#hex>.')] });
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🎨 Color roles').setDescription('Pick one with /color set — you can only wear one at a time. Or make your own with /color custom <#hex>.');
      for (const r of roles) {
        const role = interaction.guild.roles.cache.get(r.role_id);
        embed.addFields({ name: `${role ? role.name : r.name || r.role_id}`, value: `Color: \`${r.hex}\``, inline: true });
      }
      if (personalRole) embed.addFields({ name: `⭐ Your custom color (${personalRole.name})`, value: `Color: \`${personalRole.hexColor}\` — change it with /color custom, delete it with /color remove.`, inline: false });
      return interaction.reply({ embeds: [embed] });
    }
    if (sub === 'set') {
      const role = interaction.options.getRole('color');
      const result = await setMemberColor(interaction.member, role.id);
      if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not set color', result.error)] });
      return interaction.reply({ embeds: [successEmbed('Color set!', `🎨 You're now wearing **${result.role.name}**.`)] });
    }
    if (sub === 'custom') {
      const raw = interaction.options.getString('hex').trim();
      const match = /^#?([0-9a-fA-F]{6})$/.exec(raw);
      if (!match) return interaction.reply({ embeds: [errorEmbed('Invalid hex color', `"${raw}" isn't a valid hex color. Use the format \`#RRGGBB\`, e.g. \`#ff69b4\`.`)] });
      const hex = `#${match[1].toUpperCase()}`;
      const ensured = await ensureUserColorRole(interaction.member, hex);
      if (!ensured.ok) return interaction.reply({ embeds: [errorEmbed('Could not create your color role', ensured.error)] });
      const result = await setMemberColor(interaction.member, ensured.role.id);
      if (!result.ok) return interaction.reply({ embeds: [errorEmbed('Could not set color', result.error)] });
      return interaction.reply({ embeds: [successEmbed('Custom color set!', `🎨 Your personal color role is now **${hex}**${ensured.created ? ' (a new `color-' + interaction.user.id + '` role was created for you)' : ' (your existing personal color role was recolored)'}.`)] });
    }
    // remove
    const result = await removeMemberColor(interaction.member);
    if (!result.ok) return interaction.reply({ embeds: [errorEmbed('No color to remove', result.error)] });
    return interaction.reply({ embeds: [successEmbed('Color removed', `Your color role has been removed.${result.personalDeleted ? ' Your personal color role was deleted too.' : ''}`)] });
  },
};

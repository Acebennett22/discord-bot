const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');
const { roleAssignable, sweepBoosters } = require('../../utils/boosterRole');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boosterrole')
    .setDescription('Admin only: set the role Nitro boosters get automatically.')
    .addSubcommand((s) => s.setName('set').setDescription('Set the booster role (grants it to current boosters too).')
      .addRoleOption((o) => o.setName('role').setDescription('The role to grant to boosters').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop granting a booster role.'))
    .addSubcommand((s) => s.setName('view').setDescription('Show the current booster role.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);
    if (sub === 'view') {
      return interaction.reply({ embeds: [infoEmbed('Nitro booster role', settings.boosterRoleId ? `Boosters automatically get <@&${settings.boosterRoleId}>, and lose it when they stop boosting.` : 'No booster role is configured. Set one with `/boosterrole set`.')] });
    }
    if (sub === 'remove') {
      await setGuildSettings(interaction.guildId, { boosterRoleId: '' });
      return interaction.reply({ embeds: [successEmbed('Booster role removed', 'Boosters will no longer get a role automatically. Members who already have it keep it — remove it manually if you want it gone.')] });
    }
    const role = interaction.options.getRole('role');
    if (!roleAssignable(interaction.guild, role.id)) {
      return interaction.reply({ embeds: [errorEmbed('Cannot assign that role', 'That role is missing or sits above my highest role — I cannot grant it. Move my role above it and try again.')] });
    }
    await setGuildSettings(interaction.guildId, { boosterRoleId: role.id });
    const sweep = await sweepBoosters(interaction.guild);
    return interaction.reply({ embeds: [successEmbed('Booster role set', `<@&${role.id}> will now be granted when a member starts boosting, and removed when they stop.${sweep.granted ? `\n🎉 Granted it to ${sweep.granted} current booster(s).` : ''}${sweep.error ? `\n⚠️ Sweep: ${sweep.error}` : ''}`)] });
  },
};

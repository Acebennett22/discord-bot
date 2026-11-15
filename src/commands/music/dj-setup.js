const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dj-setup')
    .setDescription('Admin only: set the DJ role and turn DJ mode on or off.')
    .addRoleOption((o) => o.setName('role').setDescription('The DJ role'))
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn DJ mode on or off'))
    .addBooleanOption((o) => o.setName('only_skip').setDescription('On: only skip/stop/pause/resume/filter/queue-clear are DJ-gated'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const enabled = interaction.options.getBoolean('enabled');
    const onlySkip = interaction.options.getBoolean('only_skip');
    const current = await getGuildSettings(interaction.guildId);
    const patch = {};
    if (role) patch.djRoleId = role.id;
    if (enabled !== null) patch.djEnabled = enabled;
    if (onlySkip !== null) patch.djOnlySkip = onlySkip;
    const djRoleId = patch.djRoleId ?? current.djRoleId;
    const djEnabled = patch.djEnabled ?? current.djEnabled;
    if (djEnabled && !djRoleId) {
      return interaction.reply({ embeds: [errorEmbed('No DJ role set', 'Set a DJ role first — DJ mode cannot be enabled without one. Run `/dj-setup` with a role, then enable it.')] });
    }
    const { settings } = await setGuildSettings(interaction.guildId, patch);
    const djRole = settings.djRoleId ? `<@&${settings.djRoleId}>` : 'none';
    return interaction.reply({
      
      embeds: [successEmbed('DJ settings saved', [
        `**DJ mode:** ${settings.djEnabled ? '✅ on' : '❌ off'}`,
        `**DJ role:** ${djRole}`,
        `**Gate only control commands:** ${settings.djOnlySkip ? '✅ on — /play, /lyrics, /queue and /nowplaying stay open to everyone' : '❌ off — every music command requires the DJ role'}`,
        settings.djEnabled ? 'DJ-gated: `/skip`, `/stop`, `/pause`, `/resume`, `/filter`, `/queue-clear`.' : '',
      ].filter(Boolean).join('\n'))],
    });
  },
};

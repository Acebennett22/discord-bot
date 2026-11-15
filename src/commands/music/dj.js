const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings } = require('../../utils/guildSettings');
const { infoEmbed } = require('../../utils/embeds');
const { DJ_ONLY_COMMANDS } = require('../../utils/djCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dj')
    .setDescription('Admin only: show the current DJ mode settings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    return interaction.reply({
      
      embeds: [infoEmbed('🎧 DJ mode', [
        `**DJ mode:** ${settings.djEnabled ? '✅ on' : '❌ off'}`,
        `**DJ role:** ${settings.djRoleId ? `<@&${settings.djRoleId}>` : 'none'}`,
        `**Gate only control commands:** ${settings.djOnlySkip ? '✅ on' : '❌ off'}`,
        `**DJ-gated commands:** ${DJ_ONLY_COMMANDS.map((c) => `\`/${c}\``).join(', ')}`,
        settings.djOnlySkip ? 'Open to everyone: `/play`, `/lyrics`, `/queue`, `/nowplaying`.' : 'Every music command requires the DJ role (or admin).',
        'Change with `/dj-setup` or the dashboard Music tab.',
      ].join('\n'))],
    });
  },
};

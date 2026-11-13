const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { STATS, createStatChannels } = require('../../utils/serverStats');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverstats-setup')
    .setDescription('Admin only: create the Server Stats category and live stat channels.')
    .addStringOption((o) => o.setName('stats').setDescription('Comma-separated stats to show (default: members,online,bots,boosts)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const raw = interaction.options.getString('stats') || 'members,online,bots,boosts';
    const keys = raw.split(',').map((s) => s.trim().toLowerCase()).filter((k) => STATS[k]);
    if (!keys.length) {
      return interaction.reply({ embeds: [errorEmbed('No valid stats', `Valid stats: ${Object.keys(STATS).join(', ')}`)], ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const channels = await createStatChannels(interaction.guild, keys);
    return interaction.editReply({ embeds: [successEmbed('Server Stats enabled', [
      'Created the **📊 Server Stats** category with display-only voice channels:',
      ...keys.map((k) => `• ${STATS[k].emoji} ${STATS[k].label} — <#${channels[k]}>`),
      '',
      'Counts refresh every 10 minutes (config `serverStats.updateIntervalMinutes`) and on joins/leaves. Note: the **Online** count needs the Guild Presences intent — it is enabled in index.js, and must also be on in the Developer Portal.',
    ].join('\n'))] });
  },
};

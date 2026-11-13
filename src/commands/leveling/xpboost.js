const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getActiveBoost, startBoost, stopBoost } = require('../../utils/leveling');
const db = require('../../utils/database');

function parseDuration(str) {
  const m = /^(\d+)([smhd])$/.exec(String(str || '').trim().toLowerCase());
  if (!m) return null;
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return parseInt(m[1], 10) * mult;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xpboost')
    .setDescription('XP boosts — double (or triple) XP for a while.')
    .addSubcommand((s) => s.setName('start').setDescription('Admin only: start an XP boost.')
      .addNumberOption((o) => o.setName('multiplier').setDescription('XP multiplier').addChoices(
        { name: '2x (double XP)', value: 2 },
        { name: '3x (triple XP)', value: 3 },
      ).setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('How long (e.g. 2h, 1d)').setRequired(true)))
    .addSubcommand((s) => s.setName('stop').setDescription('Admin only: stop the active XP boost.'))
    .addSubcommand((s) => s.setName('status').setDescription('Show whether an XP boost is active.')),
  async execute(interaction) {
    if (!db.isEnabled()) return interaction.reply({ embeds: [errorEmbed('Database unavailable', 'XP boosts need MySQL.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    // start/stop are admin-only (checked here because subcommands can't
    // carry their own default member permissions).
    if ((sub === 'start' || sub === 'stop') && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [errorEmbed('Admin only', 'Only server admins can start or stop XP boosts.')], ephemeral: true });
    }
    if (sub === 'status') {
      const boost = await getActiveBoost(interaction.guildId);
      if (!boost) return interaction.reply({ embeds: [infoEmbed('XP boost', 'No XP boost is active right now.')] , ephemeral: true });
      return interaction.reply({ embeds: [infoEmbed('XP boost active!', `⚡ **${parseFloat(boost.multiplier)}x XP** until <t:${Math.floor(new Date(boost.ends_at).getTime() / 1000)}:R>.`)], ephemeral: true });
    }
    if (sub === 'start') {
      const multiplier = interaction.options.getNumber('multiplier');
      const ms = parseDuration(interaction.options.getString('duration'));
      if (!ms || ms < 60_000 || ms > 7 * 86_400_000) {
        return interaction.reply({ embeds: [errorEmbed('Invalid duration', 'Use a duration like 2h or 1d (between 1 minute and 7 days).')], ephemeral: true });
      }
      const boost = await startBoost(interaction.guildId, multiplier, ms, interaction.user.id);
      return interaction.reply({ embeds: [successEmbed('XP boost started!', `⚡ **${multiplier}x XP** for everyone in this server until <t:${Math.floor(boost.endsAt.getTime() / 1000)}:R>.`)], ephemeral: true });
    }
    // stop
    const stopped = await stopBoost(interaction.guildId);
    return interaction.reply({ embeds: [stopped ? successEmbed('XP boost stopped', 'XP is back to normal.') : infoEmbed('No boost', 'No XP boost was active.')], ephemeral: true });
  },
};

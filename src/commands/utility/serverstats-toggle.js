const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { STATS, createStatChannels, updateServerStats } = require('../../utils/serverStats');
const { getGuildSettings, setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverstats-toggle')
    .setDescription('Admin only: enable/disable an individual stat channel, or all stats.')
    .addStringOption((o) => o.setName('stat').setDescription('Stat to toggle').setRequired(true)
      .addChoices(
        ...Object.keys(STATS).map((k) => ({ name: STATS[k].label, value: k })),
        { name: 'All stats (disable everything)', value: 'all_off' },
      ))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const stat = interaction.options.getString('stat');
    const settings = await getGuildSettings(interaction.guildId);
    const channels = { ...(settings.serverStatsChannels || {}) };
    if (stat === 'all_off') {
      for (const id of Object.values(channels)) {
        const ch = interaction.guild.channels.cache.get(id);
        if (ch) await ch.delete('Server stats disabled').catch(() => {});
      }
      await setGuildSettings(interaction.guildId, { serverStatsEnabled: false, serverStatsChannels: {} });
      return interaction.reply({  embeds: [successEmbed('Server Stats disabled', 'All stat channels were deleted. Run /serverstats-setup to turn them back on.')] });
    }
    if (channels[stat]) {
      const ch = interaction.guild.channels.cache.get(channels[stat]);
      if (ch) await ch.delete('Server stat disabled').catch(() => {});
      delete channels[stat];
      await setGuildSettings(interaction.guildId, { serverStatsChannels: channels, serverStatsEnabled: Object.keys(channels).length > 0 });
      return interaction.reply({  embeds: [successEmbed('Stat disabled', `The **${STATS[stat].label}** stat channel was removed.`)] });
    }
    if (!settings.serverStatsEnabled) {
      return interaction.reply({ embeds: [errorEmbed('Stats not set up', 'Run /serverstats-setup first — it creates the category the stat channels live in.')] });
    }
    const created = await createStatChannels(interaction.guild, [stat]);
    await updateServerStats(interaction.guild);
    return interaction.reply({  embeds: [successEmbed('Stat enabled', `The **${STATS[stat].label}** stat channel is live: <#${created[stat]}>`)] });
  },
};

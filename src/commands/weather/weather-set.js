const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed } = require('../../utils/embeds');
const { setGuildSettings } = require('../../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather-set')
    .setDescription('Admin only: set the default weather location and units for this server.')
    .addStringOption((o) => o.setName('location').setDescription('Default location (city, ZIP, or "lat,lon") — empty to clear').setMaxLength(128))
    .addStringOption((o) => o.setName('units').setDescription('Default units').addChoices(
      { name: 'Imperial (°F, mph)', value: 'imperial' },
      { name: 'Metric (°C, km/h)', value: 'metric' },
    ))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const location = interaction.options.getString('location');
    const units = interaction.options.getString('units');
    const patch = {};
    if (location !== null) patch.defaultWeatherLocation = location || '';
    if (units) patch.weatherUnits = units;
    if (!Object.keys(patch).length) {
      return interaction.reply({ embeds: [successEmbed('Weather defaults', 'Nothing to change — give a location, units, or both.')], ephemeral: true });
    }
    await setGuildSettings(interaction.guildId, patch);
    const bits = [];
    if (location !== null) bits.push(`Default location: **${location || 'cleared'}**`);
    if (units) bits.push(`Default units: **${units === 'metric' ? 'Metric (°C, km/h)' : 'Imperial (°F, mph)'}**`);
    return interaction.reply({ embeds: [successEmbed('Weather defaults saved', `${bits.join('\n')}\n/weather and /forecast with no location will use the default.`)], ephemeral: true });
  },
};

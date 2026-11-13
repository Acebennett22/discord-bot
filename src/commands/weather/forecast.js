const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getWeather, describeCode } = require('../../utils/weather');
const { getGuildSettings } = require('../../utils/guildSettings');

function fmtDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forecast')
    .setDescription('Daily forecast for a place (up to 7 days).')
    .addStringOption((o) => o.setName('location').setDescription('City name, ZIP code, or "latitude,longitude"'))
    .addIntegerOption((o) => o.setName('days').setDescription('Number of days (1-7, default 3)').setMinValue(1).setMaxValue(7))
    .addStringOption((o) => o.setName('units').setDescription('Units (defaults to the server setting, imperial)').addChoices(
      { name: 'Imperial (°F, mph)', value: 'imperial' },
      { name: 'Metric (°C, km/h)', value: 'metric' },
    )),
  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    const location = interaction.options.getString('location') || settings.defaultWeatherLocation;
    if (!location) {
      return interaction.reply({ embeds: [errorEmbed('Where?', 'Give a location — `/forecast location: Blairsville, PA` — or set a server default with `/weather-set`.')], ephemeral: true });
    }
    const days = interaction.options.getInteger('days') || 3;
    const units = interaction.options.getString('units') || settings.weatherUnits || 'imperial';
    await interaction.deferReply({ ephemeral: true });
    const result = await getWeather(location, units);
    if (result.error) return interaction.editReply({ embeds: [errorEmbed('Forecast', result.error)] });
    const d = result.daily;
    const fields = d.time.slice(0, days).map((date, i) => {
      const [condition, emoji] = describeCode(d.weather_code[i]);
      const precip = d.precipitation_probability_max?.[i];
      return {
        name: `${emoji} ${fmtDate(date)}`,
        value: `High **${d.temperature_2m_max[i]}${result.tempUnit}** / Low **${d.temperature_2m_min[i]}${result.tempUnit}**\n${condition}${precip !== null && precip !== undefined ? ` · 💧 ${precip}% chance` : ''}`,
        inline: false,
      };
    });
    return interaction.editReply({
      embeds: [infoEmbed(`📅 ${days}-day forecast — ${result.place}`, `Temperatures in ${result.tempUnit}.`, fields)],
    });
  },
};

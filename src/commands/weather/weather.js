const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { getWeather, describeCode, windDirection } = require('../../utils/weather');
const { getGuildSettings } = require('../../utils/guildSettings');

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Current weather for a place (city, ZIP, or "lat,lon").')
    .addStringOption((o) => o.setName('location').setDescription('City name, ZIP code, or "latitude,longitude"'))
    .addStringOption((o) => o.setName('units').setDescription('Units (defaults to the server setting, imperial)').addChoices(
      { name: 'Imperial (°F, mph)', value: 'imperial' },
      { name: 'Metric (°C, km/h)', value: 'metric' },
    )),
  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    const location = interaction.options.getString('location') || settings.defaultWeatherLocation;
    if (!location) {
      return interaction.reply({ embeds: [errorEmbed('Where?', 'Give a location — `/weather location: Blairsville, PA` — or set a server default with `/weather-set`.')], ephemeral: true });
    }
    const units = interaction.options.getString('units') || settings.weatherUnits || 'imperial';
    await interaction.deferReply({ ephemeral: true });
    const result = await getWeather(location, units);
    if (result.error) return interaction.editReply({ embeds: [errorEmbed('Weather', result.error)] });
    const c = result.current;
    const [condition, emoji] = describeCode(c.weather_code);
    const vis = c.visibility !== null && c.visibility !== undefined
      ? (units === 'metric' ? `${(c.visibility / 1000).toFixed(1)} km` : `${(c.visibility / 1609.34).toFixed(1)} mi`)
      : '—';
    const sunrise = result.daily.sunrise?.[0];
    const sunset = result.daily.sunset?.[0];
    return interaction.editReply({
      embeds: [infoEmbed(`${emoji} Weather in ${result.place}`, `**${c.temperature_2m}${result.tempUnit}** — ${condition}\nFeels like **${c.apparent_temperature}${result.tempUnit}**`, [
        { name: '💧 Humidity', value: `${c.relative_humidity_2m}%`, inline: true },
        { name: '💨 Wind', value: `${c.wind_speed_10m} ${result.windUnit} ${windDirection(c.wind_direction_10m)}`, inline: true },
        { name: '🌡️ Pressure', value: `${c.pressure_msl} hPa`, inline: true },
        { name: '👁️ Visibility', value: vis, inline: true },
        { name: '🌅 Sunrise', value: fmtTime(sunrise), inline: true },
        { name: '🌇 Sunset', value: fmtTime(sunset), inline: true },
      ])],
    });
  },
};

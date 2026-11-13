// Weather via Open-Meteo (https://open-meteo.com) — free, no API key.
// Geocoding: https://geocoding-api.open-meteo.com/v1/search
// Forecast:  https://api.open-meteo.com/v1/forecast
const errorLogger = require('./errorLogger');

const WMO = {
  0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Depositing rime fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Dense drizzle', '🌦️'],
  56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Slight rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Slight snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
  80: ['Slight rain showers', '🌦️'], 81: ['Rain showers', '🌦️'], 82: ['Violent rain showers', '🌧️'],
  85: ['Snow showers', '🌨️'], 86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm with hail', '⛈️'], 99: ['Thunderstorm with hail', '⛈️'],
};

function describeCode(code) {
  return WMO[code] || ['Unknown', '🌡️'];
}

function windDirection(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

// "40.4,-79.2" -> { lat, lon } or null.
function parseLatLon(input) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(input || ''));
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Geocoding API returned ${res.status}`);
  const data = await res.json().catch(() => null);
  const hit = data?.results?.[0];
  if (!hit) return null;
  const place = [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ');
  return { lat: hit.latitude, lon: hit.longitude, place };
}

async function fetchForecast(lat, lon, units, days) {
  const tempUnit = units === 'metric' ? 'celsius' : 'fahrenheit';
  const windUnit = units === 'metric' ? 'kmh' : 'mph';
  const precipUnit = units === 'metric' ? 'mm' : 'inch';
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,visibility',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    temperature_unit: tempUnit, wind_speed_unit: windUnit, precipitation_unit: precipUnit,
    timezone: 'auto', forecast_days: String(days),
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Forecast API returned ${res.status}`);
  return res.json();
}

// Resolve a location string to weather. Returns { place, units, current, daily }
// or { error } — never throws for user-facing problems.
async function getWeather(location, units = 'imperial') {
  const useMetric = units === 'metric';
  const tempUnit = useMetric ? '°C' : '°F';
  const windUnit = useMetric ? 'km/h' : 'mph';
  const precipUnit = useMetric ? 'mm' : 'in';
  let latLon = parseLatLon(location);
  let place = latLon ? `${latLon.lat}, ${latLon.lon}` : null;
  try {
    if (!latLon) {
      const hit = await geocode(location);
      if (!hit) return { error: `Couldn't find a place called "${location}". Try a city name, a ZIP code, or "latitude,longitude".` };
      latLon = { lat: hit.lat, lon: hit.lon };
      place = hit.place;
    }
    const data = await fetchForecast(latLon.lat, latLon.lon, units, 7);
    if (!data?.current || !data?.daily) return { error: 'The weather service returned an unexpected response.' };
    return { place, units, tempUnit, windUnit, precipUnit, current: data.current, daily: data.daily };
  } catch (err) {
    errorLogger.log({ level: 'error', commandName: 'weather', message: `Open-Meteo request failed: ${err.message}`, stack: err.stack });
    return { error: 'The weather service is unreachable right now — try again in a bit.' };
  }
}

module.exports = { describeCode, windDirection, parseLatLon, geocode, getWeather };

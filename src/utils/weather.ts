// Weather fetching via Open-Meteo API (no API key required)

export interface HourlyWeather {
  time: string;
  temperature: number;
  precipitationProbability: number;
  windspeed: number;
  humidity: number;
}

export interface WeatherData {
  hourly: HourlyWeather[];
  fetchedAt: number;
  lat: number;
  lng: number;
}

export interface WeatherCondition {
  temperature: number;
  precipitationProbability: number;
  windspeed: number;
  humidity: number;
  isHeat: boolean;
  isRain: boolean;
  isHypothermia: boolean;
  isHeadwind: boolean;
  icon: string;
}

/**
 * Fetch weather for the given GPS coordinates.
 * Defaults to Shonan area (race start) if no coordinates provided.
 * Uses dynamic date range (today + tomorrow) so the app works outside race day.
 */
export async function fetchWeather(
  lat = 35.35,
  lng = 139.49
): Promise<WeatherData | null> {
  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const endDate = tomorrow.toISOString().slice(0, 10);

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&hourly=temperature_2m,precipitation_probability,windspeed_10m,relativehumidity_2m` +
    `&timezone=Asia%2FTokyo&start_date=${startDate}&end_date=${endDate}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    const times: string[] = json.hourly?.time ?? [];
    const temps: number[] = json.hourly?.temperature_2m ?? [];
    const precips: number[] = json.hourly?.precipitation_probability ?? [];
    const winds: number[] = json.hourly?.windspeed_10m ?? [];
    const humids: number[] = json.hourly?.relativehumidity_2m ?? [];

    const hourly: HourlyWeather[] = times.map((t: string, i: number) => ({
      time: t,
      temperature: temps[i] ?? 0,
      precipitationProbability: precips[i] ?? 0,
      windspeed: winds[i] ?? 0,
      humidity: humids[i] ?? 0,
    }));

    return { hourly, fetchedAt: Date.now(), lat, lng };
  } catch {
    return null;
  }
}

/**
 * Get weather condition for the current hour from cached data.
 */
export function getCurrentWeather(
  data: WeatherData | null,
  now: Date = new Date()
): WeatherCondition | null {
  if (!data) return null;

  const localHour = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00`;

  const entry =
    data.hourly.find((h) => h.time === localHour) ?? data.hourly[0];
  if (!entry) return null;

  const isHeat = entry.temperature >= 28 && entry.humidity >= 70;
  const isRain = entry.precipitationProbability >= 40;
  const isHypothermia = entry.temperature <= 12 && isRain;
  const isHeadwind = entry.windspeed >= 7;

  let icon = '☀️';
  if (isHypothermia) icon = '🥶';
  else if (isRain) icon = '🌧️';
  else if (isHeat) icon = '🥵';
  else if (isHeadwind) icon = '💨';
  else if (entry.temperature < 18) icon = '🌤️';

  return {
    temperature: entry.temperature,
    precipitationProbability: entry.precipitationProbability,
    windspeed: entry.windspeed,
    humidity: entry.humidity,
    isHeat,
    isRain,
    isHypothermia,
    isHeadwind,
    icon,
  };
}

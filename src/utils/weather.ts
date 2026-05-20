// Weather fetching and caching via Open-Meteo API

import { getWeatherCache, saveWeatherCache } from './storage';

const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=35.35&longitude=139.49' +
  '&hourly=temperature_2m,precipitation_probability,windspeed_10m,relativehumidity_2m' +
  '&timezone=Asia%2FTokyo&start_date=2026-05-23&end_date=2026-05-24';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

export async function fetchWeather(): Promise<WeatherData | null> {
  // Check cache first
  const cached = getWeatherCache();
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as WeatherData;
  }

  try {
    const resp = await fetch(WEATHER_URL);
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

    const data: WeatherData = { hourly, fetchedAt: Date.now() };
    saveWeatherCache(data);
    return data;
  } catch {
    return null;
  }
}

/**
 * Get weather for the current hour
 */
export function getCurrentWeather(
  data: WeatherData | null,
  now: Date = new Date()
): WeatherCondition | null {
  if (!data) return null;

  const hourStr = now.toISOString().slice(0, 13); // "2026-05-23T14"
  // Find matching hour (Open-Meteo uses local time)
  const localHour = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00`;
  void hourStr; // not used directly

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

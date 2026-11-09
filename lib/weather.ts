import { computeWeatherAlerts, DailyForecastInput, WeatherAlert } from './alerts';

export interface HourlySoilPoint {
  time: string;
  soilTemp0cm: number;
  soilMoisture0to1cm: number;
}

export interface WeatherForecastResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  updatedAt: string;
  current: {
    temperature: number;
    humidity: number;
    precipitation: number;
    windSpeed: number; // m/s
    weatherCode: number;
    soilTemperature: number;
    soilMoisture: number;
  };
  todaySunrise: string;
  todaySunset: string;
  daily: DailyForecastInput[];
  hourlySoil: HourlySoilPoint[];
  alerts: WeatherAlert[];
}

export interface GeocodePlace {
  id: number;
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

/**
 * Fetches 7-day forecast and hourly soil data from Open-Meteo (Section 9.2 of SPEC.md)
 */
export async function fetchOpenMeteoForecast(
  lat: number,
  lon: number
): Promise<WeatherForecastResponse> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '7');
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code'
  );
  url.searchParams.set('hourly', 'soil_temperature_0cm,soil_moisture_0_to_1cm');
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset'
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      throw new Error(`Open-Meteo returned HTTP ${res.status}`);
    }

    const data = await res.json();

    // Find current hour index for soil temperature & moisture
    const currentIsoHour = data.current?.time
      ? data.current.time.slice(0, 13)
      : new Date().toISOString().slice(0, 13);

    const hourlyTimes: string[] = data.hourly?.time || [];
    let currentHourIdx = hourlyTimes.findIndex((t) => t.startsWith(currentIsoHour));
    if (currentHourIdx < 0) currentHourIdx = 0;

    const soilTemp =
      data.hourly?.soil_temperature_0cm?.[currentHourIdx] ??
      Math.round((data.current?.temperature_2m ?? 25) - 2);
    const soilMoisture =
      data.hourly?.soil_moisture_0_to_1cm?.[currentHourIdx] ?? 0.24;

    const hourlySoil: HourlySoilPoint[] = hourlyTimes
      .slice(currentHourIdx, currentHourIdx + 12)
      .map((time, idx) => ({
        time,
        soilTemp0cm:
          data.hourly?.soil_temperature_0cm?.[currentHourIdx + idx] ?? soilTemp,
        soilMoisture0to1cm:
          data.hourly?.soil_moisture_0_to_1cm?.[currentHourIdx + idx] ?? soilMoisture,
      }));

    const dailyDates: string[] = data.daily?.time || [];
    const daily: DailyForecastInput[] = dailyDates.map((date, idx) => ({
      date,
      tempMax: Math.round(data.daily?.temperature_2m_max?.[idx] ?? 32),
      tempMin: Math.round(data.daily?.temperature_2m_min?.[idx] ?? 18),
      precipitationSum:
        Math.round((data.daily?.precipitation_sum?.[idx] ?? 0) * 10) / 10,
      precipitationProbMax: Math.round(
        data.daily?.precipitation_probability_max?.[idx] ?? 0
      ),
      windSpeedMax:
        Math.round((data.daily?.wind_speed_10m_max?.[idx] ?? 2.5) * 10) / 10,
      weatherCode: data.daily?.weather_code?.[idx] ?? 0,
    }));

    const alerts = computeWeatherAlerts(daily);

    return {
      latitude: data.latitude ?? lat,
      longitude: data.longitude ?? lon,
      timezone: data.timezone ?? 'Asia/Karachi',
      updatedAt: new Date().toISOString(),
      current: {
        temperature: Math.round(data.current?.temperature_2m ?? 28),
        humidity: Math.round(data.current?.relative_humidity_2m ?? 45),
        precipitation: data.current?.precipitation ?? 0,
        windSpeed: Math.round((data.current?.wind_speed_10m ?? 2.4) * 10) / 10,
        weatherCode: data.current?.weather_code ?? 0,
        soilTemperature: Math.round(soilTemp),
        soilMoisture: Math.round(soilMoisture * 100), // convert m3/m3 to percentage
      },
      todaySunrise: data.daily?.sunrise?.[0]?.slice(11, 16) || '06:25',
      todaySunset: data.daily?.sunset?.[0]?.slice(11, 16) || '17:15',
      daily,
      hourlySoil,
      alerts,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchOpenMeteoPlaces(query: string): Promise<GeocodePlace[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query);
  url.searchParams.set('count', '5');
  url.searchParams.set('language', 'en');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.results)) return [];
    return data.results.map((r: Record<string, unknown>) => ({
      id: Number(r.id || Math.random()),
      name: String(r.name || ''),
      admin1: r.admin1 ? String(r.admin1) : undefined,
      country: r.country ? String(r.country) : undefined,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
    }));
  } finally {
    clearTimeout(timeout);
  }
}

const WEATHER_CACHE_KEY = 'zarkhez_last_weather_v1';

export function saveWeatherToCache(data: WeatherForecastResponse): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage quota errors
  }
}

export function getCachedWeather(): WeatherForecastResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WeatherForecastResponse;
  } catch {
    return null;
  }
}

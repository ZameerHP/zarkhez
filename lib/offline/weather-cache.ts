'use client';

import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  OFFLINE_STORES,
  type WeatherSnapshotRecord,
} from './db';
import { notifyOfflineStateChanged } from './config';
import type { WeatherForecastResponse } from '@/lib/weather';

/**
 * ZARKHEZ Offline Weather Snapshots (lib/offline/weather-cache.ts)
 *
 * Isolates rich multi-location weather caching in IndexedDB without altering
 * existing online Open-Meteo fetching or breaking lib/weather.ts helpers.
 */

export const WEATHER_STALE_WARN_MS = 6 * 60 * 60 * 1000; // 6 hours
export const WEATHER_EXPIRED_WARN_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHED_WEATHER_LOCATIONS = 10;

export function makeLocationCacheKey(lat: number, lon: number, placeName?: string): string {
  const latFixed = Number(lat || 0).toFixed(2);
  const lonFixed = Number(lon || 0).toFixed(2);
  const normalizedName = (placeName || 'farm').trim().toLowerCase().slice(0, 40);
  return `${latFixed}_${lonFixed}_${normalizedName}`;
}

export async function saveWeatherSnapshotOffline(
  placeName: string,
  lat: number,
  lon: number,
  data: WeatherForecastResponse
): Promise<boolean> {
  if (!data || typeof data !== 'object' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return false;
  }
  const now = Date.now();
  const record: WeatherSnapshotRecord = {
    locationKey: makeLocationCacheKey(lat, lon, placeName),
    placeName: (placeName || 'Farm').trim() || 'Farm',
    lat,
    lon,
    fetchedAt: now,
    data,
  };
  const okPrimary = await idbPut(OFFLINE_STORES.WEATHER_SNAPSHOTS, record);
  // Also keep a canonical 'latest' record for instant fallback when user opens offline on another coordinate
  const okLatest = await idbPut(OFFLINE_STORES.WEATHER_SNAPSHOTS, {
    ...record,
    locationKey: '__latest__',
  });

  // Cap distinct cached locations while preserving canonical '__latest__'
  if (okPrimary || okLatest) {
    try {
      const all = await idbGetAll<WeatherSnapshotRecord>(OFFLINE_STORES.WEATHER_SNAPSHOTS);
      const nonLatest = all
        .filter((r) => r.locationKey !== '__latest__')
        .sort((a, b) => (b.fetchedAt || 0) - (a.fetchedAt || 0));
      if (nonLatest.length > MAX_CACHED_WEATHER_LOCATIONS) {
        const overflow = nonLatest.slice(MAX_CACHED_WEATHER_LOCATIONS);
        for (const stale of overflow) {
          await idbDelete(OFFLINE_STORES.WEATHER_SNAPSHOTS, stale.locationKey);
        }
      }
    } catch {
      // ignore non-critical pruning failure
    }
    notifyOfflineStateChanged();
  }
  return okPrimary || okLatest;
}

export async function getWeatherSnapshotOffline(
  lat: number,
  lon: number,
  placeName?: string
): Promise<{
  weather: WeatherForecastResponse;
  fetchedAt: number;
  placeName: string;
  ageMs: number;
  isStale: boolean;
  isExpired: boolean;
} | null> {
  const exactKey = makeLocationCacheKey(lat, lon, placeName);
  let record = await idbGet<WeatherSnapshotRecord>(
    OFFLINE_STORES.WEATHER_SNAPSHOTS,
    exactKey
  );

  if (!record) {
    const all = await idbGetAll<WeatherSnapshotRecord>(
      OFFLINE_STORES.WEATHER_SNAPSHOTS
    );
    const nonLatest = all.filter((r) => r.locationKey !== '__latest__');
    if (nonLatest.length > 0) {
      // Find nearest cached location by coordinate distance
      nonLatest.sort((a, b) => {
        const da = Math.hypot(a.lat - lat, a.lon - lon);
        const db = Math.hypot(b.lat - lat, b.lon - lon);
        return da - db;
      });
      const nearest = nonLatest[0];
      if (Math.hypot(nearest.lat - lat, nearest.lon - lon) < 1.2) {
        record = nearest;
      }
    }
    if (!record) {
      record = await idbGet<WeatherSnapshotRecord>(
        OFFLINE_STORES.WEATHER_SNAPSHOTS,
        '__latest__'
      );
    }
  }

  if (!record || !record.data) return null;

  const ageMs = Math.max(0, Date.now() - (record.fetchedAt || Date.now()));
  return {
    weather: record.data as WeatherForecastResponse,
    fetchedAt: record.fetchedAt,
    placeName: record.placeName,
    ageMs,
    isStale: ageMs >= WEATHER_STALE_WARN_MS,
    isExpired: ageMs >= WEATHER_EXPIRED_WARN_MS,
  };
}

export function formatWeatherAgeLabel(
  fetchedAt: number,
  locale: 'en' | 'ur' | 'sd'
): string {
  const diffMs = Math.max(0, Date.now() - fetchedAt);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 2) {
    return locale === 'sd'
      ? 'هاڻي محفوظ ٿيو'
      : locale === 'ur'
      ? 'ابھی محفوظ ہوا'
      : 'Saved just now';
  }
  if (mins < 60) {
    return locale === 'sd'
      ? `${mins} منٽ اڳ محفوظ`
      : locale === 'ur'
      ? `${mins} منٹ پہلے محفوظ`
      : `Saved ${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return locale === 'sd'
      ? `${hours} ڪلاڪ اڳ محفوظ`
      : locale === 'ur'
      ? `${hours} گھنٹے پہلے محفوظ`
      : `Saved ${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return locale === 'sd'
    ? `${days} ڏينهن اڳ محفوظ`
    : locale === 'ur'
    ? `${days} دن پہلے محفوظ`
    : `Saved ${days}d ago`;
}

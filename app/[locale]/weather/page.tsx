'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import {
  ArrowLeft,
  CloudRain,
  Sun,
  CloudSun,
  Wind,
  Thermometer,
  Droplets,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { WeatherCard } from '@/components/weather/WeatherCard';
import { LocationPickerModal } from '@/components/weather/LocationPickerModal';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import {
  getCachedWeather,
  saveWeatherToCache,
  WeatherForecastResponse,
} from '@/lib/weather';
import { getSavedProfile, saveProfile } from '@/lib/supabase/client';

/**
 * Weather Screen (Section 11.2 of SPEC.md):
 * "Same card style, larger. Hourly strip, 7-day list, alert list with plain-language actions, soil section."
 */
export default function WeatherPage() {
  const t = useTranslations('weatherPage');
  const tAlerts = useTranslations('alerts');
  const locale = useLocale() as 'ur' | 'en';

  const [placeName, setPlaceName] = useState('Multan, Punjab');
  const [coords, setCoords] = useState({ lat: 30.1575, lon: 71.5249 });
  const [weather, setWeather] = useState<WeatherForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [weatherUnavailable, setWeatherUnavailable] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);

  const fetchWeather = useCallback(async (lat: number, lon: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error('Weather error');
      const data = (await res.json()) as WeatherForecastResponse;
      setWeather(data);
      setIsOffline(false);
      setWeatherUnavailable(false);
      saveWeatherToCache(data);
    } catch {
      const cached = getCachedWeather();
      if (cached) {
        setWeather(cached);
        setIsOffline(true);
        setWeatherUnavailable(false);
      } else {
        setWeatherUnavailable(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const profile = getSavedProfile();
    setPlaceName(profile.placeName);
    setCoords({ lat: profile.lat, lon: profile.lon });
    const cached = getCachedWeather();
    if (cached) setWeather(cached);
    fetchWeather(profile.lat, profile.lon);
  }, [fetchWeather]);

  const handleSelectPlace = async (
    nextPlace: string,
    lat: number,
    lon: number
  ) => {
    setPlaceName(nextPlace);
    setCoords({ lat, lon });
    setShowLocationModal(false);
    await saveProfile({ placeName: nextPlace, lat, lon });
    fetchWeather(lat, lon);
  };

  const hasSprayWarning = weather?.alerts?.some(
    (a) => a.type === 'spray_warning'
  );

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#062409] to-olive-dark text-white rounded-b-[32px] px-4 sm:px-5 pt-4 pb-20 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Link
              href="/home"
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full glass flex items-center justify-center text-white"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </Link>
            <ZarkhezLogo size={34} lightText showText={false} />
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle variant="glass" />
            <button
              type="button"
              onClick={() => fetchWeather(coords.lat, coords.lon)}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full glass flex items-center justify-center text-white"
              aria-label="Refresh"
            >
              <RefreshCw
                className={`w-4 h-4 sm:w-5 sm:h-5 ${
                  loading ? 'animate-spin' : ''
                }`}
              />
            </button>
          </div>
        </div>

        <div className="mt-4">
          <h1 className="font-extrabold text-2xl text-white">{t('title')}</h1>
          <p className="text-xs text-white/80 mt-0.5">{t('subtitle')}</p>
        </div>
      </header>

      <main className="px-5 -mt-12 space-y-5">
        {/* Main Weather Card + Active Alerts */}
        <WeatherCard
          placeName={placeName}
          weather={weather}
          loading={loading}
          isOfflineCached={isOffline}
          weatherUnavailable={weatherUnavailable}
          onRefresh={() => fetchWeather(coords.lat, coords.lon)}
          onChangeLocation={() => setShowLocationModal(true)}
        />

        {/* Spray Safety Status Pill */}
        <div
          className={`rounded-card p-4 shadow-soft border flex items-center gap-3.5 ${
            hasSprayWarning
              ? 'bg-cream border-alert-amber/50 text-ink'
              : 'bg-olive/12 border-olive/30 text-olive-dark'
          }`}
        >
          {hasSprayWarning ? (
            <AlertTriangle className="w-6 h-6 text-alert-amber flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-6 h-6 text-olive flex-shrink-0" />
          )}
          <div>
            <h2 className="font-extrabold text-sm">
              {hasSprayWarning ? t('sprayUnsafe') : t('spraySafe')}
            </h2>
            <p className="text-xs text-ink/75 mt-0.5">
              {hasSprayWarning
                ? tAlerts('sprayWarningDesc')
                : tAlerts('noAlerts')}
            </p>
          </div>
        </div>

        {/* Soil Section (0-1 cm temperature & moisture) */}
        <section className="bg-white rounded-card p-5 shadow-soft border border-olive/10 space-y-3">
          <h2 className="font-extrabold text-base text-ink">
            {t('soilSection')}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-canvas rounded-tile p-3.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-olive/15 text-olive-dark flex items-center justify-center flex-shrink-0">
                <Thermometer className="w-5 h-5" />
              </div>
              <div>
                <span className="block text-xs text-ink/65">Soil 0cm</span>
                <bdi dir="ltr" className="font-extrabold text-lg text-ink">
                  {weather?.current.soilTemperature ?? 26}°C
                </bdi>
              </div>
            </div>

            <div className="bg-canvas rounded-tile p-3.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-cream text-wheat flex items-center justify-center flex-shrink-0">
                <Droplets className="w-5 h-5" />
              </div>
              <div>
                <span className="block text-xs text-ink/65">
                  {t('soilMoisture')}
                </span>
                <bdi dir="ltr" className="font-extrabold text-lg text-ink">
                  {weather?.current.soilMoisture ?? 24}%
                </bdi>
              </div>
            </div>
          </div>
          <p className="text-xs text-ink/70 leading-relaxed">
            {t('soilTempNote')}
          </p>
        </section>

        {/* Hourly Soil & Conditions Strip */}
        {weather?.hourlySoil && weather.hourlySoil.length > 0 && (
          <section className="bg-white rounded-card p-5 shadow-soft border border-olive/10 space-y-3">
            <h2 className="font-extrabold text-base text-ink">
              {t('hourlyStrip')}
            </h2>
            <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
              {weather.hourlySoil.map((h, i) => (
                <div
                  key={h.time || i}
                  className="flex-shrink-0 w-20 bg-canvas rounded-tile p-2.5 flex flex-col items-center text-center"
                >
                  <bdi dir="ltr" className="text-[11px] font-semibold text-ink/65">
                    {h.time ? h.time.slice(11, 16) : `${i}:00`}
                  </bdi>
                  <Thermometer className="w-4 h-4 text-olive my-1.5" />
                  <bdi dir="ltr" className="font-bold text-sm text-ink">
                    {Math.round(h.soilTemp0cm)}°C
                  </bdi>
                  <bdi dir="ltr" className="text-[10px] text-wheat mt-0.5">
                    {Math.round(h.soilMoisture0to1cm * 100)}%
                  </bdi>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 7-Day Forecast List */}
        <section className="bg-white rounded-card p-5 shadow-soft border border-olive/10 space-y-3">
          <h2 className="font-extrabold text-base text-ink">{t('sevenDay')}</h2>
          <div className="divide-y divide-olive/10">
            {(weather?.daily || []).map((day, idx) => {
              const dt = new Date(`${day.date}T00:00:00`);
              const dayLabel =
                idx === 0
                  ? t('today')
                  : new Intl.DateTimeFormat(
                      locale === 'ur' ? 'ur-PK' : 'en-PK',
                      { weekday: 'short', month: 'short', day: 'numeric' }
                    ).format(dt);

              const DayIcon =
                day.precipitationProbMax >= 50 || day.precipitationSum >= 5
                  ? CloudRain
                  : day.tempMax >= 37
                  ? Sun
                  : CloudSun;

              return (
                <div
                  key={day.date}
                  className="py-3 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-3 min-w-[115px]">
                    <div className="w-9 h-9 rounded-xl bg-canvas flex items-center justify-center text-olive-dark flex-shrink-0">
                      <DayIcon className="w-5 h-5" />
                    </div>
                    <span className="font-bold text-sm text-ink">
                      {dayLabel}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-ink/75">
                    <span className="inline-flex items-center gap-1">
                      <CloudRain className="w-3.5 h-3.5 text-olive" />
                      <bdi dir="ltr">{day.precipitationProbMax}%</bdi>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Wind className="w-3.5 h-3.5 text-wheat" />
                      <bdi dir="ltr">{day.windSpeedMax}m/s</bdi>
                    </span>
                  </div>

                  <div className="text-end">
                    <bdi dir="ltr" className="font-extrabold text-sm text-ink">
                      {day.tempMax}° /{' '}
                      <span className="text-ink/55 font-semibold">
                        {day.tempMin}°
                      </span>
                    </bdi>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <BottomNav />

      <LocationPickerModal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onSelectPlace={handleSelectPlace}
      />
    </div>
  );
}

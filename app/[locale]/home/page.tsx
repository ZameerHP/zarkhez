'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Navigation,
  ChevronRight,
  X,
  AlertTriangle,
} from 'lucide-react';
import { AmbientCanvas } from '@/components/home/AmbientCanvas';
import { LangToggle } from '@/components/home/LangToggle';
import { HeroTemp } from '@/components/home/HeroTemp';
import { SunArc } from '@/components/home/SunArc';
import { StatTile } from '@/components/home/StatTile';
import { CommandBar } from '@/components/home/CommandBar';
import { FloatingDock } from '@/components/home/FloatingDock';
import {
  FLAGSHIP_SPRING,
  getFirstName,
  getTimePhase,
  getWeatherConditionMeta,
  triggerHaptic,
} from '@/components/home/motion';
import {
  GeocodePlace,
  getCachedWeather,
  saveWeatherToCache,
  WeatherForecastResponse,
} from '@/lib/weather';
import {
  FarmerProfile,
  getSavedProfile,
  saveProfile,
  syncSupabaseAuthSession,
} from '@/lib/supabase/client';

const POPULAR_PLACES: GeocodePlace[] = [
  { id: 1, name: 'Faisalabad', admin1: 'Punjab', latitude: 31.418, longitude: 73.079 },
  { id: 2, name: 'Sahiwal', admin1: 'Punjab', latitude: 30.6682, longitude: 73.1114 },
  { id: 3, name: 'Lahore', admin1: 'Punjab', latitude: 31.5204, longitude: 74.3587 },
  { id: 4, name: 'Sargodha', admin1: 'Punjab', latitude: 32.0836, longitude: 72.6711 },
  { id: 5, name: 'Gujranwala', admin1: 'Punjab', latitude: 32.1877, longitude: 74.1945 },
  { id: 6, name: 'Rahim Yar Khan', admin1: 'Punjab', latitude: 28.4202, longitude: 70.3013 },
  { id: 7, name: 'Bahawalpur', admin1: 'Punjab', latitude: 29.3956, longitude: 71.6836 },
  { id: 8, name: 'Multan', admin1: 'Punjab', latitude: 30.1575, longitude: 71.5249 },
  { id: 9, name: 'Hyderabad', admin1: 'Sindh', latitude: 25.396, longitude: 68.3578 },
  { id: 10, name: 'Mardan', admin1: 'KPK', latitude: 34.1986, longitude: 72.0404 },
  { id: 11, name: 'Swat', admin1: 'KPK', latitude: 35.2227, longitude: 72.4258 },
];

export default function HomePage() {
  const tHome = useTranslations('home');
  const tWelcome = useTranslations('welcome');
  const tAlerts = useTranslations('alerts');
  const locale = useLocale() as 'ur' | 'en';

  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<FarmerProfile>(() => getSavedProfile());
  const [weather, setWeather] = useState<WeatherForecastResponse | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [isOfflineCached, setIsOfflineCached] = useState(false);

  const [showLocationModal, setShowLocationModal] = useState(false);
  const [detectingGps, setDetectingGps] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodePlace[]>([]);

  const loadWeather = useCallback(async (lat: number, lon: number) => {
    setLoadingWeather(true);
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error('Weather API failed');
      const data = (await res.json()) as WeatherForecastResponse;
      setWeather(data);
      setIsOfflineCached(false);
      saveWeatherToCache(data);
    } catch {
      const cached = getCachedWeather();
      if (cached) {
        setWeather(cached);
        setIsOfflineCached(true);
      }
    } finally {
      setLoadingWeather(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const savedProfile = getSavedProfile();
    setProfile(savedProfile);

    syncSupabaseAuthSession().then((synced) => {
      if (synced) setProfile(synced);
    });

    const cached = getCachedWeather();
    if (cached) {
      setWeather(cached);
    }
    loadWeather(savedProfile.lat, savedProfile.lon);
  }, [loadWeather]);

  const handleSelectPlace = async (
    placeName: string,
    lat: number,
    lon: number
  ) => {
    triggerHaptic(8);
    const updated = await saveProfile({ placeName, lat, lon });
    setProfile(updated);
    setShowLocationModal(false);
    loadWeather(lat, lon);
  };

  const handleUseGps = () => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) return;
    triggerHaptic(8);
    setDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDetectingGps(false);
        handleSelectPlace(
          locale === 'ur' ? 'میرا کھیت (GPS)' : 'My Farm (GPS)',
          pos.coords.latitude,
          pos.coords.longitude
        );
      },
      () => setDetectingGps(false),
      { timeout: 6000 }
    );
  };

  const handleSearchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim().length < 2) return;
    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(searchQuery.trim())}`
      );
      const data = await res.json();
      setSearchResults(data.places || []);
    } catch {
      setSearchResults([]);
    }
  };

  const formattedDate = mounted
    ? new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
      }).format(new Date())
    : '';

  const current = weather?.current ?? {
    temperature: 27,
    humidity: 44,
    precipitation: 0,
    windSpeed: 2.3,
    weatherCode: 0,
    soilTemperature: 25,
    soilMoisture: 24,
  };
  const todayRainProb = weather?.daily?.[0]?.precipitationProbMax ?? 10;
  const sunrise = weather?.todaySunrise || '06:39';
  const sunset = weather?.todaySunset || '17:41';
  const phase = mounted ? getTimePhase(sunrise, sunset) : 'day';
  const conditionMeta = getWeatherConditionMeta(
    current.weatherCode,
    locale,
    current.precipitation,
    todayRainProb
  );
  const firstName = getFirstName(profile.fullName, locale);
  const primaryAlert = weather?.alerts?.[0] || null;
  const isInitialLoading = loadingWeather && !weather;

  return (
    <div className="relative min-h-[100dvh] bg-[#07140D] text-[#F6F3EA] overflow-x-hidden pb-[calc(10.5rem+env(safe-area-inset-bottom))]">
      {/* Living Full-Bleed Weather Canvas */}
      <AmbientCanvas phase={phase} scene={conditionMeta.scene} />

      <div className="relative z-10 px-4 sm:px-5 pt-4 space-y-5">
        {/* 1. Transparent Top Bar */}
        <header className="flex items-center justify-between gap-2 min-h-[44px]">
          <Link
            href="/home"
            className="inline-flex items-center gap-2.5 min-w-0 min-h-[44px]"
          >
            <div className="w-7 h-7 rounded-[9px] overflow-hidden ring-1 ring-white/20 bg-[#07140D] flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/zarkhez-logo-mark.png"
                alt="Zarkhez Fertile"
                width={28}
                height={28}
                className="w-full h-full object-cover"
              />
            </div>
            <span
              className={`truncate ${
                locale === 'ur'
                  ? 'zrk-urdu-display text-lg text-[#F6F3EA]'
                  : 'text-[15px] font-medium tracking-tight text-[#F6F3EA]'
              }`}
            >
              {locale === 'ur' ? 'زرخیز' : 'Zarkhez Fertile'}
            </span>
          </Link>

          <LangToggle />
        </header>

        {/* 2. Editorial Greeting */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={FLAGSHIP_SPRING}
          className="space-y-1 pt-0.5"
        >
          <p
            className={`text-[#F6F3EA]/62 ${
              locale === 'ur'
                ? 'text-xs'
                : 'text-[11px] uppercase tracking-[0.14em] font-medium'
            }`}
          >
            {formattedDate || (locale === 'ur' ? 'آج کا دن' : 'Today')}
          </p>

          <h1
            className={
              locale === 'ur'
                ? 'zrk-urdu-display text-[28px] sm:text-[32px] font-normal'
                : 'font-display text-[32px] sm:text-[36px] leading-[1.1] tracking-[-0.02em] font-normal'
            }
          >
            <span className="block text-[#F6F3EA]/92">
              {locale === 'ur' ? 'السلام علیکم،' : 'Assalam o Alaikum,'}
            </span>
            <span className="block text-[#D9B863] break-words">
              {firstName}
            </span>
          </h1>
        </motion.section>

        {/* 3. Hero Weather (Giant Serif Numeral + Location + Voice Pill) */}
        <HeroTemp
          locale={locale}
          placeName={profile.placeName}
          weather={weather}
          loading={loadingWeather}
          isOfflineCached={isOfflineCached}
          phase={phase}
          onRefresh={() => loadWeather(profile.lat, profile.lon)}
          onChangeLocation={() => setShowLocationModal(true)}
        />

        {/* 4. Solar Arc */}
        <SunArc sunrise={sunrise} sunset={sunset} locale={locale} />

        {/* Actionable Weather Alert Pill (Only if an immediate weather action exists) */}
        {primaryAlert && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...FLAGSHIP_SPRING, delay: 0.16 }}
          >
            <Link
              href="/weather"
              onClick={() => triggerHaptic(6)}
              className="liquid-glass rounded-full min-h-[44px] px-3.5 py-2 flex items-center justify-between gap-2.5 hover:bg-white/[0.11] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle
                  className="w-4 h-4 text-[#D9B863] flex-shrink-0"
                  strokeWidth={1.5}
                />
                <span className="text-xs font-medium text-[#F6F3EA]/90 truncate">
                  {tAlerts(
                    primaryAlert.titleKey.replace('alerts.', '') as 'heatwaveTitle'
                  )}
                </span>
              </div>
              <ChevronRight
                className="w-4 h-4 text-[#D9B863] rtl:rotate-180 flex-shrink-0"
                strokeWidth={1.5}
              />
            </Link>
          </motion.div>
        )}

        {/* 5. 2x2 Frosted Liquid-Glass Bento Stats */}
        <section
          aria-label={locale === 'ur' ? 'موسم کی تفصیل' : 'Agricultural weather metrics'}
          className="grid grid-cols-2 gap-3 pt-1"
        >
          <StatTile
            variant="soilTemp"
            label={tHome('soilTemp')}
            value={current.soilTemperature}
            unit="°C"
            index={0}
            loading={isInitialLoading}
          />
          <StatTile
            variant="humidity"
            label={tHome('humidity')}
            value={current.humidity}
            unit="%"
            index={1}
            loading={isInitialLoading}
          />
          <StatTile
            variant="wind"
            label={tHome('wind')}
            value={current.windSpeed}
            unit="m/s"
            decimals={1}
            index={2}
            loading={isInitialLoading}
          />
          <StatTile
            variant="rain"
            label={tHome('rain')}
            value={todayRainProb}
            unit="%"
            index={3}
            loading={isInitialLoading}
          />
        </section>
      </div>

      {/* 6. Floating AI Command Bar */}
      <CommandBar locale={locale} />

      {/* 7. Detached Liquid-Glass Floating Dock */}
      <FloatingDock />

      {/* Location Picker Modal (Dark Liquid Glass) */}
      <AnimatePresence>
        {showLocationModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#040B07]/75 backdrop-blur-md flex items-end sm:items-center justify-center p-4"
            onClick={() => setShowLocationModal(false)}
          >
            <motion.div
              initial={{ y: 36, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 28, opacity: 0, scale: 0.98 }}
              transition={FLAGSHIP_SPRING}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[420px] rounded-[28px] bg-[#0B1E13]/95 backdrop-blur-2xl border border-white/15 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.65)] space-y-4 text-[#F6F3EA]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#D9B863]" strokeWidth={1.5} />
                  <h2 className="text-base font-medium text-[#F6F3EA]">
                    {tWelcome('locationTitle')}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLocationModal(false)}
                  aria-label="Close"
                  className="w-11 h-11 -m-1.5 rounded-full flex items-center justify-center text-[#F6F3EA]/70 hover:text-[#F6F3EA]"
                >
                  <X className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </div>

              <button
                type="button"
                onClick={handleUseGps}
                disabled={detectingGps}
                className="w-full min-h-[46px] rounded-full bg-gradient-to-r from-[#E6CA7A] to-[#C8A147] text-[#07140D] font-semibold px-4 py-2 flex items-center justify-center gap-2 text-sm shadow-goldGlow active:scale-[0.97] transition-transform"
              >
                <Navigation className="w-4 h-4" strokeWidth={1.6} />
                <span>
                  {detectingGps ? tWelcome('detectingGps') : tWelcome('useGps')}
                </span>
              </button>

              <form onSubmit={handleSearchPlace} className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={tWelcome('searchPlaceholder')}
                  className="flex-1 min-h-[44px] px-4 rounded-full bg-white/[0.07] border border-white/12 text-[#F6F3EA] placeholder:text-[#F6F3EA]/45 text-sm focus:outline-none focus:border-[#D9B863]/50"
                />
                <button
                  type="submit"
                  className="min-h-[44px] px-4 rounded-full bg-white/12 hover:bg-white/20 text-[#F6F3EA] text-xs font-medium border border-white/12"
                >
                  {tWelcome('searchBtn')}
                </button>
              </form>

              {searchResults.length > 0 && (
                <div className="max-h-36 overflow-y-auto space-y-1.5">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        handleSelectPlace(
                          `${p.name}${p.admin1 ? `, ${p.admin1}` : ''}`,
                          p.latitude,
                          p.longitude
                        )
                      }
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-[14px] bg-white/[0.06] hover:bg-white/[0.12] text-start text-xs font-medium text-[#F6F3EA] flex items-center justify-between border border-white/10"
                    >
                      <span>
                        {p.name}
                        {p.admin1 ? `, ${p.admin1}` : ''}
                      </span>
                      <ChevronRight
                        className="w-4 h-4 text-[#D9B863] rtl:rotate-180"
                        strokeWidth={1.5}
                      />
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5 pt-1">
                {POPULAR_PLACES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      handleSelectPlace(
                        `${p.name}, ${p.admin1}`,
                        p.latitude,
                        p.longitude
                      )
                    }
                    className="min-h-[36px] px-3 py-1 rounded-full bg-white/[0.06] hover:bg-[#D9B863]/20 hover:border-[#D9B863]/45 text-xs font-medium text-[#F6F3EA]/85 border border-white/12 transition-colors"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

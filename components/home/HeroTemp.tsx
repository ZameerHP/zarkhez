'use client';

import React, { useEffect, useState } from 'react';
import {
  MapPin,
  RefreshCw,
  Volume2,
  Square,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { WeatherForecastResponse } from '@/lib/weather';
import { speakText, stopSpeaking, unlockAudio } from '@/lib/voice';
import {
  FLAGSHIP_SPRING,
  getWeatherConditionMeta,
  navigateWithSharedTransition,
  TimePhase,
  triggerHaptic,
  usePrefersReducedMotion,
  WeatherScene,
} from './motion';

interface HeroTempProps {
  locale: 'ur' | 'en';
  placeName: string;
  weather: WeatherForecastResponse | null;
  loading: boolean;
  isOfflineCached: boolean;
  phase: TimePhase;
  onRefresh: () => void;
  onChangeLocation: () => void;
}

function WeatherHaloIllustration({
  scene,
  phase,
  reducedMotion,
}: {
  scene: WeatherScene;
  phase: TimePhase;
  reducedMotion: boolean;
}) {
  const isNight = phase === 'night';

  return (
    <motion.div
      animate={
        reducedMotion
          ? undefined
          : { y: [0, -4, 0], opacity: [0.88, 1, 0.88] }
      }
      transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
      className="relative w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center pointer-events-none select-none"
      aria-hidden="true"
    >
      {/* Radial ambient halo */}
      <div
        className="absolute inset-1 rounded-full"
        style={{
          background: isNight
            ? 'radial-gradient(circle, rgba(125,240,176,0.22) 0%, rgba(217,184,99,0.10) 45%, transparent 72%)'
            : scene === 'rain' || scene === 'storm'
            ? 'radial-gradient(circle, rgba(125,240,176,0.22) 0%, rgba(246,243,234,0.08) 50%, transparent 72%)'
            : 'radial-gradient(circle, rgba(217,184,99,0.34) 0%, rgba(217,184,99,0.12) 45%, transparent 72%)',
        }}
      />

      {/* Crisp fine-line 1.5px weather icon */}
      <svg
        viewBox="0 0 96 96"
        className="w-full h-full overflow-visible"
        fill="none"
      >
        {isNight && scene === 'clear' ? (
          <>
            <path
              d="M58 24C44.7 24 34 34.7 34 48C34 61.3 44.7 72 58 72C62.2 72 66.2 70.9 69.6 69C60.7 67.2 54 59.4 54 50C54 40.6 60.7 32.8 69.6 31C66.2 26.7 62.3 24 58 24Z"
              stroke="#D9B863"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="rgba(217,184,99,0.14)"
            />
            <circle cx="28" cy="30" r="1.4" fill="#F6F3EA" fillOpacity="0.65" />
            <circle cx="68" cy="22" r="1.2" fill="#7DF0B0" fillOpacity="0.6" />
          </>
        ) : scene === 'rain' || scene === 'storm' ? (
          <>
            <path
              d="M32 58H64C70.1 58 75 53.1 75 47C75 41.3 70.6 36.6 65 36.1C62.8 28.5 55.8 23 47.5 23C37.3 23 29 31.3 29 41.5C29 42.1 29 42.6 29.1 43.2C24.5 44.3 21 48.5 21 53.5C21 56 23 58 32 58Z"
              stroke="#F6F3EA"
              strokeOpacity="0.82"
              strokeWidth="1.5"
              fill="rgba(246,243,234,0.08)"
            />
            <path
              d="M38 64L35 73M48 64L45 75M58 64L55 73"
              stroke="#7DF0B0"
              strokeOpacity="0.85"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        ) : scene === 'cloudy' || scene === 'fog' ? (
          <>
            <circle
              cx="58"
              cy="34"
              r="11"
              stroke="#D9B863"
              strokeOpacity="0.7"
              strokeWidth="1.5"
              fill="rgba(217,184,99,0.14)"
            />
            <path
              d="M30 62H64C70.1 62 75 57.1 75 51C75 45.3 70.6 40.6 65 40.1C62.8 32.5 55.8 27 47.5 27C37.3 27 29 35.3 29 45.5C29 46.1 29 46.6 29.1 47.2C24.5 48.3 21 52.5 21 57.5C21 60 23 62 30 62Z"
              stroke="#F6F3EA"
              strokeOpacity="0.85"
              strokeWidth="1.5"
              fill="rgba(246,243,234,0.08)"
            />
          </>
        ) : scene === 'partlyCloudy' ? (
          <>
            <circle
              cx="56"
              cy="34"
              r="13"
              stroke="#D9B863"
              strokeWidth="1.5"
              fill="rgba(217,184,99,0.18)"
            />
            <path
              d="M28 63H59C64.5 63 69 58.5 69 53C69 47.9 65.1 43.7 60.1 43.1C58.1 36.4 51.9 31.5 44.5 31.5C35.4 31.5 28 38.9 28 48C28 48.5 28 49 28.1 49.5C24.1 50.5 21 54.1 21 58.5C21 61 23 63 28 63Z"
              stroke="#F6F3EA"
              strokeOpacity="0.88"
              strokeWidth="1.5"
              fill="rgba(246,243,234,0.10)"
            />
          </>
        ) : (
          <>
            <circle
              cx="48"
              cy="48"
              r="18"
              stroke="#D9B863"
              strokeWidth="1.5"
              fill="rgba(217,184,99,0.20)"
            />
            <circle
              cx="48"
              cy="48"
              r="26"
              stroke="#D9B863"
              strokeOpacity="0.32"
              strokeWidth="1"
              strokeDasharray="3 5"
            />
          </>
        )}
      </svg>
    </motion.div>
  );
}

export function HeroTemp({
  locale,
  placeName,
  weather,
  loading,
  isOfflineCached,
  phase,
  onRefresh,
  onChangeLocation,
}: HeroTempProps) {
  const tHome = useTranslations('home');
  const tApp = useTranslations('app');
  const tAlerts = useTranslations('alerts');
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();

  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  if (loading && !weather) {
    return (
      <section className="relative py-2 space-y-4" aria-busy="true">
        <div className="flex items-center justify-between">
          <div className="relative overflow-hidden h-[104px] w-40 rounded-3xl bg-white/[0.06] zrk-skeleton" />
          <div className="relative overflow-hidden h-24 w-24 rounded-full bg-white/[0.05] zrk-skeleton" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative overflow-hidden h-11 w-40 rounded-full bg-white/[0.06] zrk-skeleton" />
          <div className="relative overflow-hidden h-11 w-28 rounded-full bg-white/[0.05] zrk-skeleton" />
        </div>
      </section>
    );
  }

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
  const condition = getWeatherConditionMeta(
    current.weatherCode,
    locale,
    current.precipitation,
    todayRainProb
  );

  const formattedTime = weather?.updatedAt
    ? new Date(weather.updatedAt).toLocaleTimeString(
        locale === 'ur' ? 'en-US' : 'en-US',
        { hour: 'numeric', minute: '2-digit' }
      )
    : locale === 'ur'
    ? 'ابھی'
    : 'Now';

  const alerts = weather?.alerts || [];
  const activeAlertText =
    alerts.length > 0
      ? `${tAlerts(alerts[0].titleKey.replace('alerts.', '') as 'heatwaveTitle')}.`
      : '';

  const spokenSummary =
    locale === 'ur'
      ? `${placeName}۔ درجہ حرارت ${current.temperature} ڈگری۔ ${condition.label}۔ مٹی کی تپش ${current.soilTemperature} ڈگری، نمی ${current.humidity} فیصد۔ ${activeAlertText}`
      : `${placeName}. ${current.temperature} degrees, ${condition.label}. Soil temperature ${current.soilTemperature} degrees, humidity ${current.humidity} percent, wind ${current.windSpeed} meters per second. ${activeAlertText}`;

  const handleToggleVoice = () => {
    unlockAudio();
    triggerHaptic(8);
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speakText(spokenSummary, locale, {
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  const handleOpenWeatherDetail = () => {
    triggerHaptic(6);
    navigateWithSharedTransition((href) => router.push(href), '/weather');
  };

  return (
    <section className="relative z-10 space-y-3">
      {/* Giant Serif Temperature + Ambient Weather Halo */}
      <div className="flex items-center justify-between gap-2">
        <motion.button
          type="button"
          layoutId="weather-hero-temp"
          style={{ viewTransitionName: 'zrk-weather-hero' }}
          onClick={handleOpenWeatherDetail}
          whileTap={{ scale: 0.97 }}
          initial={
            reducedMotion
              ? { opacity: 1 }
              : { opacity: 0, scale: 0.96, filter: 'blur(8px)' }
          }
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="text-start focus:outline-none group"
          aria-label={
            locale === 'ur'
              ? `موجودہ درجہ حرارت ${current.temperature} ڈگری، مکمل موسم دیکھیں`
              : `Current temperature ${current.temperature} degrees, view 7-day weather`
          }
        >
          <div className="relative inline-flex items-start">
            <bdi
              dir="ltr"
              className="zrk-numeric-display font-light text-[#F6F3EA] tracking-[-0.04em] text-[96px] sm:text-[112px] drop-shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
            >
              {current.temperature}
            </bdi>
            <span
              className="zrk-numeric-display font-light text-[#D9B863] text-[44px] sm:text-[52px] ms-0.5 mt-2"
              aria-hidden="true"
            >
              °
            </span>
          </div>
        </motion.button>

        <WeatherHaloIllustration
          scene={condition.scene}
          phase={phase}
          reducedMotion={reducedMotion}
        />
      </div>

      {/* Location Pill + Condition & Updated Line + Listen in Voice Pill */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={FLAGSHIP_SPRING}
            onClick={() => {
              triggerHaptic(6);
              onChangeLocation();
            }}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-full liquid-glass text-xs font-medium text-[#F6F3EA] hover:bg-white/15 transition-colors max-w-full"
          >
            <MapPin
              className="w-3.5 h-3.5 text-[#D9B863] flex-shrink-0"
              strokeWidth={1.5}
            />
            <span className="truncate max-w-[200px]">{placeName}</span>
          </motion.button>

          {/* Compact Listen in Voice Glass Pill */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={FLAGSHIP_SPRING}
            onClick={handleToggleVoice}
            aria-label={speaking ? tApp('stopListening') : tApp('listen')}
            className={`inline-flex items-center gap-2 min-h-[44px] px-3.5 rounded-full text-xs font-medium transition-colors ${
              speaking
                ? 'bg-[#D9B863]/20 border border-[#D9B863]/50 text-[#F6F3EA]'
                : 'liquid-glass text-[#F6F3EA]/85 hover:text-[#F6F3EA]'
            }`}
          >
            {speaking ? (
              <>
                <Square
                  className="w-3 h-3 text-[#D9B863] fill-[#D9B863]"
                  strokeWidth={1.5}
                />
                <span className="inline-flex items-end gap-[2.5px] h-3" aria-hidden="true">
                  {[0, 1, 2].map((bar) => (
                    <motion.span
                      key={bar}
                      animate={{ scaleY: [0.35, 1, 0.45] }}
                      transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: bar * 0.14,
                        ease: 'easeInOut',
                      }}
                      className="w-[2px] h-full rounded-full bg-[#D9B863] origin-bottom"
                    />
                  ))}
                </span>
                <span>{locale === 'ur' ? 'رکیں' : 'Stop'}</span>
              </>
            ) : (
              <>
                <Volume2
                  className="w-3.5 h-3.5 text-[#D9B863]"
                  strokeWidth={1.5}
                />
                <span>{locale === 'ur' ? 'سنیں' : 'Listen'}</span>
              </>
            )}
          </motion.button>
        </div>

        {/* Condition Word + Updated Timestamp + Tiny Inline Refresh */}
        <div className="inline-flex items-center gap-2 px-1 text-xs text-[#F6F3EA]/72 zrk-text-scrim rounded-full">
          <span className="font-medium text-[#F6F3EA]/90">
            {condition.label}
          </span>
          <span aria-hidden="true" className="text-[#F6F3EA]/35">
            •
          </span>
          <span className="text-[#F6F3EA]/65">
            {isOfflineCached ? (
              <span className="text-[#D9B863]">{tHome('cachedOffline')}</span>
            ) : (
              <>
                {tHome('updatedAt')}{' '}
                <bdi dir="ltr">{formattedTime}</bdi>
              </>
            )}
          </span>
          <motion.button
            type="button"
            whileTap={{ rotate: 180, scale: 0.9 }}
            transition={FLAGSHIP_SPRING}
            onClick={() => {
              triggerHaptic(6);
              onRefresh();
            }}
            aria-label={tHome('refresh')}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] -my-3 -mx-2 text-[#F6F3EA]/60 hover:text-[#D9B863] transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#D9B863]' : ''}`}
              strokeWidth={1.5}
            />
          </motion.button>
        </div>
      </div>
    </section>
  );
}

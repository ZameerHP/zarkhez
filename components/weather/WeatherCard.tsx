'use client';

import React from 'react';
import {
  CloudSun,
  CloudRain,
  Sun,
  Thermometer,
  Droplets,
  Wind,
  AlertTriangle,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { WeatherForecastResponse } from '@/lib/weather';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';

interface WeatherCardProps {
  placeName: string;
  weather: WeatherForecastResponse | null;
  loading: boolean;
  isOfflineCached?: boolean;
  weatherUnavailable?: boolean;
  onRefresh?: () => void;
  onChangeLocation?: () => void;
}

/**
 * Overlapping White Weather Card & Alert Banner:
 * - Fully responsive on narrow 320px-430px phone screens (2x2 stat grid on narrow phones, 4-col on wider screens)
 * - Smooth Framer Motion entrance and interactive tap feedback
 */
export function WeatherCard({
  placeName,
  weather,
  loading,
  isOfflineCached = false,
  weatherUnavailable = false,
  onRefresh,
  onChangeLocation,
}: WeatherCardProps) {
  const tHome = useTranslations('home');
  const tAlerts = useTranslations('alerts');
  const locale = (useLocale() === 'en' ? 'en' : 'ur') as 'ur' | 'en';

  const current = weather?.current ?? {
    temperature: 29,
    humidity: 44,
    precipitation: 0,
    windSpeed: 2.3,
    weatherCode: 1,
    soilTemperature: 26,
    soilMoisture: 24,
  };
  const todayRainProb = weather?.daily?.[0]?.precipitationProbMax ?? 10;
  const sunrise = weather?.todaySunrise || '06:25';
  const sunset = weather?.todaySunset || '17:15';
  const alerts = weather?.alerts || [];

  const activeAlertText =
    alerts.length > 0
      ? `${tAlerts(
          alerts[0].titleKey.replace('alerts.', '') as 'heatwaveTitle'
        )}. ${tAlerts(
          alerts[0].descKey.replace('alerts.', '') as 'heatwaveDesc'
        )}`
      : '';

  const cityLabel = placeName.split(',')[0].trim() || placeName;
  const spokenSummary =
    locale === 'ur'
      ? `آج ${cityLabel} میں درجہ حرارت ${current.temperature}°C ہے اور ہوا میں نمی ${current.humidity}% ہے۔ ہوا کی رفتار ${current.windSpeed} m/s ہے، مٹی کی تپش ${current.soilTemperature}°C ہے اور بارش کا امکان ${todayRainProb}% ہے۔ ${
          activeAlertText || 'آج سپرے اور کھیت کے معمول کے کاموں کے لیے موسم سازگار ہے۔'
        }`
      : `Today in ${cityLabel}, temperature is ${current.temperature}°C with ${current.humidity}% humidity. Wind speed is ${current.windSpeed} m/s and soil temperature is ${current.soilTemperature}°C. ${
          activeAlertText || 'Weather is favorable for normal farm work.'
        }`;

  if (loading && !weather) {
    return (
      <div className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/10 animate-pulse space-y-4">
        <div className="flex justify-between items-center">
          <div className="h-5 w-36 bg-olive/15 rounded-full" />
          <div className="h-10 w-20 bg-olive/15 rounded-2xl" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          <div className="h-16 bg-canvas rounded-tile" />
          <div className="h-16 bg-canvas rounded-tile" />
          <div className="h-16 bg-canvas rounded-tile" />
          <div className="h-16 bg-canvas rounded-tile" />
        </div>
        <div className="h-12 bg-canvas rounded-tile" />
      </div>
    );
  }

  const WeatherIcon =
    current.precipitation > 0 || todayRainProb >= 50
      ? CloudRain
      : current.weatherCode <= 1
      ? Sun
      : CloudSun;

  return (
    <div className="space-y-3">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/15"
      >
        {/* Top Row: Location & Big Temperature */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <button
              type="button"
              onClick={onChangeLocation}
              className="inline-flex items-center gap-1.5 text-start group min-h-[34px] max-w-full flex-wrap"
            >
              <MapPin className="w-4 h-4 text-olive flex-shrink-0" />
              <span className="font-extrabold text-ink text-sm sm:text-base group-hover:text-olive transition-colors truncate">
                {placeName}
              </span>
              {onChangeLocation && (
                <span className="text-[11px] font-bold text-olive underline">
                  ({tHome('changeLocation')})
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 text-[11px] text-ink/60">
              {weatherUnavailable ? (
                <span className="text-alert-amber font-bold">
                  {locale === 'ur'
                    ? 'آف لائن — تازہ موسم کے لیے انٹرنیٹ درکار ہے'
                    : 'Offline — live weather needs internet'}
                </span>
              ) : isOfflineCached ? (
                <span className="text-alert-amber font-bold">
                  {tHome('cachedOffline')}
                </span>
              ) : (
                <span>
                  {tHome('updatedAt')}{' '}
                  <bdi dir="ltr">
                    {weather?.updatedAt
                      ? new Date(weather.updatedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Now'}
                  </bdi>
                </span>
              )}
              {onRefresh && (
                <motion.button
                  type="button"
                  whileTap={{ rotate: 180, scale: 0.9 }}
                  onClick={onRefresh}
                  className="inline-flex items-center gap-1 text-olive hover:text-olive-dark p-1"
                  aria-label={tHome('refresh')}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </motion.button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-cream flex items-center justify-center text-wheat">
              <WeatherIcon className="w-6 h-6 sm:w-7 sm:h-7 stroke-[2.2px]" />
            </div>
            <bdi
              dir="ltr"
              className="text-3xl sm:text-4xl font-extrabold text-ink tracking-tight"
            >
              {current.temperature}°C
            </bdi>
          </div>
        </div>

        {/* 4 Stats Grid: 2x2 on narrow phones (< 400px), 4 cols on wider screens */}
        <div className="grid grid-cols-2 xs:grid-cols-4 sm:grid-cols-4 gap-2 mt-4">
          <div className="bg-canvas rounded-tile p-2.5 flex items-center sm:flex-col justify-between sm:justify-center text-start sm:text-center gap-2">
            <div className="flex items-center sm:flex-col gap-1.5 sm:gap-1">
              <Thermometer className="w-4 h-4 text-olive flex-shrink-0" />
              <span className="text-[11px] font-semibold text-ink/75 leading-tight">
                {tHome('soilTemp')}
              </span>
            </div>
            <bdi dir="ltr" className="font-extrabold text-xs sm:text-sm text-ink">
              {current.soilTemperature}°C
            </bdi>
          </div>

          <div className="bg-canvas rounded-tile p-2.5 flex items-center sm:flex-col justify-between sm:justify-center text-start sm:text-center gap-2">
            <div className="flex items-center sm:flex-col gap-1.5 sm:gap-1">
              <Droplets className="w-4 h-4 text-olive flex-shrink-0" />
              <span className="text-[11px] font-semibold text-ink/75 leading-tight">
                {tHome('humidity')}
              </span>
            </div>
            <bdi dir="ltr" className="font-extrabold text-xs sm:text-sm text-ink">
              {current.humidity}%
            </bdi>
          </div>

          <div className="bg-canvas rounded-tile p-2.5 flex items-center sm:flex-col justify-between sm:justify-center text-start sm:text-center gap-2">
            <div className="flex items-center sm:flex-col gap-1.5 sm:gap-1">
              <Wind className="w-4 h-4 text-wheat flex-shrink-0" />
              <span className="text-[11px] font-semibold text-ink/75 leading-tight">
                {tHome('wind')}
              </span>
            </div>
            <bdi dir="ltr" className="font-extrabold text-xs sm:text-sm text-ink">
              {current.windSpeed} m/s
            </bdi>
          </div>

          <div className="bg-canvas rounded-tile p-2.5 flex items-center sm:flex-col justify-between sm:justify-center text-start sm:text-center gap-2">
            <div className="flex items-center sm:flex-col gap-1.5 sm:gap-1">
              <CloudRain className="w-4 h-4 text-olive flex-shrink-0" />
              <span className="text-[11px] font-semibold text-ink/75 leading-tight">
                {tHome('rain')}
              </span>
            </div>
            <bdi dir="ltr" className="font-extrabold text-xs sm:text-sm text-ink">
              {todayRainProb}%
            </bdi>
          </div>
        </div>

        {/* Dotted Sun Arc with Sunrise and Sunset */}
        <div
          dir="ltr"
          className="mt-4 pt-3 border-t border-olive/10 flex items-center justify-between gap-2"
        >
          <div className="text-left">
            <span className="block text-[10px] text-ink/60">
              {tHome('sunrise')}
            </span>
            <span className="font-bold text-xs text-ink">{sunrise}</span>
          </div>

          <div className="flex-1 max-w-[160px] flex flex-col items-center">
            <svg
              viewBox="0 0 160 42"
              className="w-full h-8 overflow-visible"
              aria-hidden="true"
            >
              <path
                d="M 10 36 Q 80 -12 150 36"
                fill="none"
                stroke="#C8962E"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
              <circle cx="80" cy="12" r="6" fill="#E0A100" />
              <circle
                cx="80"
                cy="12"
                r="10"
                fill="#E0A100"
                fillOpacity="0.22"
              />
            </svg>
          </div>

          <div className="text-right">
            <span className="block text-[10px] text-ink/60">
              {tHome('sunset')}
            </span>
            <span className="font-bold text-xs text-ink">{sunset}</span>
          </div>
        </div>

        {/* Listen Button */}
        <div className="mt-3 pt-2 flex justify-end">
          <ReadAloudButton text={spokenSummary} />
        </div>
      </motion.div>

      {/* Amber / Red Alert Banner when an alert is active */}
      {alerts.map((alert, idx) => {
        const titleKey = alert.titleKey.replace(
          'alerts.',
          ''
        ) as 'heatwaveTitle';
        const descKey = alert.descKey.replace('alerts.', '') as 'heatwaveDesc';
        const isRed = alert.level === 'warning';

        return (
          <motion.div
            key={`${alert.type}-${idx}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`rounded-card p-3.5 sm:p-4 shadow-soft border flex items-start gap-3 ${
              isRed
                ? 'bg-alert-red/10 border-alert-red/35 text-ink'
                : 'bg-cream border-alert-amber/50 text-ink'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                isRed ? 'bg-alert-red text-white' : 'bg-alert-amber text-ink'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-bold text-xs sm:text-sm text-ink">
                  {tAlerts(titleKey)}
                </h3>
                <bdi
                  dir="ltr"
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isRed
                      ? 'bg-alert-red text-white'
                      : 'bg-alert-amber/25 text-ink'
                  }`}
                >
                  {alert.day}
                </bdi>
              </div>
              <p className="text-xs sm:text-sm text-ink/85 mt-1 leading-relaxed">
                {tAlerts(descKey)}
              </p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

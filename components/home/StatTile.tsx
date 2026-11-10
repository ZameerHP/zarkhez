'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Thermometer, Droplets, Wind, CloudRain, type LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/routing';
import {
  FLAGSHIP_SPRING,
  triggerHaptic,
  useCountUp,
  usePrefersReducedMotion,
} from './motion';

export type StatTileVariant = 'soilTemp' | 'humidity' | 'wind' | 'rain';

interface StatTileProps {
  variant: StatTileVariant;
  label: string;
  value: number;
  unit: string;
  index: number;
  decimals?: number;
  loading?: boolean;
}

function TileVisual({
  variant,
  value,
  reducedMotion,
}: {
  variant: StatTileVariant;
  value: number;
  reducedMotion: boolean;
}) {
  if (variant === 'humidity') {
    const levelPct = Math.max(12, Math.min(82, value));
    return (
      <div
        className="absolute inset-x-0 bottom-0 h-14 overflow-hidden pointer-events-none rounded-b-[20px]"
        aria-hidden="true"
      >
        <motion.div
          initial={reducedMotion ? undefined : { scaleY: 0.25, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          style={{ height: `${Math.round(levelPct * 0.52)}%` }}
          className="absolute inset-x-0 bottom-0 origin-bottom bg-gradient-to-t from-[#7DF0B0]/18 via-[#1F5A37]/24 to-[#7DF0B0]/08 border-t border-[#7DF0B0]/25"
        />
      </div>
    );
  }

  if (variant === 'wind') {
    const speedDuration = Math.max(1.8, Math.min(4.2, 5.2 - value * 0.35));
    return (
      <div
        dir="ltr"
        className="w-full h-5 overflow-hidden relative flex items-center pointer-events-none"
        aria-hidden="true"
      >
        <div className="w-full h-[1px] bg-white/10 rounded-full" />
        <motion.div
          animate={
            reducedMotion
              ? undefined
              : { x: ['-40%', '140%'] }
          }
          transition={{
            duration: speedDuration,
            repeat: Infinity,
            ease: 'linear',
          }}
          className="absolute left-0 w-10 h-[1.5px] rounded-full bg-gradient-to-r from-transparent via-[#D9B863] to-transparent will-change-transform"
        />
        <motion.div
          animate={
            reducedMotion
              ? undefined
              : { x: ['-50%', '150%'] }
          }
          transition={{
            duration: speedDuration * 1.25,
            delay: speedDuration * 0.45,
            repeat: Infinity,
            ease: 'linear',
          }}
          className="absolute left-0 top-3.5 w-7 h-[1px] rounded-full bg-gradient-to-r from-transparent via-[#7DF0B0]/70 to-transparent will-change-transform"
        />
      </div>
    );
  }

  if (variant === 'rain') {
    const radius = 12;
    const circumference = 2 * Math.PI * radius;
    const pct = Math.max(0, Math.min(100, value));
    const dashOffset = circumference - (pct / 100) * circumference;

    return (
      <div className="relative w-8 h-8 flex-shrink-0" aria-hidden="true">
        <svg viewBox="0 0 32 32" className="w-full h-full -rotate-90">
          <circle
            cx="16"
            cy="16"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="2"
          />
          <motion.circle
            cx="16"
            cy="16"
            r={radius}
            fill="none"
            stroke={pct >= 50 ? '#7DF0B0' : '#D9B863'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={
              reducedMotion
                ? { strokeDashoffset: dashOffset }
                : { strokeDashoffset: circumference }
            }
            animate={{ strokeDashoffset: dashOffset }}
            transition={{ duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
      </div>
    );
  }

  // soilTemp: sleek calibrated thermometer gradient track + marker dot
  const clampedPct = Math.max(8, Math.min(92, ((value - 5) / 40) * 100));
  return (
    <div dir="ltr" className="w-full pt-1 pointer-events-none" aria-hidden="true">
      <div className="relative h-1.5 w-full rounded-full bg-white/10 overflow-visible">
        <div
          className="h-full rounded-full opacity-80"
          style={{
            width: '100%',
            background:
              'linear-gradient(90deg, rgba(125,240,176,0.45) 0%, rgba(217,184,99,0.75) 58%, rgba(217,120,72,0.85) 100%)',
          }}
        />
        <motion.span
          initial={reducedMotion ? undefined : { left: '12%', opacity: 0 }}
          animate={{ left: `${clampedPct}%`, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#F6F3EA] ring-2 ring-[#D9B863] shadow-[0_0_10px_rgba(217,184,99,0.65)]"
        />
      </div>
    </div>
  );
}

const TILE_ICONS: Record<StatTileVariant, LucideIcon> = {
  soilTemp: Thermometer,
  humidity: Droplets,
  wind: Wind,
  rain: CloudRain,
};

export function StatTile({
  variant,
  label,
  value,
  unit,
  index,
  decimals = 0,
  loading = false,
}: StatTileProps) {
  const Icon = TILE_ICONS[variant];
  const reducedMotion = usePrefersReducedMotion();
  const animatedValue = useCountUp(value, 760, decimals, !loading);

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...FLAGSHIP_SPRING, delay: 0.18 + index * 0.07 }}
      whileTap={{ scale: 0.97 }}
    >
      <Link
        href="/weather"
        onClick={() => triggerHaptic(6)}
        className="relative overflow-hidden liquid-glass rounded-[20px] p-4 min-h-[120px] flex flex-col justify-between gap-2.5 group hover:bg-white/[0.11] transition-colors"
      >
        {/* Subtle dark readability scrim for WCAG AA */}
        <div
          className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[#07140D]/28 via-transparent to-[#07140D]/38"
          aria-hidden="true"
        />

        {variant === 'humidity' && (
          <TileVisual
            variant={variant}
            value={value}
            reducedMotion={reducedMotion}
          />
        )}

        {/* Top row: Icon + Label (+ optional ring for Rain) */}
        <div className="relative z-10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Icon
              className="w-4 h-4 text-[#D9B863] flex-shrink-0"
              strokeWidth={1.5}
            />
            <span className="text-[11px] font-medium text-[#F6F3EA]/76 truncate">
              {label}
            </span>
          </div>

          {variant === 'rain' && (
            <TileVisual
              variant={variant}
              value={value}
              reducedMotion={reducedMotion}
            />
          )}
        </div>

        {/* Bottom row: Count-up number + subtle visual */}
        <div className="relative z-10 space-y-2">
          <div className="flex items-baseline gap-1">
            {loading ? (
              <div className="relative overflow-hidden h-7 w-14 rounded-lg bg-white/[0.08] zrk-skeleton" />
            ) : (
              <>
                <bdi
                  dir="ltr"
                  className="text-[26px] leading-none font-medium tracking-tight text-[#F6F3EA] tabular-nums"
                >
                  {animatedValue}
                </bdi>
                <span className="text-xs font-normal text-[#F6F3EA]/65">
                  {unit}
                </span>
              </>
            )}
          </div>

          {(variant === 'wind' || variant === 'soilTemp') && (
            <TileVisual
              variant={variant}
              value={value}
              reducedMotion={reducedMotion}
            />
          )}
        </div>
      </Link>
    </motion.div>
  );
}

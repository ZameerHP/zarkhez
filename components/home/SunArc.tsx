'use client';

import React, { useEffect } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
} from 'framer-motion';
import { useTranslations } from 'next-intl';
import { getSunProgress, usePrefersReducedMotion } from './motion';

interface SunArcProps {
  sunrise: string;
  sunset: string;
  locale: 'ur' | 'en';
}

export function SunArc({ sunrise, sunset, locale }: SunArcProps) {
  const tHome = useTranslations('home');
  const reducedMotion = usePrefersReducedMotion();
  const { progress, isDaylight } = getSunProgress(sunrise, sunset);
  const isRtl = locale === 'ur';

  // Bezier control points in viewBox (0..360 x 0..56)
  // Start left=(18, 46), Peak=(180, -4), End right=(342, 46)
  // Mirror travel parameter `t` in RTL so sunrise begins on start (right visually)
  const targetT = isRtl ? 1 - progress : progress;
  const startT = isRtl ? 1 : 0;

  const animatedT = useMotionValue(reducedMotion ? targetT : startT);

  useEffect(() => {
    if (reducedMotion) {
      animatedT.set(targetT);
      return;
    }
    animatedT.set(startT);
    const controls = animate(animatedT, targetT, {
      duration: 1.15,
      delay: 0.18,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [targetT, startT, animatedT, reducedMotion]);

  const sunCx = useTransform(animatedT, (t) => {
    const u = 1 - t;
    return u * u * 18 + 2 * u * t * 180 + t * t * 342;
  });

  const sunCy = useTransform(animatedT, (t) => {
    const u = 1 - t;
    return u * u * 46 + 2 * u * t * -4 + t * t * 46;
  });

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.12 }}
      className="relative z-10 pt-1"
      aria-label={`${tHome('sunrise')} ${sunrise}, ${tHome('sunset')} ${sunset}`}
    >
      {/* Celestial Solar Arc */}
      <div className="relative w-full" dir="ltr">
        <svg
          viewBox="0 0 360 56"
          className="w-full h-14 overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="zrk-sun-arc-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#D9B863" stopOpacity="0.22" />
              <stop offset="50%" stopColor="#D9B863" stopOpacity="0.88" />
              <stop offset="100%" stopColor="#D9B863" stopOpacity="0.22" />
            </linearGradient>
            <radialGradient id="zrk-sun-dot-glow">
              <stop offset="0%" stopColor="#D9B863" stopOpacity="0.55" />
              <stop offset="60%" stopColor="#D9B863" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#D9B863" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Horizon hair-line */}
          <line
            x1="12"
            y1="46"
            x2="348"
            y2="46"
            stroke="rgba(246, 243, 234, 0.10)"
            strokeWidth="1"
          />

          {/* Faint base track */}
          <path
            d="M 18 46 Q 180 -4 342 46"
            fill="none"
            stroke="rgba(217, 184, 99, 0.16)"
            strokeWidth="1.25"
            strokeDasharray="3 4"
          />

          {/* Animated glowing gold arc */}
          <motion.path
            d={isRtl ? 'M 342 46 Q 180 -4 18 46' : 'M 18 46 Q 180 -4 342 46'}
            fill="none"
            stroke="url(#zrk-sun-arc-grad)"
            strokeWidth="1.6"
            strokeLinecap="round"
            initial={reducedMotion ? { pathLength: 1 } : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.05, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          />

          {/* Endpoints */}
          <circle cx="18" cy="46" r="2.2" fill="#D9B863" fillOpacity="0.45" />
          <circle cx="342" cy="46" r="2.2" fill="#D9B863" fillOpacity="0.45" />

          {/* Live animated sun dot along quadratic arc */}
          <motion.circle
            cx={sunCx}
            cy={sunCy}
            r={isDaylight ? 13 : 9}
            fill="url(#zrk-sun-dot-glow)"
          />
          <motion.circle
            cx={sunCx}
            cy={sunCy}
            r={isDaylight ? 4.8 : 3.6}
            fill={isDaylight ? '#F6F3EA' : '#D9B863'}
            stroke="#D9B863"
            strokeWidth="1.75"
          />
        </svg>
      </div>

      {/* Sunrise & Sunset Labels */}
      <div className="flex items-center justify-between -mt-1 px-0.5 text-[11px] text-[#F6F3EA]/65 zrk-text-scrim rounded-lg">
        <div className="flex items-center gap-1.5">
          <span>{tHome('sunrise')}</span>
          <bdi dir="ltr" className="text-[#F6F3EA]/88 font-medium tabular-nums">
            {sunrise}
          </bdi>
        </div>
        <div className="flex items-center gap-1.5">
          <span>{tHome('sunset')}</span>
          <bdi dir="ltr" className="text-[#F6F3EA]/88 font-medium tabular-nums">
            {sunset}
          </bdi>
        </div>
      </div>
    </motion.section>
  );
}

'use client';

import { useEffect, useState } from 'react';

export const FLAGSHIP_SPRING = {
  type: 'spring' as const,
  stiffness: 260,
  damping: 24,
  mass: 0.9,
};

export const PRESS_SPRING = {
  scale: 0.97,
};

export function triggerHaptic(duration = 8): void {
  if (typeof navigator === 'undefined') return;
  try {
    if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate(duration);
    }
  } catch {
    // ignore unsupported browsers
  }
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  return reduced;
}

export function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return cores <= 4 || mem <= 3;
}

export function useCountUp(
  target: number,
  durationMs = 720,
  decimals = 0,
  enabled = true
): string {
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState<number>(enabled ? 0 : target);

  useEffect(() => {
    if (!enabled || reducedMotion) {
      setDisplay(target);
      return;
    }

    let rafId = 0;
    const startTime = performance.now();
    const from = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      // Cubic ease-out for calm luxury deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (target - from) * eased;
      setDisplay(current);
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, durationMs, enabled, reducedMotion]);

  if (decimals > 0) {
    return (Math.round(display * Math.pow(10, decimals)) / Math.pow(10, decimals)).toFixed(decimals);
  }
  return String(Math.round(display));
}

export type TimePhase = 'dawn' | 'day' | 'sunset' | 'night';

export function parseTimeToMinutes(hhmm: string | undefined, fallbackMinutes: number): number {
  if (!hhmm || !/^\d{1,2}:\d{2}/.test(hhmm)) return fallbackMinutes;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallbackMinutes;
  return h * 60 + m;
}

export function getTimePhase(sunriseStr?: string, sunsetStr?: string, now = new Date()): TimePhase {
  const mins = now.getHours() * 60 + now.getMinutes();
  const sunrise = parseTimeToMinutes(sunriseStr, 6 * 60 + 25);
  const sunset = parseTimeToMinutes(sunsetStr, 17 * 60 + 35);

  if (mins >= sunrise - 50 && mins < sunrise + 85) {
    return 'dawn';
  }
  if (mins >= sunrise + 85 && mins < sunset - 75) {
    return 'day';
  }
  if (mins >= sunset - 75 && mins <= sunset + 50) {
    return 'sunset';
  }
  return 'night';
}

export function getSunProgress(sunriseStr?: string, sunsetStr?: string, now = new Date()): {
  progress: number;
  isDaylight: boolean;
} {
  const mins = now.getHours() * 60 + now.getMinutes();
  const sunrise = parseTimeToMinutes(sunriseStr, 6 * 60 + 25);
  const sunset = parseTimeToMinutes(sunsetStr, 17 * 60 + 35);
  const span = Math.max(60, sunset - sunrise);

  if (mins < sunrise) {
    return { progress: 0, isDaylight: false };
  }
  if (mins > sunset) {
    return { progress: 1, isDaylight: false };
  }
  return {
    progress: Math.max(0, Math.min(1, (mins - sunrise) / span)),
    isDaylight: true,
  };
}

export type WeatherScene = 'clear' | 'partlyCloudy' | 'cloudy' | 'rain' | 'storm' | 'fog';

export function getWeatherConditionMeta(
  weatherCode: number,
  locale: 'ur' | 'en',
  precipitation = 0,
  rainProb = 0
): { label: string; scene: WeatherScene } {
  if (weatherCode >= 95) {
    return {
      label: locale === 'ur' ? 'آندھی و بارش' : 'Thunderstorm',
      scene: 'storm',
    };
  }
  if ((weatherCode >= 51 && weatherCode <= 86) || precipitation > 0.2 || rainProb >= 70) {
    return {
      label: locale === 'ur' ? 'بارش' : 'Rain',
      scene: 'rain',
    };
  }
  if (weatherCode === 45 || weatherCode === 48) {
    return {
      label: locale === 'ur' ? 'دھند' : 'Misty',
      scene: 'fog',
    };
  }
  if (weatherCode === 3) {
    return {
      label: locale === 'ur' ? 'ابر آلود' : 'Overcast',
      scene: 'cloudy',
    };
  }
  if (weatherCode === 2) {
    return {
      label: locale === 'ur' ? 'ہلکے بادل' : 'Partly Cloudy',
      scene: 'partlyCloudy',
    };
  }
  if (weatherCode === 1) {
    return {
      label: locale === 'ur' ? 'زیادہ تر صاف' : 'Mostly Clear',
      scene: 'clear',
    };
  }
  return {
    label: locale === 'ur' ? 'صاف آسمان' : 'Clear Sky',
    scene: 'clear',
  };
}

export function getFirstName(fullName?: string, locale: 'ur' | 'en' = 'en'): string {
  const cleaned = (fullName || '').trim();
  if (!cleaned) {
    return locale === 'ur' ? 'کسان بھائی' : 'Farmer';
  }
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return tokens[0] || (locale === 'ur' ? 'کسان بھائی' : 'Farmer');
}

export function navigateWithSharedTransition(pushFn: (href: string) => void, href: string): void {
  if (typeof document !== 'undefined') {
    const docWithVT = document as Document & {
      startViewTransition?: (cb: () => void) => void;
    };
    if (typeof docWithVT.startViewTransition === 'function') {
      docWithVT.startViewTransition(() => pushFn(href));
      return;
    }
  }
  pushFn(href);
}

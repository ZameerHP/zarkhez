'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, useMotionValue, useScroll, useTransform } from 'framer-motion';
import {
  isLowEndDevice,
  TimePhase,
  usePrefersReducedMotion,
  WeatherScene,
} from './motion';

interface AmbientCanvasProps {
  phase: TimePhase;
  scene: WeatherScene;
}

const PHASE_BACKDROPS: Record<
  TimePhase,
  {
    baseGradient: string;
    primaryBloom: string;
    secondaryBloom: string;
  }
> = {
  dawn: {
    baseGradient:
      'linear-gradient(168deg, #07140D 0%, #0F2A1A 44%, #1A4B32 76%, #2D3D24 100%)',
    primaryBloom:
      'radial-gradient(ellipse 75% 55% at 78% 18%, rgba(217, 173, 86, 0.26) 0%, rgba(217, 173, 86, 0.06) 55%, transparent 100%)',
    secondaryBloom:
      'radial-gradient(circle at 18% 72%, rgba(31, 90, 55, 0.36) 0%, transparent 62%)',
  },
  day: {
    baseGradient:
      'linear-gradient(168deg, #07140D 0%, #0D2619 38%, #154434 72%, #19534B 100%)',
    primaryBloom:
      'radial-gradient(ellipse 72% 52% at 72% 16%, rgba(125, 240, 176, 0.16) 0%, rgba(31, 90, 55, 0.18) 52%, transparent 100%)',
    secondaryBloom:
      'radial-gradient(circle at 20% 76%, rgba(217, 184, 99, 0.12) 0%, transparent 60%)',
  },
  sunset: {
    baseGradient:
      'linear-gradient(168deg, #07140D 0%, #0E2718 42%, #23341F 74%, #3D2518 100%)',
    primaryBloom:
      'radial-gradient(ellipse 78% 58% at 76% 22%, rgba(204, 114, 62, 0.28) 0%, rgba(217, 184, 99, 0.11) 52%, transparent 100%)',
    secondaryBloom:
      'radial-gradient(circle at 16% 68%, rgba(15, 42, 26, 0.55) 0%, transparent 64%)',
  },
  night: {
    baseGradient:
      'linear-gradient(168deg, #050E09 0%, #07140D 42%, #0A1D1B 74%, #08182A 100%)',
    primaryBloom:
      'radial-gradient(ellipse 72% 52% at 76% 18%, rgba(92, 148, 194, 0.16) 0%, rgba(125, 240, 176, 0.06) 52%, transparent 100%)',
    secondaryBloom:
      'radial-gradient(circle at 18% 76%, rgba(15, 42, 26, 0.44) 0%, transparent 62%)',
  },
};

const PARTICLES = [
  { id: 1, x: '12%', y: '18%', size: 2.5, dx: 12, dy: -22, dur: 11, delay: 0 },
  { id: 2, x: '28%', y: '34%', size: 2, dx: -10, dy: -18, dur: 13, delay: 1.2 },
  { id: 3, x: '46%', y: '22%', size: 3, dx: 14, dy: -26, dur: 14, delay: 0.6 },
  { id: 4, x: '68%', y: '29%', size: 2, dx: -12, dy: -20, dur: 10, delay: 2.1 },
  { id: 5, x: '84%', y: '41%', size: 2.5, dx: -8, dy: -24, dur: 12.5, delay: 0.9 },
  { id: 6, x: '19%', y: '56%', size: 2, dx: 10, dy: -18, dur: 15, delay: 1.7 },
  { id: 7, x: '54%', y: '62%', size: 3, dx: -14, dy: -22, dur: 13.5, delay: 2.6 },
  { id: 8, x: '77%', y: '68%', size: 2, dx: 9, dy: -20, dur: 11.5, delay: 0.3 },
  { id: 9, x: '37%', y: '77%', size: 2.5, dx: 11, dy: -16, dur: 14.5, delay: 1.4 },
  { id: 10, x: '62%', y: '48%', size: 1.8, dx: -8, dy: -15, dur: 12, delay: 2.8 },
];

export function AmbientCanvas({ phase, scene }: AmbientCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [allowParticles, setAllowParticles] = useState(false);

  const { scrollY } = useScroll();
  const scrollParallaxY = useTransform(scrollY, [0, 320], [0, -22]);

  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);

  useEffect(() => {
    setAllowParticles(!reducedMotion && !isLowEndDevice());
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion || typeof window === 'undefined') return;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.gamma === null || event.beta === null) return;
      const clampedX = Math.max(-10, Math.min(10, event.gamma * 0.25));
      const clampedY = Math.max(-10, Math.min(10, (event.beta - 35) * 0.2));
      tiltX.set(clampedX);
      tiltY.set(clampedY);
    };

    window.addEventListener('deviceorientation', handleOrientation, { passive: true });
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [reducedMotion, tiltX, tiltY]);

  const palette = PHASE_BACKDROPS[phase];
  const conditionDim = useMemo(() => {
    if (scene === 'storm') return 'rgba(4, 10, 8, 0.32)';
    if (scene === 'rain' || scene === 'cloudy') return 'rgba(6, 16, 12, 0.18)';
    if (scene === 'fog') return 'rgba(210, 224, 214, 0.06)';
    return 'transparent';
  }, [scene]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.75, ease: 'easeOut' }}
      className="fixed inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      {/* Living weather-aware gradient mesh */}
      <div
        className="absolute inset-0 transition-all duration-1000"
        style={{ background: palette.baseGradient }}
      />

      {/* Atmospheric parallax blooms */}
      <motion.div
        style={
          reducedMotion
            ? undefined
            : { y: scrollParallaxY, x: tiltX, translateY: tiltY }
        }
        className="absolute -inset-6 will-change-transform"
      >
        <motion.div
          animate={
            reducedMotion
              ? undefined
              : {
                  scale: [1, 1.06, 1],
                  opacity: [0.85, 1, 0.85],
                }
          }
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 will-change-transform"
          style={{ background: palette.primaryBloom }}
        />
        <div
          className="absolute inset-0"
          style={{ background: palette.secondaryBloom }}
        />
      </motion.div>

      {/* Condition overcast/rain mood tint */}
      {conditionDim !== 'transparent' && (
        <div
          className="absolute inset-0 transition-colors duration-700"
          style={{ backgroundColor: conditionDim }}
        />
      )}

      {/* Faint floating pollen / dust motes (3-5% opacity) */}
      {allowParticles &&
        PARTICLES.map((p) => (
          <motion.span
            key={p.id}
            style={{
              left: p.x,
              top: p.y,
              width: p.size,
              height: p.size,
            }}
            animate={{
              x: [0, p.dx, 0],
              y: [0, p.dy, 0],
              opacity: [0.025, 0.05, 0.025],
            }}
            transition={{
              duration: p.dur,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: p.delay,
            }}
            className="absolute rounded-full bg-[#F6F3EA] will-change-transform"
          />
        ))}

      {/* Subtle 3% luxury tactile film-grain overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
        }}
      />
    </motion.div>
  );
}

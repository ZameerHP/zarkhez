'use client';

import React from 'react';
import { Home, CloudSun, ScanLine, Mic, BookOpen, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Link, usePathname } from '@/i18n/routing';
import { FLAGSHIP_SPRING, triggerHaptic } from './motion';

export function FloatingDock() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const items = [
    { key: 'home', href: '/home', label: t('home'), icon: Home },
    { key: 'weather', href: '/weather', label: t('weather'), icon: CloudSun },
    { key: 'scan', href: '/scan', label: t('scan'), icon: ScanLine, centerScan: true },
    { key: 'assistant', href: '/assistant', label: t('assistant'), icon: Mic },
    { key: 'diary', href: '/diary', label: t('diary'), icon: BookOpen },
    { key: 'profile', href: '/profile', label: t('profile'), icon: User },
  ];

  return (
    <nav
      aria-label="Primary Navigation"
      className="fixed bottom-0 inset-x-0 z-50 pointer-events-none flex justify-center px-4 pb-[calc(0.9rem+env(safe-area-inset-bottom))]"
    >
      <motion.div
        initial={{ y: 38, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...FLAGSHIP_SPRING, delay: 0.28 }}
        className="pointer-events-auto w-full max-w-[448px] liquid-glass-dock rounded-[28px] px-1.5 py-1.5 grid grid-cols-6 items-center gap-0.5"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          if (item.centerScan) {
            return (
              <Link
                key={item.key}
                href={item.href}
                prefetch={true}
                onClick={() => triggerHaptic(10)}
                aria-label={item.label}
                className="relative flex flex-col items-center justify-center min-h-[48px] group"
              >
                <motion.div
                  whileTap={{ scale: 0.94 }}
                  transition={FLAGSHIP_SPRING}
                  className="relative -mt-4 w-12 h-12 rounded-full bg-gradient-to-br from-[#EAD087] via-[#D9B863] to-[#B79039] text-[#07140D] flex items-center justify-center shadow-[0_8px_24px_rgba(217,184,99,0.45),inset_0_1px_0_rgba(255,255,255,0.55)] ring-1 ring-[#F6F3EA]/35"
                >
                  <Icon className="w-[21px] h-[21px]" strokeWidth={1.65} />
                </motion.div>
              </Link>
            );
          }

          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch={true}
              onClick={() => triggerHaptic(6)}
              aria-label={item.label}
              className={`relative flex flex-col items-center justify-center min-h-[48px] rounded-[20px] px-1 transition-colors ${
                isActive
                  ? 'text-[#F6F3EA]'
                  : 'text-[#F6F3EA]/60 hover:text-[#F6F3EA]/90'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="floating-dock-gold-capsule"
                  transition={FLAGSHIP_SPRING}
                  className="absolute inset-0.5 rounded-[18px] bg-[#D9B863]/16 border border-[#D9B863]/35 shadow-[0_0_18px_rgba(217,184,99,0.18)]"
                />
              )}

              <motion.div
                whileTap={{ scale: 0.94 }}
                transition={FLAGSHIP_SPRING}
                className="relative z-10 flex flex-col items-center justify-center"
              >
                <Icon
                  className={`w-[19px] h-[19px] transition-colors ${
                    isActive ? 'text-[#D9B863]' : 'text-current'
                  }`}
                  strokeWidth={1.5}
                  fill={isActive ? 'currentColor' : 'none'}
                  fillOpacity={isActive ? 0.16 : 0}
                />
                {isActive && (
                  <span className="text-[10px] font-medium tracking-wide text-[#F6F3EA] mt-0.5 leading-none truncate max-w-full">
                    {item.label}
                  </span>
                )}
              </motion.div>
            </Link>
          );
        })}
      </motion.div>
    </nav>
  );
}

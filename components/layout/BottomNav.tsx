'use client';

import React from 'react';
import {
  Home,
  CloudSun,
  Mic,
  BookOpen,
  ScanLine,
  UserCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Link, usePathname } from '@/i18n/routing';

export function BottomNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const items = [
    { key: 'home', href: '/home', label: t('home'), icon: Home },
    { key: 'weather', href: '/weather', label: t('weather'), icon: CloudSun },
    {
      key: 'scan',
      href: '/scan',
      label: t('scan'),
      icon: ScanLine,
      highlight: true,
    },
    { key: 'assistant', href: '/assistant', label: t('assistant'), icon: Mic },
    { key: 'diary', href: '/diary', label: t('diary'), icon: BookOpen },
    { key: 'profile', href: '/profile', label: t('profile'), icon: UserCheck },
  ];

  return (
    <nav
      aria-label="Primary Bottom Navigation"
      className="fixed bottom-0 inset-x-0 z-40 pointer-events-none flex justify-center px-1.5 min-[360px]:px-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="pointer-events-auto w-full max-w-[450px] bg-slate-900/95 backdrop-blur-lg text-white rounded-[24px] sm:rounded-[26px] p-1 sm:p-1.5 shadow-[0_14px_38px_rgba(15,23,42,0.35)] border border-teal-400/25 grid grid-cols-6 gap-0.5 items-center"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch={true}
              className={`relative flex flex-col items-center justify-center min-h-[48px] py-1 px-0.5 rounded-[20px] min-w-0 transition-colors ${
                isActive
                  ? 'text-white font-extrabold'
                  : 'text-slate-300/80 hover:text-white'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-active-pill"
                  transition={{
                    type: 'spring',
                    stiffness: 380,
                    damping: 30,
                  }}
                  className="absolute inset-0 rounded-[18px] bg-gradient-to-tr from-emerald-500/35 to-teal-400/30 border border-teal-300/45"
                />
              )}

              <motion.div
                whileTap={{ scale: 0.88 }}
                className={`relative z-10 flex items-center justify-center rounded-full transition-colors ${
                  item.highlight && !isActive
                    ? 'bg-emerald-500/25 p-1 text-emerald-300'
                    : ''
                }`}
              >
                <Icon
                  className={`w-[18px] h-[18px] min-[375px]:w-[19px] min-[375px]:h-[19px] ${
                    isActive
                      ? 'stroke-[2.5px] text-teal-300'
                      : 'stroke-[2px]'
                  }`}
                />
              </motion.div>
              <span className="relative z-10 text-[9px] min-[360px]:text-[10px] sm:text-[11px] mt-0.5 leading-tight truncate max-w-full px-0.5">
                {item.label}
              </span>
            </Link>
          );
        })}
      </motion.div>
    </nav>
  );
}

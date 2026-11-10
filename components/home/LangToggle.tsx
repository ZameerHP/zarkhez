'use client';

import React from 'react';
import { useLocale } from 'next-intl';
import { motion } from 'framer-motion';
import { usePathname, useRouter } from '@/i18n/routing';
import { FLAGSHIP_SPRING, triggerHaptic } from './motion';

export function LangToggle() {
  const locale = useLocale() as 'ur' | 'en';
  const pathname = usePathname();
  const router = useRouter();

  const switchTo = (nextLocale: 'ur' | 'en') => {
    if (nextLocale === locale) return;
    triggerHaptic(8);
    router.replace(pathname, { locale: nextLocale });
  };

  const options: Array<{ code: 'ur' | 'en'; label: string }> = [
    { code: 'ur', label: 'اردو' },
    { code: 'en', label: 'English' },
  ];

  return (
    <div
      className="relative inline-flex items-center p-1 rounded-full liquid-glass min-h-[44px]"
      role="group"
      aria-label="Language Switcher"
    >
      {options.map((opt) => {
        const active = locale === opt.code;
        return (
          <motion.button
            key={opt.code}
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => switchTo(opt.code)}
            className={`relative z-10 min-h-[36px] px-3 rounded-full text-xs font-medium tracking-wide transition-colors ${
              active ? 'text-[#F6F3EA]' : 'text-[#F6F3EA]/65 hover:text-[#F6F3EA]/90'
            }`}
            aria-pressed={active}
          >
            {active && (
              <motion.span
                layoutId="home-lang-gold-pill"
                transition={FLAGSHIP_SPRING}
                className="absolute inset-0 rounded-full bg-[#D9B863]/22 border border-[#D9B863]/45 shadow-[0_0_16px_rgba(217,184,99,0.2)]"
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

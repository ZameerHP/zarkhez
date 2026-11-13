'use client';

import React from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { Globe } from 'lucide-react';

interface LanguageToggleProps {
  variant?: 'glass' | 'solid';
}

export function LanguageToggle({ variant = 'glass' }: LanguageToggleProps) {
  const locale = useLocale() as 'ur' | 'en';
  const pathname = usePathname();
  const router = useRouter();

  const switchTo = (nextLocale: 'ur' | 'en') => {
    if (nextLocale === locale) return;
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <div
      className={`inline-flex items-center p-0.5 sm:p-1 rounded-full min-h-[44px] flex-shrink-0 ${
        variant === 'glass'
          ? 'glass text-white'
          : 'bg-white border border-olive/20 shadow-soft text-ink'
      }`}
      role="group"
      aria-label="Language Switcher"
    >
      <Globe className="hidden min-[375px]:block w-3.5 h-3.5 sm:w-4 sm:h-4 ms-2 me-1 opacity-75 flex-shrink-0" />
      <button
        type="button"
        onClick={() => switchTo('ur')}
        className={`min-h-[38px] px-2.5 min-[375px]:px-3.5 py-1 rounded-full text-xs min-[375px]:text-sm font-bold whitespace-nowrap transition-all ${
          locale === 'ur'
            ? 'bg-olive text-white shadow-sm'
            : variant === 'glass'
            ? 'text-white/85 hover:text-white'
            : 'text-ink/70 hover:text-ink'
        }`}
      >
        اردو
      </button>
      <button
        type="button"
        onClick={() => switchTo('en')}
        className={`min-h-[38px] px-2.5 min-[375px]:px-3.5 py-1 rounded-full text-xs min-[375px]:text-sm font-bold whitespace-nowrap transition-all ${
          locale === 'en'
            ? 'bg-olive text-white shadow-sm'
            : variant === 'glass'
            ? 'text-white/85 hover:text-white'
            : 'text-ink/70 hover:text-ink'
        }`}
      >
        English
      </button>
    </div>
  );
}

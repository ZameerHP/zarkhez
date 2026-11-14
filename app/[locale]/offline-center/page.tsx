'use client';

import React from 'react';
import { useLocale } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { OfflineCenterCard } from '@/components/offline/OfflineCenterCard';

export default function OfflineCenterPage() {
  const locale = useLocale() as 'en' | 'ur';

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas overflow-x-hidden">
      <header className="bg-gradient-to-b from-[#062409] to-olive-dark text-white rounded-b-[28px] px-4 sm:px-5 pt-4 pb-6 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Link
              href="/home"
              className="w-10 h-10 rounded-full glass flex items-center justify-center text-white"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </Link>
            <ZarkhezLogo size={32} lightText showText={false} />
          </div>
          <LanguageToggle variant="glass" />
        </div>

        <div className="mt-3.5">
          <h1 className="font-extrabold text-xl text-white">
            {locale === 'ur'
              ? 'آف لائن سینٹر اور ڈاؤن لوڈز'
              : 'Offline Center & Model Manager'}
          </h1>
          <p className="text-xs text-cream/90 mt-0.5">
            {locale === 'ur'
              ? 'بغیر انٹرنیٹ زرعی گائیڈز، پودے اسکین ماڈل اور کلاؤڈ سنک کا انتظام'
              : 'Prepare offline crop guides, verified schemes, ONNX leaf model & cloud sync'}
          </p>
        </div>
      </header>

      <main className="px-3.5 sm:px-5 mt-4 max-w-md mx-auto">
        <OfflineCenterCard />
      </main>

      <BottomNav />
    </div>
  );
}

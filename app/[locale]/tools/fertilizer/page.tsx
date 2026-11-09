'use client';

import React, { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Sprout, Scale, BookOpenCheck } from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';
import { getAllCrops } from '@/lib/calendar';
import { calculateFertilizer, SoilType } from '@/lib/fertilizer';

/**
 * Fertilizer Calculator Screen (Section 9.5 & Section 11.2 of SPEC.md):
 * - Simple form with big numeric inputs and a result card with large green numbers.
 * - Uses verified rate table (data/fertilizer-rates.json) and always shows its source.
 */
export default function FertilizerToolPage() {
  const t = useTranslations('tools');
  const locale = useLocale() as 'ur' | 'en';
  const searchParams = useSearchParams();

  const crops = getAllCrops();
  const [cropKey, setCropKey] = useState('wheat');
  const [soil, setSoil] = useState<SoilType>('medium');
  const [acresInput, setAcresInput] = useState('3');

  useEffect(() => {
    const qCrop = searchParams.get('crop');
    if (qCrop && crops.some((c) => c.key === qCrop)) {
      setCropKey(qCrop);
    }
  }, [searchParams, crops]);

  const areaAcres = Math.max(0, parseFloat(acresInput) || 0);
  const result = calculateFertilizer(cropKey, soil, areaAcres);
  const currentCrop = crops.find((c) => c.key === cropKey) || crops[0];

  const spokenText = `${currentCrop.name[locale]} (${areaAcres} acres). ${result.items
    .map((it) => `${it.product}: ${it.totalKg} kg (${it.bags50Kg} bags)`)
    .join('. ')}. ${t('sourceLabel')} ${result.source}`;

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas">
      <header className="bg-gradient-to-b from-[#062409] to-olive-dark text-white rounded-b-[32px] px-4 sm:px-5 pt-4 pb-7 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Link
              href="/home"
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full glass flex items-center justify-center text-white"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </Link>
            <ZarkhezLogo size={34} lightText showText={false} />
          </div>
          <LanguageToggle variant="glass" />
        </div>

        <div className="mt-4">
          <h1 className="font-extrabold text-2xl text-white">
            {t('fertilizerTitle')}
          </h1>
          <p className="text-xs text-cream mt-0.5">{t('fertilizerSub')}</p>
        </div>
      </header>

      <main className="px-5 mt-5 space-y-5">
        {/* Form Inputs */}
        <section className="bg-white rounded-card p-5 shadow-soft border border-olive/10 space-y-4">
          <div>
            <label className="block text-xs font-bold text-ink/75 mb-1.5">
              {t('selectCrop')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {crops.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCropKey(c.key)}
                  className={`min-h-[48px] rounded-tile font-bold text-sm transition-all ${
                    cropKey === c.key
                      ? 'bg-olive text-white shadow-sm'
                      : 'bg-canvas text-ink hover:bg-olive/15'
                  }`}
                >
                  {c.name[locale]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink/75 mb-1.5">
              {t('soilType')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['poor', 'medium', 'fertile'] as SoilType[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSoil(s)}
                  className={`min-h-[48px] px-2 rounded-tile font-bold text-xs transition-all ${
                    soil === s
                      ? 'bg-wheat text-white shadow-sm'
                      : 'bg-canvas text-ink hover:bg-cream'
                  }`}
                >
                  {s === 'poor'
                    ? t('soilPoor')
                    : s === 'medium'
                    ? t('soilMedium')
                    : t('soilFertile')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink/75 mb-1.5">
              {t('landSize')}
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={acresInput}
              onChange={(e) => setAcresInput(e.target.value)}
              className="w-full min-h-[56px] px-4 rounded-tile bg-canvas border-2 border-olive/30 font-extrabold text-2xl text-ink focus:outline-none focus:border-olive"
            />
          </div>
        </section>

        {/* Result Card with Large Green Numbers (Section 11.2) */}
        <section className="bg-white rounded-card p-5 shadow-soft border border-olive/15 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-extrabold text-lg text-ink flex items-center gap-2">
              <Sprout className="w-5 h-5 text-olive" />
              <span>{t('totalForAcres', { acres: areaAcres })}</span>
            </h2>
            <ReadAloudButton text={spokenText} />
          </div>

          <div className="space-y-3">
            {result.items.map((item) => (
              <div
                key={item.product}
                className="bg-canvas rounded-card p-4 border border-olive/10 flex items-center justify-between gap-3"
              >
                <div>
                  <span className="font-extrabold text-base text-ink block">
                    {item.product}
                  </span>
                  <span className="text-xs text-ink/65 inline-flex items-center gap-1 mt-0.5">
                    <Scale className="w-3.5 h-3.5 text-olive" />
                    {t('perAcre')}:{' '}
                    <bdi dir="ltr" className="font-bold text-ink">
                      {item.kgPerAcre} kg
                    </bdi>
                  </span>
                </div>

                <div className="text-end">
                  <bdi
                    dir="ltr"
                    className="block font-extrabold text-2xl text-olive-dark"
                  >
                    {item.totalKg} kg
                  </bdi>
                  <bdi
                    dir="ltr"
                    className="text-xs font-bold text-wheat block"
                  >
                    {t('bagsNote', { bags: item.bags50Kg })}
                  </bdi>
                </div>
              </div>
            ))}
          </div>

          {/* Verified Agronomy Source Citation (Section 4 & 9.5) */}
          <div className="bg-cream/65 rounded-tile p-3.5 flex items-start gap-2.5 text-xs text-ink/80">
            <BookOpenCheck className="w-4 h-4 text-olive-dark flex-shrink-0 mt-0.5" />
            <div>
              <strong>{t('sourceLabel')}</strong> {result.source}
            </div>
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

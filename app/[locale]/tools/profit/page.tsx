'use client';

import React, { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Calculator, TrendingUp, Sliders } from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';
import { getAllCrops } from '@/lib/calendar';
import { calculateProfit } from '@/lib/profit';

/**
 * Profit Calculator Screen (Section 9.5 & Section 11.2 of SPEC.md):
 * - Costs and expected income give profit per acre, with a what-if price slider (-30% to +30%).
 * - Updates live; handles empty inputs gracefully.
 * - Clearly labels market prices as manual sample data (Section 4).
 */
export default function ProfitToolPage() {
  const t = useTranslations('tools');
  const locale = useLocale() as 'ur' | 'en';
  const searchParams = useSearchParams();

  const crops = getAllCrops();
  const [cropKey, setCropKey] = useState('wheat');
  const [acresStr, setAcresStr] = useState('2');
  const [yieldStr, setYieldStr] = useState('42');
  const [priceStr, setPriceStr] = useState('3900');
  const [sliderPct, setSliderPct] = useState(0);

  const [costSeed, setCostSeed] = useState('11000');
  const [costFert, setCostFert] = useState('34000');
  const [costIrr, setCostIrr] = useState('16000');
  const [costSpray, setCostSpray] = useState('6500');
  const [costLabor, setCostLabor] = useState('22500');

  const applyCropPreset = (key: string) => {
    setCropKey(key);
    const found = crops.find((c) => c.key === key);
    if (!found) return;
    setYieldStr(String(found.sampleYieldMannPerAcre));
    setPriceStr(String(found.samplePricePerMannPkr));
    setCostSeed(String(found.sampleCostsPkr.seed));
    setCostFert(String(found.sampleCostsPkr.fertilizer));
    setCostIrr(String(found.sampleCostsPkr.irrigation));
    setCostSpray(String(found.sampleCostsPkr.spray));
    setCostLabor(String(found.sampleCostsPkr.laborAndHarvest));
    setSliderPct(0);
  };

  useEffect(() => {
    const qCrop = searchParams.get('crop');
    if (qCrop && crops.some((c) => c.key === qCrop)) {
      applyCropPreset(qCrop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const result = calculateProfit({
    areaAcres: parseFloat(acresStr) || 0,
    yieldPerAcre: parseFloat(yieldStr) || 0,
    basePricePerUnit: parseFloat(priceStr) || 0,
    priceSliderPercent: sliderPct,
    costsPerAcre: {
      seed: parseFloat(costSeed) || 0,
      fertilizer: parseFloat(costFert) || 0,
      irrigation: parseFloat(costIrr) || 0,
      spray: parseFloat(costSpray) || 0,
      laborAndHarvest: parseFloat(costLabor) || 0,
    },
  });

  const spokenText = `${t('profitPerAcre')}: ${result.profitPerAcre} PKR. ${t(
    'netProfit'
  )}: ${result.totalNetProfit} PKR.`;

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
            {t('profitTitle')}
          </h1>
          <p className="text-xs text-cream mt-0.5">{t('profitSub')}</p>
        </div>
      </header>

      <main className="px-5 mt-5 space-y-5">
        {/* Live Profit Result Card with Large Green Numbers */}
        <section className="bg-white rounded-card p-5 shadow-soft border-2 border-olive space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-xs font-bold text-ink/65 block">
                {t('netProfit')} ({result.areaAcres} Acres)
              </span>
              <bdi
                dir="ltr"
                className={`block font-extrabold text-3xl mt-0.5 ${
                  result.totalNetProfit >= 0
                    ? 'text-olive-dark'
                    : 'text-alert-red'
                }`}
              >
                Rs. {result.totalNetProfit.toLocaleString()}
              </bdi>
            </div>
            <ReadAloudButton text={spokenText} />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-olive/10 text-center">
            <div className="bg-canvas rounded-tile p-2.5">
              <span className="block text-[11px] text-ink/65">
                {t('profitPerAcre')}
              </span>
              <bdi
                dir="ltr"
                className="font-extrabold text-sm text-olive-dark"
              >
                Rs. {result.profitPerAcre.toLocaleString()}
              </bdi>
            </div>
            <div className="bg-canvas rounded-tile p-2.5">
              <span className="block text-[11px] text-ink/65">
                {t('grossIncome')}
              </span>
              <bdi dir="ltr" className="font-bold text-sm text-ink">
                Rs. {result.totalGrossIncome.toLocaleString()}
              </bdi>
            </div>
            <div className="bg-canvas rounded-tile p-2.5">
              <span className="block text-[11px] text-ink/65">
                {t('totalCost')}
              </span>
              <bdi dir="ltr" className="font-bold text-sm text-wheat">
                Rs. {result.totalCost.toLocaleString()}
              </bdi>
            </div>
          </div>

          {/* What-if Market Price Slider (-30% to +30%) */}
          <div className="bg-cream/65 rounded-tile p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="inline-flex items-center gap-1.5 text-ink">
                <Sliders className="w-4 h-4 text-wheat" />
                {t('whatIfSlider')}
              </span>
              <bdi dir="ltr" className="text-olive-dark font-extrabold text-sm">
                {sliderPct > 0 ? `+${sliderPct}%` : `${sliderPct}%`} (Rs.{' '}
                {result.effectivePricePerUnit}/Mann)
              </bdi>
            </div>
            <input
              type="range"
              min={-30}
              max={30}
              step={5}
              value={sliderPct}
              onChange={(e) => setSliderPct(Number(e.target.value))}
              className="w-full accent-olive h-2 bg-white rounded-lg cursor-pointer"
            />
          </div>
        </section>

        {/* Crop, Land & Yield Inputs */}
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
                  onClick={() => applyCropPreset(c.key)}
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

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {t('landSize')}
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={acresStr}
                onChange={(e) => setAcresStr(e.target.value)}
                className="w-full min-h-[50px] px-3 rounded-tile bg-canvas border border-olive/25 font-extrabold text-lg text-ink"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {t('expectedYield')}
              </label>
              <input
                type="number"
                min="0"
                value={yieldStr}
                onChange={(e) => setYieldStr(e.target.value)}
                className="w-full min-h-[50px] px-3 rounded-tile bg-canvas border border-olive/25 font-extrabold text-lg text-ink"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {t('marketPrice')}
              </label>
              <input
                type="number"
                min="0"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                className="w-full min-h-[50px] px-3 rounded-tile bg-canvas border border-olive/25 font-extrabold text-lg text-ink"
              />
            </div>
          </div>

          <p className="text-xs text-wheat font-semibold">
            * {t('samplePriceDisclaimer')}
          </p>

          {/* Costs per Acre Breakdown */}
          <div className="pt-3 border-t border-olive/10 space-y-3">
            <h3 className="font-extrabold text-sm text-ink flex items-center gap-2">
              <Calculator className="w-4 h-4 text-olive" />
              <span>{t('costsHeading')}</span>
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-ink/70 mb-1">
                  {t('costSeed')}
                </label>
                <input
                  type="number"
                  min="0"
                  value={costSeed}
                  onChange={(e) => setCostSeed(e.target.value)}
                  className="w-full min-h-[48px] px-3 rounded-tile bg-canvas border border-olive/20 font-bold text-base"
                />
              </div>

              <div>
                <label className="block text-xs text-ink/70 mb-1">
                  {t('costFertilizer')}
                </label>
                <input
                  type="number"
                  min="0"
                  value={costFert}
                  onChange={(e) => setCostFert(e.target.value)}
                  className="w-full min-h-[48px] px-3 rounded-tile bg-canvas border border-olive/20 font-bold text-base"
                />
              </div>

              <div>
                <label className="block text-xs text-ink/70 mb-1">
                  {t('costIrrigation')}
                </label>
                <input
                  type="number"
                  min="0"
                  value={costIrr}
                  onChange={(e) => setCostIrr(e.target.value)}
                  className="w-full min-h-[48px] px-3 rounded-tile bg-canvas border border-olive/20 font-bold text-base"
                />
              </div>

              <div>
                <label className="block text-xs text-ink/70 mb-1">
                  {t('costSpray')}
                </label>
                <input
                  type="number"
                  min="0"
                  value={costSpray}
                  onChange={(e) => setCostSpray(e.target.value)}
                  className="w-full min-h-[48px] px-3 rounded-tile bg-canvas border border-olive/20 font-bold text-base"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs text-ink/70 mb-1">
                  {t('costLabor')}
                </label>
                <input
                  type="number"
                  min="0"
                  value={costLabor}
                  onChange={(e) => setCostLabor(e.target.value)}
                  className="w-full min-h-[48px] px-3 rounded-tile bg-canvas border border-olive/20 font-bold text-base"
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Sprout, Scale, BookOpenCheck, Clock3, BookmarkPlus, Trash2 } from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';
import { getAllCrops } from '@/lib/calendar';
import { calculateFertilizer, SoilType } from '@/lib/fertilizer';
import {
  deleteFertilizerHistoryItem,
  getFertilizerRecommendationHistory,
  getOfflineFertilizerSchedule,
  saveFertilizerRecommendationHistory,
} from '@/lib/offline/fertilizer-guide';
import type { FertilizerHistoryRecord } from '@/lib/offline/db';

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
  const [savedHistory, setSavedHistory] = useState<FertilizerHistoryRecord[]>([]);
  const [planSavedToast, setPlanSavedToast] = useState(false);

  useEffect(() => {
    const qCrop = searchParams.get('crop');
    if (qCrop && crops.some((c) => c.key === qCrop)) {
      setCropKey(qCrop);
    }
  }, [searchParams, crops]);

  useEffect(() => {
    getFertilizerRecommendationHistory()
      .then(setSavedHistory)
      .catch(() => undefined);
  }, []);

  const areaAcres = Math.max(0, parseFloat(acresInput) || 0);
  const result = calculateFertilizer(cropKey, soil, areaAcres);
  const currentCrop = crops.find((c) => c.key === cropKey) || crops[0];
  const stageSchedule = getOfflineFertilizerSchedule(cropKey);

  const handleSaveOfflinePlan = async () => {
    const saved = await saveFertilizerRecommendationHistory(
      result,
      currentCrop.name.en,
      currentCrop.name.ur
    );
    if (saved) {
      setPlanSavedToast(true);
      setTimeout(() => setPlanSavedToast(false), 2500);
      const refreshed = await getFertilizerRecommendationHistory();
      setSavedHistory(refreshed);
    }
  };

  const handleDeleteHistory = async (id: string) => {
    await deleteFertilizerHistoryItem(id);
    const refreshed = await getFertilizerRecommendationHistory();
    setSavedHistory(refreshed);
  };

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

      <main className="px-3.5 min-[375px]:px-5 mt-4 sm:mt-5 space-y-4 sm:space-y-5">
        {/* Form Inputs */}
        <section className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/10 space-y-4">
          <div>
            <label className="block text-xs font-bold text-ink/75 mb-1.5">
              {t('selectCrop')}
            </label>
            <div className="grid grid-cols-2 min-[380px]:grid-cols-3 gap-2">
              {crops.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCropKey(c.key)}
                  className={`min-h-[48px] px-2 rounded-tile font-bold text-xs sm:text-sm transition-all ${
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
        <section className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/15 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-extrabold text-base sm:text-lg text-ink flex items-center gap-2 min-w-0">
              <Sprout className="w-5 h-5 text-olive flex-shrink-0" />
              <span>{t('totalForAcres', { acres: areaAcres })}</span>
            </h2>
            <ReadAloudButton text={spokenText} />
          </div>

          <div className="space-y-3">
            {result.items.map((item) => (
              <div
                key={item.product}
                className="bg-canvas rounded-card p-3.5 sm:p-4 border border-olive/10 flex items-center justify-between flex-wrap gap-2.5"
              >
                <div className="min-w-0">
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

          <button
            type="button"
            onClick={handleSaveOfflinePlan}
            className="w-full min-h-[46px] rounded-full bg-olive text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-soft hover:bg-olive-dark transition-all"
          >
            <BookmarkPlus className="w-4 h-4" />
            <span>
              {planSavedToast
                ? locale === 'ur'
                  ? 'آف لائن محفوظ ہو گیا!'
                  : 'Saved Offline!'
                : locale === 'ur'
                ? 'یہ پلان آف لائن محفوظ کریں'
                : 'Save Plan Offline'}
            </span>
          </button>
        </section>

        {/* Offline Growth Stages, Split Schedule & Nutrient Roles */}
        <section className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/10 space-y-3.5">
          <div className="flex items-center gap-2">
            <Clock3 className="w-4 h-4 text-olive-dark flex-shrink-0" />
            <h2 className="font-extrabold text-sm sm:text-base text-ink">
              {locale === 'ur'
                ? 'فصل کے مراحل اور قسطوں میں کھاد شیڈول (آف لائن گائیڈ)'
                : 'Growth-Stage Split Schedule (Offline Guide)'}
            </h2>
          </div>

          <p className="text-[11px] text-ink/70 bg-canvas rounded-tile p-3 leading-relaxed border border-olive/10">
            <strong className="text-ink">
              {locale === 'ur' ? 'حسابی مفروضہ: ' : 'Assumptions: '}
            </strong>
            {stageSchedule.assumptions[locale]}
          </p>

          <div className="space-y-2.5">
            {stageSchedule.stages.map((st, idx) => (
              <div
                key={idx}
                className="rounded-tile bg-canvas p-3 border border-olive/10 space-y-1"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-extrabold text-xs text-olive-dark">
                    {locale === 'ur' ? st.stageUr : st.stageEn}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cream text-ink/75">
                    {locale === 'ur' ? st.timingUr : st.timingEn}
                  </span>
                </div>
                <p className="text-xs text-ink/80 leading-relaxed">
                  {locale === 'ur' ? st.guidanceUr : st.guidanceEn}
                </p>
              </div>
            ))}
          </div>

          <div className="pt-1 space-y-2">
            <h3 className="font-bold text-xs text-ink/75">
              {locale === 'ur' ? 'اہم غذائی اجزاء کا کردار' : 'Nutrient Role Summary'}
            </h3>
            {stageSchedule.nutrientNotes.map((n, idx) => (
              <div key={idx} className="text-xs bg-emerald-50/60 border border-olive/10 rounded-xl p-2.5">
                <span className="font-extrabold text-olive-dark">{n.nutrient}: </span>
                <span className="text-ink/80">{locale === 'ur' ? n.ur : n.en}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Saved Offline Fertilizer History */}
        {savedHistory.length > 0 && (
          <section className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/10 space-y-3">
            <h2 className="font-extrabold text-sm text-ink">
              {locale === 'ur'
                ? 'آف لائن محفوظ شدہ کھاد پلانز'
                : 'Saved Offline Fertilizer Plans'}
            </h2>
            <div className="space-y-2">
              {savedHistory.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="bg-canvas rounded-tile p-3 border border-olive/10 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-extrabold text-xs text-ink truncate">
                      {locale === 'ur' ? item.cropNameUr : item.cropNameEn} •{' '}
                      <bdi dir="ltr">{item.areaAcres} acres</bdi> ({item.soil})
                    </p>
                    <p className="text-[11px] text-ink/65 truncate mt-0.5">
                      {item.items.map((x) => `${x.product}: ${x.totalKg} kg`).join(' | ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteHistory(item.id)}
                    aria-label="Delete saved plan"
                    className="w-8 h-8 rounded-full bg-white text-alert-red/80 hover:bg-alert-red/10 flex items-center justify-center flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

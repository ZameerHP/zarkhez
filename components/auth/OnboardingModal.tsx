'use client';

import React, { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Check,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { saveOnboardingProfile } from '@/lib/supabase/client';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip: () => void;
  initialDistrict?: { name: string; ur: string; lat: number; lon: number };
}

const DISTRICT_CHIPS = [
  { name: 'Faisalabad, Punjab', ur: 'فیصل آباد، پنجاب', lat: 31.418, lon: 73.079 },
  { name: 'Sahiwal, Punjab', ur: 'ساہیوال، پنجاب', lat: 30.6682, lon: 73.1114 },
  { name: 'Lahore, Punjab', ur: 'لاہور، پنجاب', lat: 31.5204, lon: 74.3587 },
  { name: 'Sargodha, Punjab', ur: 'سرگودھا، پنجاب', lat: 32.0836, lon: 72.6711 },
  { name: 'Gujranwala, Punjab', ur: 'گوجرانوالہ، پنجاب', lat: 32.1877, lon: 74.1945 },
  { name: 'Rahim Yar Khan, Punjab', ur: 'رحیم یار خان، پنجاب', lat: 28.4202, lon: 70.3013 },
  { name: 'Bahawalpur, Punjab', ur: 'بہاولپور، پنجاب', lat: 29.3956, lon: 71.6836 },
  { name: 'Multan, Punjab', ur: 'ملتان، پنجاب', lat: 30.1575, lon: 71.5249 },
  { name: 'Hyderabad, Sindh', ur: 'حیدرآباد، سندھ', lat: 25.396, lon: 68.3578 },
  { name: 'Mirpur Khas, Sindh', ur: 'میرپور خاص، سندھ', lat: 25.5276, lon: 69.0126 },
  { name: 'Mardan, KPK', ur: 'مردان، کے پی کے', lat: 34.1986, lon: 72.0404 },
  { name: 'Swat, KPK', ur: 'سوات، کے پی کے', lat: 35.2227, lon: 72.4258 },
];

const CROPS = [
  { key: 'wheat', en: 'Wheat', ur: 'گندم' },
  { key: 'cotton', en: 'Cotton', ur: 'کپاس' },
  { key: 'rice', en: 'Rice', ur: 'دھان (چاول)' },
  { key: 'sugarcane', en: 'Sugarcane', ur: 'کماد (گنا)' },
  { key: 'maize', en: 'Maize', ur: 'مکئی' },
  { key: 'vegetables', en: 'Vegetables', ur: 'سبزیاں و باغات' },
];

const LAND_BANDS = [
  { key: '1-5', en: '1 - 5 Acres (Small)', ur: '1 تا 5 ایکڑ (چھوٹا فارم)' },
  { key: '5-12', en: '5 - 12 Acres (Medium)', ur: '5 تا 12 ایکڑ (درمیانہ)' },
  { key: '12-25', en: '12 - 25 Acres', ur: '12 تا 25 ایکڑ' },
  { key: '25+', en: '25+ Acres (Large)', ur: '25 ایکڑ سے زیادہ' },
];

export function OnboardingModal({
  isOpen,
  onComplete,
  onSkip,
  initialDistrict,
}: OnboardingModalProps) {
  const t = useTranslations('auth');
  const locale = useLocale() as 'ur' | 'en';

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedLang, setSelectedLang] = useState<'ur' | 'en'>(locale);
  const [selectedDistrict, setSelectedDistrict] = useState(
    initialDistrict || DISTRICT_CHIPS[0]
  );
  const [selectedCrops, setSelectedCrops] = useState<string[]>(['wheat']);
  const [selectedLandBand, setSelectedLandBand] = useState('1-5');
  const [consentImproveModel, setConsentImproveModel] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const toggleCrop = (cropKey: string) => {
    setSelectedCrops((prev) =>
      prev.includes(cropKey)
        ? prev.length > 1
          ? prev.filter((c) => c !== cropKey)
          : prev
        : [...prev, cropKey]
    );
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await saveOnboardingProfile({
        language: selectedLang,
        district: selectedDistrict.name.split(',')[0].trim(),
        placeName: selectedDistrict.name,
        lat: selectedDistrict.lat,
        lon: selectedDistrict.lon,
        mainCrops: selectedCrops,
        landAcresBand: selectedLandBand,
        consentImproveModel,
      });
      onComplete();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94 }}
        className="w-full max-w-md rounded-card bg-[#F4F5EE] border border-olive/30 shadow-2xl p-5 sm:p-6 space-y-4 text-start overflow-hidden"
      >
        {/* Header with Step Indicator */}
        <div className="flex items-center justify-between gap-3 border-b border-olive/15 pb-3">
          <div>
            <span className="text-[11px] font-extrabold tracking-wider uppercase text-olive">
              {locale === 'ur' ? `مرحلہ ${step} از 4` : `Step ${step} of 4`}
            </span>
            <h2 className="text-base sm:text-lg font-black text-ink leading-tight">
              {step === 1 && (locale === 'ur' ? 'زبان کا انتخاب فرمائیں' : 'Choose Your Language')}
              {step === 2 && (locale === 'ur' ? 'اپنا زرعی ضلع منتخب کریں' : 'Choose Your District')}
              {step === 3 && (locale === 'ur' ? 'اپنی اہم فصلیں بتائیں' : 'Select Your Main Crops')}
              {step === 4 && (locale === 'ur' ? 'کھیت کا رقبہ و رضامندی' : 'Farm Size & Consent')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-bold text-ink/55 hover:text-ink px-3 py-1.5 rounded-full hover:bg-olive/10 transition-colors"
          >
            {t('skipBtn')}
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-olive/15 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-olive rounded-full"
            animate={{ width: `${(step / 4) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Step 1: Language */}
        {step === 1 && (
          <div className="space-y-3 py-2">
            <p className="text-xs text-ink/75 font-medium leading-relaxed">
              {locale === 'ur'
                ? 'زرخیز آپ کو کس زبان میں مشورہ اور آواز فراہم کرے؟'
                : 'Which language should Zarkhez use for text and voice guidance?'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedLang('ur')}
                className={`min-h-[56px] p-3 rounded-tile font-black text-sm flex items-center justify-between transition-all border-2 ${
                  selectedLang === 'ur'
                    ? 'bg-olive text-white border-olive shadow-soft'
                    : 'bg-white text-ink border-olive/20 hover:bg-olive/10'
                }`}
              >
                <span>اردو (Urdu)</span>
                {selectedLang === 'ur' && <Check className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => setSelectedLang('en')}
                className={`min-h-[56px] p-3 rounded-tile font-black text-sm flex items-center justify-between transition-all border-2 ${
                  selectedLang === 'en'
                    ? 'bg-olive text-white border-olive shadow-soft'
                    : 'bg-white text-ink border-olive/20 hover:bg-olive/10'
                }`}
              >
                <span>English</span>
                {selectedLang === 'en' && <Check className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: District */}
        {step === 2 && (
          <div className="space-y-3 py-2">
            <p className="text-xs text-ink/75 font-medium leading-relaxed">
              {locale === 'ur'
                ? 'اپنے کھیت کا ضلع منتخب کریں تاکہ درست مقامی موسم اور سپرے وارننگ مل سکے۔'
                : 'Select your district to receive accurate local rain, frost, and heat alerts.'}
            </p>
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1">
              {DISTRICT_CHIPS.map((d) => {
                const active = selectedDistrict.name === d.name;
                return (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => setSelectedDistrict(d)}
                    className={`min-h-[42px] px-3.5 py-2 rounded-full text-xs font-bold transition-all border ${
                      active
                        ? 'bg-olive text-white border-olive shadow-sm'
                        : 'bg-white text-ink border-olive/25 hover:bg-olive/10'
                    }`}
                  >
                    {locale === 'ur' ? d.ur : d.name.split(',')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Main Crops */}
        {step === 3 && (
          <div className="space-y-3 py-2">
            <p className="text-xs text-ink/75 font-medium leading-relaxed">
              {locale === 'ur'
                ? 'آپ کن فصلوں کی کاشت کرتے ہیں؟ (ایک یا زیادہ منتخب کریں)'
                : 'Which crops do you grow? (Select one or more)'}
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {CROPS.map((c) => {
                const active = selectedCrops.includes(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggleCrop(c.key)}
                    className={`min-h-[48px] p-2.5 rounded-tile text-xs font-bold flex items-center justify-between border-2 transition-all ${
                      active
                        ? 'bg-olive text-white border-olive shadow-sm'
                        : 'bg-white text-ink border-olive/20 hover:bg-olive/10'
                    }`}
                  >
                    <span>{locale === 'ur' ? c.ur : c.en}</span>
                    {active && <CheckCircle2 className="w-4 h-4 text-white" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 4: Land Band & Consent */}
        {step === 4 && (
          <div className="space-y-3 py-2">
            <div>
              <label className="block text-xs font-bold text-ink/80 mb-2">
                {locale === 'ur' ? 'کل زرعی رقبہ' : 'Cultivated Farm Size'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {LAND_BANDS.map((b) => {
                  const active = selectedLandBand === b.key;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setSelectedLandBand(b.key)}
                      className={`min-h-[44px] p-2.5 rounded-tile text-xs font-bold transition-all border ${
                        active
                          ? 'bg-olive text-white border-olive shadow-sm'
                          : 'bg-white text-ink border-olive/20 hover:bg-olive/10'
                      }`}
                    >
                      {locale === 'ur' ? b.ur : b.en}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Consent Box */}
            <div className="p-3.5 rounded-tile bg-white border border-olive/20 space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentImproveModel}
                  onChange={(e) => setConsentImproveModel(e.target.checked)}
                  className="w-4 h-4 accent-olive rounded mt-0.5"
                />
                <span className="text-xs text-ink/85 font-medium leading-relaxed">
                  {t('consentImprove')}
                </span>
              </label>
              <p className="text-[11px] text-ink/55 ps-6">
                {locale === 'ur'
                  ? 'آپ کی شناخت، نام اور ای میل ہمیشہ مکمل محفوظ اور نجی رہے گی۔'
                  : 'Your identity and contact info remain strictly confidential.'}
              </p>
            </div>
          </div>
        )}

        {/* Navigation Actions */}
        <div className="pt-2 flex items-center justify-between gap-3 border-t border-olive/15">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((prev) => (prev - 1) as any)}
              className="min-h-[44px] px-4 rounded-full bg-white text-ink font-bold text-xs border border-olive/20"
            >
              {locale === 'ur' ? 'پیچھے' : 'Back'}
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((prev) => (prev + 1) as any)}
              className="min-h-[48px] px-6 rounded-full bg-olive hover:bg-olive-dark text-white font-extrabold text-sm flex items-center gap-1.5 shadow-soft"
            >
              <span>{locale === 'ur' ? 'اگلا مرحلہ' : 'Next'}</span>
              <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleFinish}
              className="min-h-[48px] px-6 rounded-full bg-[#062409] hover:bg-olive-dark text-white font-extrabold text-sm flex items-center gap-1.5 shadow-lg"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>{saving ? '...' : t('finishBtn')}</span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

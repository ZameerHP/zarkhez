'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Mic,
  RefreshCw,
  ScanLine,
  Calendar,
  Sprout,
  Calculator,
  Plus,
  Trash2,
  CheckCircle2,
  User,
} from 'lucide-react';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { BottomNav } from '@/components/layout/BottomNav';
import { WeatherCard } from '@/components/weather/WeatherCard';
import { LocationPickerModal } from '@/components/weather/LocationPickerModal';
import {
  getAllCrops,
  generateCropCalendar,
  getCurrentCropStage,
} from '@/lib/calendar';
import {
  getCachedWeather,
  saveWeatherToCache,
  WeatherForecastResponse,
} from '@/lib/weather';
import {
  addFarmField,
  deleteAllUserData,
  deleteFarmField,
  FarmerProfile,
  FarmField,
  getSavedFields,
  getSavedProfile,
  restorePersistentSession,
  saveProfile,
  syncSupabaseAuthSession,
} from '@/lib/supabase/client';
import { SoilType } from '@/lib/fertilizer';
import { unlockAudio } from '@/lib/voice';

export default function HomePage() {
  const t = useTranslations('home');
  const tApp = useTranslations('app');
  const tTools = useTranslations('tools');
  const tDiary = useTranslations('diary');
  const locale = useLocale() as 'ur' | 'en';
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<FarmerProfile>(() =>
    getSavedProfile()
  );
  const [weather, setWeather] = useState<WeatherForecastResponse | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [isOfflineCached, setIsOfflineCached] = useState(false);
  const [fields, setFields] = useState<FarmField[]>([]);
  const [showAddField, setShowAddField] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [deletedBanner, setDeletedBanner] = useState(false);

  // New field form state
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldCrop, setNewFieldCrop] = useState('wheat');
  const [newFieldArea, setNewFieldArea] = useState('2');
  const [newFieldSoil, setNewFieldSoil] = useState<SoilType>('medium');
  const [newFieldDate, setNewFieldDate] = useState('');

  const crops = getAllCrops();

  const loadWeather = useCallback(async (lat: number, lon: number) => {
    setLoadingWeather(true);
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error('Weather API failed');
      const data = (await res.json()) as WeatherForecastResponse;
      setWeather(data);
      setIsOfflineCached(false);
      saveWeatherToCache(data);
    } catch {
      const cached = getCachedWeather();
      if (cached) {
        setWeather(cached);
        setIsOfflineCached(true);
      }
    } finally {
      setLoadingWeather(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const savedProfile = getSavedProfile();
    setProfile(savedProfile);
    setFields(getSavedFields());
    setNewFieldDate(new Date().toISOString().slice(0, 10));

    restorePersistentSession().then((restored) => {
      if (restored) {
        setProfile(restored);
        setFields(getSavedFields());
      }
    });

    syncSupabaseAuthSession().then((synced) => {
      if (synced) {
        setProfile(synced);
        setFields(getSavedFields());
      }
    });

    const cached = getCachedWeather();
    if (cached) {
      setWeather(cached);
    }
    loadWeather(savedProfile.lat, savedProfile.lon);
  }, [loadWeather]);

  const handleSelectPlace = async (
    placeName: string,
    lat: number,
    lon: number
  ) => {
    const updated = await saveProfile({
      placeName,
      district: placeName.split(',')[0].trim(),
      lat,
      lon,
    });
    setProfile(updated);
    setShowLocationModal(false);
    loadWeather(lat, lon);
  };

  const handleAddField = async (e: React.FormEvent) => {
    e.preventDefault();
    const cropObj = crops.find((c) => c.key === newFieldCrop) || crops[0];
    const name =
      newFieldName.trim() ||
      `${cropObj.name[locale]} (${newFieldArea || 1} Acre)`;
    await addFarmField({
      name,
      crop: newFieldCrop,
      area_acres: Math.max(0.5, Number(newFieldArea) || 1),
      soil_type: newFieldSoil,
      sowing_date: newFieldDate || new Date().toISOString().slice(0, 10),
    });
    setFields(getSavedFields());
    setShowAddField(false);
    setNewFieldName('');
  };

  const handleRemoveField = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setFields(deleteFarmField(id));
  };

  const handleDeleteAllData = async () => {
    await deleteAllUserData();
    setFields([]);
    setDeletedBanner(true);
    setTimeout(() => setDeletedBanner(false), 4000);
  };

  const formattedDate = mounted
    ? new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date())
    : '';

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas overflow-x-hidden">
      {/* Enhanced Deep Emerald / Olive Header */}
      <header className="bg-gradient-to-b from-[#051D08] via-[#133A19] to-[#264E1C] text-white rounded-b-[36px] px-4 sm:px-5 pt-4 pb-24 shadow-[0_14px_38px_rgba(6,36,9,0.22)] relative overflow-hidden">
        <div
          className="absolute -top-20 -end-16 w-60 h-60 rounded-full bg-olive-fresh/25 blur-3xl pointer-events-none"
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-16 -start-14 w-48 h-48 rounded-full bg-wheat/15 blur-2xl pointer-events-none"
          aria-hidden="true"
        />

        {/* Top Bar: Zarkhez Emblem + Language Toggle + Refresh */}
        <div className="relative z-10 flex items-center justify-between gap-2">
          <ZarkhezLogo size={38} lightText />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <LanguageToggle variant="glass" />
            <motion.button
              type="button"
              whileTap={{ scale: 0.9, rotate: 90 }}
              onClick={() => loadWeather(profile.lat, profile.lon)}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full glass flex items-center justify-center text-white hover:bg-white/25 transition-all"
              aria-label={t('refresh')}
            >
              <RefreshCw
                className={`w-4 h-4 sm:w-5 sm:h-5 ${
                  loadingWeather ? 'animate-spin' : ''
                }`}
              />
            </motion.button>
          </div>
        </div>

        {/* Clean Personalized Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative z-10 mt-5 flex items-center justify-between gap-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[11px] sm:text-xs text-emerald-200/80 font-medium tracking-wide">
              {formattedDate}
            </p>
            <h1 className="text-[22px] sm:text-[26px] leading-snug mt-0.5 truncate">
              <span className="font-light text-white/90">
                {t('greetingLight')}{' '}
              </span>
              <span className="font-extrabold text-cream">
                {profile.fullName || t('greetingBold')}
              </span>
            </h1>
          </div>

          <Link
            href="/profile"
            aria-label={locale === 'ur' ? 'پروفائل' : 'Profile'}
            className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 flex items-center justify-center text-cream shadow-sm transition-all flex-shrink-0 overflow-hidden"
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt={profile.fullName || 'Profile'}
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-5 h-5" />
            )}
          </Link>
        </motion.div>

        {/* Elevated Voice Bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="relative z-10 mt-4"
        >
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              router.push('/assistant?mic=1');
            }}
            className="w-full min-h-[54px] rounded-full glass border border-white/25 ps-4 pe-2 py-1.5 flex items-center justify-between gap-2 text-start hover:bg-white/25 transition-all shadow-[0_8px_24px_rgba(0,0,0,0.18)] active:scale-98"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-cream flex-shrink-0" />
              <span className="text-xs sm:text-sm text-white/95 truncate font-semibold">
                {t('askPlaceholder')}
              </span>
            </div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-olive-fresh to-olive text-white flex items-center justify-center shadow-md ring-1 ring-white/25 flex-shrink-0">
              <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </button>
        </motion.div>
      </header>

      {/* Main Content Overlapping the Olive Header */}
      <main className="px-4 sm:px-5 -mt-16 relative z-20 space-y-5">
        {/* White Weather Card + Active Alert Banner */}
        <WeatherCard
          placeName={profile.placeName}
          weather={weather}
          loading={loadingWeather}
          isOfflineCached={isOfflineCached}
          onRefresh={() => loadWeather(profile.lat, profile.lon)}
          onChangeLocation={() => setShowLocationModal(true)}
        />

        {/* Quick Tools with Subtle Tactile Upgrades */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          aria-labelledby="quick-tools-heading"
        >
          <h2
            id="quick-tools-heading"
            className="font-extrabold text-base sm:text-lg text-ink mb-2.5"
          >
            {t('quickTools')}
          </h2>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            <Link
              href="/scan"
              onClick={() => unlockAudio()}
              className="bg-gradient-to-br from-[#062409] to-[#17411D] text-white rounded-card p-3.5 sm:p-4 shadow-soft hover:shadow-md flex items-center gap-3 min-h-[76px] hover:-translate-y-0.5 transition-all active:scale-95 border border-emerald-400/25"
            >
              <div className="w-11 h-11 rounded-2xl bg-olive-fresh/25 border border-emerald-400/35 flex items-center justify-center flex-shrink-0">
                <ScanLine className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-300" />
              </div>
              <div className="min-w-0">
                <span className="block font-extrabold text-sm sm:text-base leading-tight truncate">
                  {t('toolScan')}
                </span>
                <span className="block text-[11px] text-white/80 mt-0.5 truncate">
                  {t('toolScanSub')}
                </span>
              </div>
            </Link>

            <Link
              href="/tools/calendar"
              className="bg-white text-ink rounded-card p-3.5 sm:p-4 shadow-soft hover:shadow-md border border-olive/12 flex items-center gap-3 min-h-[76px] hover:border-olive hover:-translate-y-0.5 transition-all active:scale-95"
            >
              <div className="w-11 h-11 rounded-2xl bg-olive/12 text-olive-dark flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <span className="block font-extrabold text-sm sm:text-base leading-tight truncate">
                  {t('toolCalendar')}
                </span>
                <span className="block text-[11px] text-ink/65 mt-0.5 truncate">
                  {t('toolCalendarSub')}
                </span>
              </div>
            </Link>

            <Link
              href="/tools/fertilizer"
              className="bg-white text-ink rounded-card p-3.5 sm:p-4 shadow-soft hover:shadow-md border border-olive/12 flex items-center gap-3 min-h-[76px] hover:border-olive hover:-translate-y-0.5 transition-all active:scale-95"
            >
              <div className="w-11 h-11 rounded-2xl bg-cream text-wheat flex items-center justify-center flex-shrink-0">
                <Sprout className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <span className="block font-extrabold text-sm sm:text-base leading-tight truncate">
                  {t('toolFertilizer')}
                </span>
                <span className="block text-[11px] text-ink/65 mt-0.5 truncate">
                  {t('toolFertilizerSub')}
                </span>
              </div>
            </Link>

            <Link
              href="/tools/profit"
              className="bg-white text-ink rounded-card p-3.5 sm:p-4 shadow-soft hover:shadow-md border border-olive/12 flex items-center gap-3 min-h-[76px] hover:border-olive hover:-translate-y-0.5 transition-all active:scale-95"
            >
              <div className="w-11 h-11 rounded-2xl bg-olive/12 text-olive flex items-center justify-center flex-shrink-0">
                <Calculator className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <span className="block font-extrabold text-sm sm:text-base leading-tight truncate">
                  {t('toolProfit')}
                </span>
                <span className="block text-[11px] text-ink/65 mt-0.5 truncate">
                  {t('toolProfitSub')}
                </span>
              </div>
            </Link>
          </div>
        </motion.section>

        {/* My Crops Strip */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12 }}
          aria-labelledby="my-crops-heading"
        >
          <div className="flex items-center justify-between mb-2.5">
            <h2
              id="my-crops-heading"
              className="font-extrabold text-base sm:text-lg text-ink"
            >
              {t('myCrops')}
            </h2>
          </div>

          <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-2 -mx-4 px-4 sm:-mx-5 sm:px-5">
            {crops.map((crop) => (
              <Link
                key={crop.key}
                href={`/crop/${crop.key}`}
                className="flex-shrink-0 w-28 sm:w-32 bg-white rounded-card p-3 shadow-soft hover:shadow-md border border-olive/12 hover:border-olive hover:-translate-y-0.5 transition-all active:scale-95 flex flex-col items-center text-center group"
              >
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden border-2 border-olive/20 group-hover:border-olive transition-colors">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={crop.photoUrl}
                    alt={crop.name[locale]}
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="font-bold text-xs sm:text-sm text-ink mt-2 leading-snug">
                  {crop.name[locale]}
                </span>
                <span
                  className={`mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    crop.scanSupported
                      ? 'bg-olive/15 text-olive-dark'
                      : 'bg-cream text-wheat'
                  }`}
                >
                  {crop.scanSupported
                    ? t('scanSupportedBadge')
                    : t('toolsOnlyBadge')}
                </span>
              </Link>
            ))}
          </div>
        </motion.section>

        {/* My Fields (Real User Fields Only) */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.16 }}
          aria-labelledby="my-fields-heading"
        >
          <div className="flex items-center justify-between mb-2.5">
            <h2
              id="my-fields-heading"
              className="font-extrabold text-base sm:text-lg text-ink"
            >
              {t('myFields')}
            </h2>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => setShowAddField(true)}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-full bg-olive text-white text-xs font-bold shadow-sm hover:bg-olive-dark transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{t('addField')}</span>
            </motion.button>
          </div>

          {fields.length === 0 ? (
            <div className="bg-white rounded-card p-5 text-center shadow-soft border border-olive/10 space-y-3">
              <p className="text-xs sm:text-sm text-ink/75">
                {t('emptyFields')}
              </p>
              <button
                type="button"
                onClick={() => setShowAddField(true)}
                className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-full bg-olive text-white font-bold text-xs sm:text-sm active:scale-95 transition-transform"
              >
                <Plus className="w-4 h-4" />
                <span>{t('addField')}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {fields.map((field) => {
                const crop =
                  crops.find((c) => c.key === field.crop) || crops[0];
                const { stage, daysSinceSowing } = getCurrentCropStage(
                  crop,
                  field.sowing_date
                );
                const calendar = generateCropCalendar(
                  crop.key,
                  field.sowing_date,
                  field.completedTaskIds
                );
                const nextTask =
                  calendar.tasks.find(
                    (task) => !task.done && task.dayOffset >= daysSinceSowing
                  ) || calendar.tasks.find((task) => !task.done);

                return (
                  <Link
                    key={field.id}
                    href={`/crop/${crop.key}?fieldId=${field.id}&sowing=${field.sowing_date}`}
                    className="block bg-white rounded-card overflow-hidden shadow-soft hover:shadow-md border border-olive/12 hover:border-olive transition-all active:scale-98"
                  >
                    <div className="flex items-stretch">
                      <div className="w-24 sm:w-28 relative flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={crop.photoUrl}
                          alt={crop.name[locale]}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2 start-2 px-2 py-0.5 rounded-full glass-dark text-white text-[10px] font-bold">
                          <bdi dir="ltr">{field.area_acres} ac</bdi>
                        </div>
                      </div>

                      <div className="flex-1 p-3 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-bold text-sm sm:text-base text-ink truncate">
                              {field.name}
                            </h3>
                            <button
                              type="button"
                              onClick={(e) => handleRemoveField(e, field.id)}
                              className="p-1 text-ink/35 hover:text-alert-red"
                              aria-label={tApp('delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-xs text-olive-dark font-semibold mt-0.5">
                            {t('stageLabel')}: {stage.name[locale]} (
                            <bdi dir="ltr">Day {daysSinceSowing}</bdi>)
                          </p>
                        </div>

                        <div className="mt-2 pt-2 border-t border-olive/10">
                          {nextTask ? (
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-ink/80 truncate">
                                <strong className="text-ink">
                                  {t('nextTaskLabel')}:
                                </strong>{' '}
                                {nextTask.title[locale]}
                              </span>
                              <bdi
                                dir="ltr"
                                className="px-2 py-0.5 rounded-full bg-cream text-wheat font-bold flex-shrink-0 text-[11px]"
                              >
                                {nextTask.dueDate.slice(5)}
                              </bdi>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-olive font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {t('allTasksDone')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </motion.section>

        {/* Privacy & Delete My Data Footer */}
        <footer className="pt-4 pb-6 border-t border-olive/10 flex flex-col items-center text-center gap-3">
          <p className="text-xs text-ink/65 max-w-sm leading-relaxed">
            {tApp('disclaimer')}
          </p>
          {deletedBanner && (
            <p className="text-xs font-bold text-olive-dark bg-olive/15 px-3 py-1.5 rounded-full">
              {tApp('deleteConfirm')}
            </p>
          )}
          <button
            type="button"
            onClick={handleDeleteAllData}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-full text-xs font-semibold text-alert-red hover:bg-alert-red/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>{tApp('deleteMyData')}</span>
          </button>
        </footer>
      </main>

      {/* Shared Change Location / District Modal (includes Mirpur Khas) */}
      <LocationPickerModal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onSelectPlace={handleSelectPlace}
      />

      {/* Add Field Modal */}
      <AnimatePresence>
        {showAddField && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              className="w-full max-w-[430px] bg-white rounded-card p-5 shadow-2xl space-y-4"
            >
              <h3 className="font-extrabold text-lg text-ink">
                {tDiary('addFieldModalTitle')}
              </h3>
              <form onSubmit={handleAddField} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-ink/75 mb-1">
                    {tDiary('fieldName')}
                  </label>
                  <input
                    type="text"
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    placeholder="نہر والا کھیت / North Plot"
                    className="w-full min-h-[46px] px-3.5 rounded-tile bg-canvas border border-olive/25 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-ink/75 mb-1">
                      {tTools('selectCrop')}
                    </label>
                    <select
                      value={newFieldCrop}
                      onChange={(e) => setNewFieldCrop(e.target.value)}
                      className="w-full min-h-[46px] px-3 rounded-tile bg-canvas border border-olive/25 text-sm font-semibold"
                    >
                      {crops.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.name[locale]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-ink/75 mb-1">
                      {tTools('landSize')}
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={newFieldArea}
                      onChange={(e) => setNewFieldArea(e.target.value)}
                      className="w-full min-h-[46px] px-3.5 rounded-tile bg-canvas border border-olive/25 text-sm font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-ink/75 mb-1">
                      {tTools('soilType')}
                    </label>
                    <select
                      value={newFieldSoil}
                      onChange={(e) =>
                        setNewFieldSoil(e.target.value as SoilType)
                      }
                      className="w-full min-h-[46px] px-3 rounded-tile bg-canvas border border-olive/25 text-sm font-semibold"
                    >
                      <option value="poor">{tTools('soilPoor')}</option>
                      <option value="medium">{tTools('soilMedium')}</option>
                      <option value="fertile">{tTools('soilFertile')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-ink/75 mb-1">
                      {tTools('sowingDate')}
                    </label>
                    <input
                      type="date"
                      value={newFieldDate}
                      onChange={(e) => setNewFieldDate(e.target.value)}
                      className="w-full min-h-[46px] px-3 rounded-tile bg-canvas border border-olive/25 text-sm"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddField(false)}
                    className="flex-1 min-h-[46px] rounded-full bg-canvas text-ink font-bold text-sm"
                  >
                    {tApp('cancel')}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 min-h-[46px] rounded-full bg-olive text-white font-bold text-sm shadow-soft"
                  >
                    {tApp('save')}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}

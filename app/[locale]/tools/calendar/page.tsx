'use client';

import React, { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  Circle,
  Droplets,
  Sprout,
  ShieldAlert,
  Scissors,
  BookmarkCheck,
  Plus,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';
import {
  generateCropCalendar,
  getAllCrops,
  TaskType,
} from '@/lib/calendar';
import {
  addFarmField,
  getSavedFields,
  toggleFieldTaskDone,
} from '@/lib/supabase/client';

export default function CalendarToolPage() {
  const t = useTranslations('tools');
  const locale = useLocale() as 'ur' | 'en';
  const searchParams = useSearchParams();

  const crops = getAllCrops();
  const [selectedCrop, setSelectedCrop] = useState('wheat');
  const [sowingDate, setSowingDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [matchedFieldId, setMatchedFieldId] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  useEffect(() => {
    const qCrop = searchParams.get('crop');
    if (qCrop && crops.some((c) => c.key === qCrop)) {
      setSelectedCrop(qCrop);
    }
  }, [searchParams, crops]);

  useEffect(() => {
    const fields = getSavedFields();
    const match = fields.find((f) => f.crop === selectedCrop);
    if (match) {
      setMatchedFieldId(match.id);
      setSowingDate(match.sowing_date);
      setCompletedIds(match.completedTaskIds);
    } else {
      setMatchedFieldId(null);
      setCompletedIds([]);
    }
  }, [selectedCrop]);

  const calendar = generateCropCalendar(
    selectedCrop,
    sowingDate,
    completedIds
  );

  const handleToggle = (taskId: string) => {
    if (matchedFieldId) {
      const updated = toggleFieldTaskDone(matchedFieldId, taskId);
      const found = updated.find((f) => f.id === matchedFieldId);
      if (found) setCompletedIds(found.completedTaskIds);
    } else {
      setCompletedIds((prev) =>
        prev.includes(taskId)
          ? prev.filter((id) => id !== taskId)
          : [...prev, taskId]
      );
    }
  };

  const handleSaveFieldToHome = async () => {
    const field = await addFarmField({
      name: `${calendar.crop.name[locale]} Field`,
      crop: selectedCrop,
      area_acres: 2,
      soil_type: 'medium',
      sowing_date: sowingDate,
    });
    setMatchedFieldId(field.id);
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 3000);
  };

  const getTaskIcon = (type: TaskType) => {
    switch (type) {
      case 'irrigation':
        return <Droplets className="w-4 h-4 text-olive" />;
      case 'fertilizer':
        return <Sprout className="w-4 h-4 text-wheat" />;
      case 'spray':
        return <ShieldAlert className="w-4 h-4 text-alert-amber" />;
      case 'harvest':
        return <Scissors className="w-4 h-4 text-olive-dark" />;
      default:
        return <CalendarIcon className="w-4 h-4 text-olive" />;
    }
  };

  const spokenSummary = `${calendar.crop.name[locale]}. ${t(
    'harvestDateLabel'
  )}: ${calendar.harvestDate}. ${calendar.tasks
    .slice(0, 4)
    .map((tk) => `${tk.dueDate}: ${tk.title[locale]}`)
    .join('. ')}`;

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
            {t('calendarTitle')}
          </h1>
          <p className="text-xs text-cream mt-0.5">{t('calendarSub')}</p>
        </div>
      </header>

      <main className="px-5 mt-5 space-y-5">
        {/* Controls Card */}
        <section className="bg-white rounded-card p-5 shadow-soft border border-olive/10 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {t('selectCrop')}
              </label>
              <select
                value={selectedCrop}
                onChange={(e) => setSelectedCrop(e.target.value)}
                className="w-full min-h-[52px] px-4 rounded-tile bg-canvas border border-olive/25 font-bold text-base text-ink"
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
                {t('sowingDate')}
              </label>
              <input
                type="date"
                value={sowingDate}
                onChange={(e) => setSowingDate(e.target.value)}
                className="w-full min-h-[52px] px-4 rounded-tile bg-canvas border border-olive/25 font-bold text-base text-ink"
              />
            </div>
          </div>

          <div className="bg-cream/65 rounded-tile p-3.5 flex items-center justify-between gap-3">
            <div>
              <span className="block text-xs text-ink/70 font-semibold">
                {t('harvestDateLabel')}
              </span>
              <bdi
                dir="ltr"
                className="font-extrabold text-lg text-olive-dark"
              >
                {calendar.harvestDate}
              </bdi>
            </div>
            <ReadAloudButton text={spokenSummary} />
          </div>

          <button
            type="button"
            onClick={handleSaveFieldToHome}
            className="w-full min-h-[48px] rounded-full bg-olive hover:bg-olive-dark text-white font-bold text-sm flex items-center justify-center gap-2 shadow-soft"
          >
            {savedBanner ? (
              <>
                <BookmarkCheck className="w-4 h-4" />
                <span>{t('savedFieldSuccess')}</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>{t('saveCalendarField')}</span>
              </>
            )}
          </button>
        </section>

        {/* Growth Stages Strip */}
        <section className="bg-white rounded-card p-5 shadow-soft border border-olive/10 space-y-3">
          <h2 className="font-extrabold text-base text-ink">
            {t('stageTimeline')}
          </h2>
          <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
            {calendar.crop.stages.map((st) => (
              <div
                key={st.key}
                className="flex-shrink-0 bg-canvas rounded-tile px-3.5 py-2.5 border border-olive/10"
              >
                <span className="block font-bold text-sm text-ink">
                  {st.name[locale]}
                </span>
                <bdi dir="ltr" className="text-xs text-olive-dark font-semibold">
                  Day {st.startDay} – {st.endDay}
                </bdi>
              </div>
            ))}
          </div>
        </section>

        {/* Task Timeline with Tick Boxes */}
        <section className="bg-white rounded-card p-5 shadow-soft border border-olive/10 space-y-3">
          <div className="space-y-2.5">
            {calendar.tasks.map((task) => {
              const isDone = completedIds.includes(task.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => handleToggle(task.id)}
                  className={`w-full rounded-tile p-3.5 border text-start flex items-center justify-between gap-3 transition-all min-h-[60px] ${
                    isDone
                      ? 'bg-olive/10 border-olive/30 opacity-75'
                      : 'bg-canvas border-transparent hover:border-olive/30'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isDone ? (
                      <CheckCircle2 className="w-6 h-6 text-olive flex-shrink-0" />
                    ) : (
                      <Circle className="w-6 h-6 text-ink/35 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {getTaskIcon(task.type)}
                        <span
                          className={`font-bold text-sm ${
                            isDone ? 'line-through text-ink/60' : 'text-ink'
                          }`}
                        >
                          {task.title[locale]}
                        </span>
                      </div>
                      <span className="block text-xs text-ink/60 mt-0.5">
                        {t('dayOffset', { day: task.dayOffset })}
                      </span>
                    </div>
                  </div>

                  <bdi
                    dir="ltr"
                    className="text-xs font-extrabold px-2.5 py-1 rounded-full bg-white text-olive-dark border border-olive/15 flex-shrink-0"
                  >
                    {task.dueDate}
                  </bdi>
                </button>
              );
            })}
          </div>

          <p className="text-xs text-ink/65 pt-3 border-t border-olive/10">
            <strong>{t('sourceLabel')}</strong> {calendar.crop.source}
          </p>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

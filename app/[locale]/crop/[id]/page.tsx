'use client';

import React, { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ScanLine,
  Calendar,
  Sprout,
  CheckCircle2,
  Circle,
  MapPin,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import {
  generateCropCalendar,
  getAllCrops,
  getCropByKey,
} from '@/lib/calendar';
import {
  getSavedFields,
  getSavedProfile,
  toggleFieldTaskDone,
} from '@/lib/supabase/client';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';

/**
 * Crop Detail Screen (Section 11.2 of SPEC.md):
 * - Full-bleed crop photo, glass back button, glass pill with crop thumbnail and place,
 *   glass side buttons (Scan, Calendar).
 * - Bottom white card: crop name in bold green, expected harvest date,
 *   estimated profit (from the profit tool, labelled as an estimate) and the next three tasks.
 */
export default function CropDetailPage() {
  const t = useTranslations('cropDetail');
  const tTools = useTranslations('tools');
  const locale = useLocale() as 'ur' | 'en';
  const params = useParams();
  const searchParams = useSearchParams();

  const cropKey = String(params?.id || 'wheat');
  const crop = getCropByKey(cropKey) || getAllCrops()[0];

  const [placeName, setPlaceName] = useState('Multan, Punjab');
  const [sowingDate, setSowingDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<string[]>([]);

  useEffect(() => {
    const profile = getSavedProfile();
    setPlaceName(profile.placeName);

    const fields = getSavedFields();
    const qFieldId = searchParams.get('fieldId');
    const qSowing = searchParams.get('sowing');

    const matchedField = qFieldId
      ? fields.find((f) => f.id === qFieldId)
      : fields.find((f) => f.crop === crop.key);

    if (matchedField) {
      setFieldId(matchedField.id);
      setSowingDate(matchedField.sowing_date);
      setCompletedIds(matchedField.completedTaskIds);
    } else if (qSowing) {
      setSowingDate(qSowing);
    }
  }, [crop.key, searchParams]);

  const calendar = generateCropCalendar(crop.key, sowingDate, completedIds);
  const nextThreeTasks = calendar.tasks.filter((task) => !task.done).slice(0, 3);

  const handleToggleTask = (taskId: string) => {
    if (fieldId) {
      const updated = toggleFieldTaskDone(fieldId, taskId);
      const found = updated.find((f) => f.id === fieldId);
      if (found) setCompletedIds(found.completedTaskIds);
    } else {
      setCompletedIds((prev) =>
        prev.includes(taskId)
          ? prev.filter((id) => id !== taskId)
          : [...prev, taskId]
      );
    }
  };

  const spokenText = `${crop.name[locale]}. ${t('expectedHarvest')}: ${
    calendar.harvestDate
  }. ${nextThreeTasks
    .map((tk) => tk.title[locale])
    .join('. ')}`;

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas flex flex-col">
      {/* Top Full-Bleed Crop Photo with Glass Controls (Section 11.2) */}
      <div className="relative h-80 w-full overflow-hidden">
        <img
          src={crop.photoUrl}
          alt={crop.name[locale]}
          className="w-full h-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.65) 100%)',
          }}
        />

        {/* Top Bar: Glass Back Button + Glass Pill with Crop Thumbnail and Place */}
        <div className="absolute top-5 inset-x-5 flex items-center justify-between gap-2">
          <Link
            href="/home"
            className="w-12 h-12 rounded-full glass flex items-center justify-center text-white shadow-soft"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
          </Link>

          <div className="glass rounded-full ps-2 pe-4 py-1.5 flex items-center gap-2.5 text-white shadow-soft">
            <img
              src={crop.photoUrl}
              alt=""
              className="w-8 h-8 rounded-full object-cover border border-white/50"
            />
            <div className="text-xs">
              <span className="font-extrabold block leading-tight">
                {crop.name[locale]}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-white/90">
                <MapPin className="w-3 h-3" />
                {placeName}
              </span>
            </div>
          </div>
        </div>

        {/* Glass Side Buttons (Scan, Calendar) */}
        <div className="absolute bottom-10 end-5 flex flex-col gap-2.5">
          <Link
            href="/scan"
            className="glass rounded-full px-4 py-2.5 min-h-[48px] text-white font-bold text-xs flex items-center gap-2 shadow-soft hover:bg-white/35"
          >
            <ScanLine className="w-4 h-4 text-cream" />
            <span>{t('scanCrop')}</span>
          </Link>
          <Link
            href={`/tools/calendar?crop=${crop.key}`}
            className="glass rounded-full px-4 py-2.5 min-h-[48px] text-white font-bold text-xs flex items-center gap-2 shadow-soft hover:bg-white/35"
          >
            <Calendar className="w-4 h-4 text-cream" />
            <span>{t('openCalendar')}</span>
          </Link>
        </div>
      </div>

      {/* Bottom White Card (Section 11.2) */}
      <main className="flex-1 bg-white rounded-t-[32px] -mt-6 relative z-10 px-5 pt-6 pb-8 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-wheat">
              {crop.season === 'rabi' ? t('seasonRabi') : t('seasonKharif')} •{' '}
              {t('durationDays', { days: crop.durationDays })}
            </span>
            <h1 className="font-extrabold text-3xl text-olive-dark mt-1">
              {crop.name[locale]}
            </h1>
          </div>
          <ReadAloudButton text={spokenText} />
        </div>

        {/* Harvest Date */}
        <div className="bg-canvas rounded-card p-4 border border-olive/10">
          <span className="block text-xs text-ink/65 font-semibold">
            {t('expectedHarvest')}
          </span>
          <bdi
            dir="ltr"
            className="block font-extrabold text-lg text-ink mt-1"
          >
            {calendar.harvestDate}
          </bdi>
        </div>

        {/* Next Three Tasks */}
        <section className="space-y-3">
          <h2 className="font-extrabold text-base text-ink">
            {t('nextThreeTasks')}
          </h2>
          <div className="space-y-2.5">
            {nextThreeTasks.map((task) => {
              const isDone = completedIds.includes(task.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => handleToggleTask(task.id)}
                  className="w-full bg-canvas hover:bg-olive/10 rounded-tile p-3.5 flex items-center justify-between gap-3 text-start transition-colors min-h-[56px]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-olive flex-shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-olive/60 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <span className="block font-bold text-sm text-ink">
                        {task.title[locale]}
                      </span>
                      <span className="text-xs text-ink/65">
                        {tTools('dayOffset', { day: task.dayOffset })}
                      </span>
                    </div>
                  </div>
                  <bdi
                    dir="ltr"
                    className="text-xs font-bold px-2.5 py-1 rounded-full bg-white text-olive-dark border border-olive/15 flex-shrink-0"
                  >
                    {task.dueDate}
                  </bdi>
                </button>
              );
            })}
          </div>
        </section>

        {/* Quick Links to Crop Tools */}
        <div className="grid grid-cols-2 gap-2.5 pt-2">
          <Link
            href={`/tools/calendar?crop=${crop.key}`}
            className="min-h-[52px] rounded-tile bg-olive text-white font-bold text-xs flex flex-col items-center justify-center p-2 text-center shadow-sm"
          >
            <Calendar className="w-4 h-4 mb-1" />
            <span>{t('openCalendar')}</span>
          </Link>
          <Link
            href={`/tools/fertilizer?crop=${crop.key}`}
            className="min-h-[52px] rounded-tile bg-canvas text-ink font-bold text-xs flex flex-col items-center justify-center p-2 text-center border border-olive/15"
          >
            <Sprout className="w-4 h-4 text-wheat mb-1" />
            <span>{t('openFertilizer')}</span>
          </Link>
        </div>

        {/* Verified Source Footer */}
        <p className="text-xs text-ink/60 pt-2 border-t border-olive/10">
          <strong>{tTools('sourceLabel')}</strong> {crop.source}
        </p>
      </main>

      <BottomNav />
    </div>
  );
}

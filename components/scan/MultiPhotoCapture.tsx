'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera,
  Upload,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Volume2,
  X,
  Info,
  ChevronRight,
  ShieldCheck,
  Leaf,
  Layers,
  Sprout,
  CircleDot,
  Check,
} from 'lucide-react';
import {
  compressAndAssessLeafImage,
  ImageQualityReport,
} from '@/lib/image-quality';
import { speakText, unlockAudio } from '@/lib/voice';
import { getSupabaseClient } from '@/lib/supabase/client';

export type ScanSlotKey =
  | 'leaf_top'
  | 'leaf_underside'
  | 'stem'
  | 'roots'
  | 'whole_plant'
  | 'fruit_flower';

export interface CapturedPhoto {
  slot: ScanSlotKey;
  fullDataUrl: string;
  thumbnailDataUrl: string;
  quality: ImageQualityReport;
  storagePath?: string;
  uploadStatus: 'idle' | 'uploading' | 'uploaded' | 'error';
}

export interface QuickAnswers {
  crop?: string;
  duration?: '1_to_2_days' | 'this_week' | 'longer';
  spread?: 'few_plants' | 'many_plants' | 'whole_field';
  recentEvents?: 'yes' | 'no' | 'not_sure';
}

interface MultiPhotoCaptureProps {
  initialCrop?: string;
  onProceedToAnalysis: (
    photos: CapturedPhoto[],
    answers: QuickAnswers
  ) => void;
  isAnalysing?: boolean;
}

interface SlotConfig {
  key: ScanSlotKey;
  icon: React.ComponentType<{ className?: string }>;
  labelUr: string;
  labelEn: string;
  tipUr: string;
  tipEn: string;
  isOptional?: boolean;
}

const SLOTS: SlotConfig[] = [
  {
    key: 'leaf_top',
    icon: Leaf,
    labelUr: 'پتے کی اوپری سطح',
    labelEn: 'Leaf (top)',
    tipUr: 'پتے کی اوپری سطح پر دھبے، زردی اور کناروں کا جھلساؤ دیکھیں۔',
    tipEn: 'Focus on lesions, leaf edges, and discoloration on the upper surface.',
  },
  {
    key: 'leaf_underside',
    icon: Layers,
    labelUr: 'پتے کی نچلی سطح',
    labelEn: 'Leaf (underside)',
    tipUr: 'پتا الٹائیں: کیڑے، سفید پاؤڈر، باریک جالے یا انڈے چیک کریں۔',
    tipEn: 'Turn leaf over: look for pests, mildews, webs, or insect eggs.',
  },
  {
    key: 'stem',
    icon: Sprout,
    labelUr: 'تنا اور شاخ',
    labelEn: 'Stem & branch',
    tipUr: 'تنے پر کٹ، زخم، گانٹھیں یا سنڈی کے سوراخ دیکھیں۔',
    tipEn: 'Look for dark lesions, cankers, cracks, or borer entry holes.',
  },
  {
    key: 'roots',
    icon: CircleDot,
    labelUr: 'جڑیں یا بنیاد',
    labelEn: 'Roots or base',
    tipUr: 'جڑوں کا رنگ، گلنا سڑنا، رسولیاں یا گانٹھیں دیکھیں۔',
    tipEn: 'Inspect root color, rot, slime, or swollen root galls.',
  },
  {
    key: 'whole_plant',
    icon: Leaf,
    labelUr: 'پورا پودا',
    labelEn: 'Whole plant',
    tipUr: 'چند قدم پیچھے ہٹیں تاکہ پورا پودا اور کھیت میں حالت نظر آئے۔',
    tipEn: 'Step back to capture whole plant posture and field spread.',
  },
  {
    key: 'fruit_flower',
    icon: Sparkles,
    labelUr: 'پھل یا پھول',
    labelEn: 'Fruit or flower',
    tipUr: 'پھل یا پھول پر داغ، گلن یا کیڑے کا نقصان فوکس کریں۔',
    tipEn: 'Photograph rot spots, deformities, or insect punctures.',
    isOptional: true,
  },
];

const CROPS_LIST = [
  { key: 'wheat', ur: 'گندم', en: 'Wheat' },
  { key: 'rice', ur: 'دھان', en: 'Rice' },
  { key: 'cotton', ur: 'کپاس', en: 'Cotton' },
  { key: 'maize', ur: 'مکئی', en: 'Maize' },
  { key: 'sugarcane', ur: 'کماد (گنا)', en: 'Sugarcane' },
  { key: 'tomato', ur: 'ٹماٹر', en: 'Tomato' },
  { key: 'potato', ur: 'آلو', en: 'Potato' },
  { key: 'chili', ur: 'مرچ', en: 'Chili' },
  { key: 'citrus', ur: 'کنو / مالٹا', en: 'Citrus' },
  { key: 'mango', ur: 'آم', en: 'Mango' },
  { key: 'onion', ur: 'پیاز', en: 'Onion' },
];

export function MultiPhotoCapture({
  initialCrop = 'tomato',
  onProceedToAnalysis,
  isAnalysing = false,
}: MultiPhotoCaptureProps) {
  const t = useTranslations('scan');
  const locale = useLocale() as 'ur' | 'en';

  const [photos, setPhotos] = useState<Record<ScanSlotKey, CapturedPhoto | null>>({
    leaf_top: null,
    leaf_underside: null,
    stem: null,
    roots: null,
    whole_plant: null,
    fruit_flower: null,
  });

  const [activeSlot, setActiveSlot] = useState<ScanSlotKey>('leaf_top');
  const [activeCamera, setActiveCamera] = useState(false);
  const [pendingQualityPhoto, setPendingQualityPhoto] = useState<CapturedPhoto | null>(null);
  const [showQuestionsStep, setShowQuestionsStep] = useState(false);

  // Quick Questions State
  const [selectedCrop, setSelectedCrop] = useState<string>(initialCrop);
  const [duration, setDuration] = useState<'1_to_2_days' | 'this_week' | 'longer' | undefined>();
  const [spread, setSpread] = useState<'few_plants' | 'many_plants' | 'whole_field' | undefined>();
  const [recentEvents, setRecentEvents] = useState<'yes' | 'no' | 'not_sure' | undefined>();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const capturedList = Object.values(photos).filter(
    (p): p is CapturedPhoto => p !== null
  );
  const capturedCount = capturedList.length;

  // Accuracy meter calculation (Section 4.1)
  const accuracyPercent = Math.min(
    100,
    capturedCount === 0
      ? 0
      : capturedCount === 1
      ? 40
      : capturedCount === 2
      ? 65
      : capturedCount === 3
      ? 85
      : 100
  );

  const accuracyBadge =
    capturedCount === 0
      ? { ur: 'کم از کم ایک تصویر درکار ہے', en: 'At least 1 photo required' }
      : capturedCount === 1
      ? { ur: 'بنیادی معائنہ (40% درستگی)', en: 'Basic scan (40% accuracy)' }
      : capturedCount === 2
      ? { ur: 'بہتر معائنہ (65% درستگی)', en: 'Good scan (65% accuracy)' }
      : capturedCount === 3
      ? { ur: 'اعلیٰ درستگی (85% درستگی)', en: 'High precision (85% accuracy)' }
      : { ur: 'مکمل جامع معائنہ (100% معیار)', en: 'Complete multi-organ scan (100%)' };

  // Stop camera when unmounting
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const stopLiveCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setActiveCamera(false);
  };

  const startLiveCamera = async (slot: ScanSlotKey) => {
    unlockAudio();
    setActiveSlot(slot);

    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    ) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        streamRef.current = stream;
        setActiveCamera(true);
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        }, 50);
        return;
      } catch {
        // Fallback to native camera input
      }
    }
    cameraInputRef.current?.click();
  };

  // Background upload of photo (Section 4.1)
  const triggerBackgroundUpload = async (photo: CapturedPhoto) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id || 'anonymous';
      const fileExt = 'jpg';
      const fileName = `${userId}/${Date.now()}-${photo.slot}.${fileExt}`;

      // Convert base64 dataUrl to blob
      const res = await fetch(photo.fullDataUrl);
      const blob = await res.blob();

      const { data, error } = await supabase.storage
        .from('scans')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

      if (!error && data?.path) {
        setPhotos((prev) => {
          const current = prev[photo.slot];
          if (!current) return prev;
          return {
            ...prev,
            [photo.slot]: {
              ...current,
              storagePath: data.path,
              uploadStatus: 'uploaded',
            },
          };
        });
      }
    } catch {
      // Offline fallback: keep in memory / local state
    }
  };

  // Process and quality-check captured image
  const processCapturedImage = async (
    fileOrDataUrl: File | Blob | string,
    slot: ScanSlotKey
  ) => {
    try {
      const compressed = await compressAndAssessLeafImage(fileOrDataUrl);
      const newPhoto: CapturedPhoto = {
        slot,
        fullDataUrl: compressed.fullDataUrl,
        thumbnailDataUrl: compressed.thumbnailDataUrl,
        quality: compressed.quality,
        uploadStatus: 'uploading',
      };

      // Quality Check: if unacceptable, offer friendly warning (Section 4.2)
      if (!compressed.quality.isAcceptable) {
        setPendingQualityPhoto(newPhoto);
      } else {
        commitPhoto(newPhoto);
      }
    } catch {
      console.warn('Photo processing could not complete cleanly.');
    }
  };

  const commitPhoto = (photo: CapturedPhoto) => {
    setPhotos((prev) => ({ ...prev, [photo.slot]: photo }));
    setPendingQualityPhoto(null);

    // Background upload photo 1 while taking photo 2
    triggerBackgroundUpload(photo);

    // Auto-advance to next empty slot if camera is still open
    const slotKeys: ScanSlotKey[] = [
      'leaf_top',
      'leaf_underside',
      'stem',
      'roots',
      'whole_plant',
      'fruit_flower',
    ];
    const currentIndex = slotKeys.indexOf(photo.slot);
    const nextSlot = slotKeys.slice(currentIndex + 1).find((s) => !photos[s]);
    if (nextSlot) {
      setActiveSlot(nextSlot);
    }
  };

  const handleCaptureFromStream = () => {
    unlockAudio();
    if (!videoRef.current) return;
    const v = videoRef.current;
    const w = v.videoWidth || 640;
    const h = v.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(v, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      processCapturedImage(dataUrl, activeSlot);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    unlockAudio();
    const file = e.target.files?.[0];
    if (!file) return;
    processCapturedImage(file, activeSlot);
    e.target.value = '';
  };

  const removePhoto = (slot: ScanSlotKey) => {
    setPhotos((prev) => ({ ...prev, [slot]: null }));
  };

  const activeSlotConfig = SLOTS.find((s) => s.key === activeSlot) || SLOTS[0];

  const handleProceed = () => {
    if (capturedCount === 0) return;
    // Open quick questions sheet if not yet shown, or submit directly
    if (!showQuestionsStep) {
      setShowQuestionsStep(true);
    } else {
      onProceedToAnalysis(capturedList, {
        crop: selectedCrop,
        duration,
        spread,
        recentEvents,
      });
    }
  };

  const handleSkipQuestionsAndAnalyze = () => {
    onProceedToAnalysis(capturedList, {
      crop: selectedCrop,
    });
  };

  return (
    <div className="space-y-4">
      {/* Hidden File / Camera Inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileInput}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInput}
        className="hidden"
      />

      {/* Accuracy Meter Card (Section 4.1) */}
      <div className="rounded-2xl p-4 bg-white/95 border border-olive/20 shadow-soft">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-black text-ink">
              {locale === 'ur'
                ? 'جتنی زیادہ تصاویر، اتنی زیادہ درست تشخیص'
                : 'More photos means a more accurate answer'}
            </span>
          </div>
          <span className="text-xs font-black text-olive px-2.5 py-0.5 rounded-full bg-olive/10 border border-olive/20">
            {capturedCount} / {SLOTS.length}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-ink/10 h-2 rounded-full overflow-hidden mb-2">
          <motion.div
            className="h-full bg-gradient-to-r from-emerald-500 via-olive to-emerald-600 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${accuracyPercent}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        <p className="text-[11px] font-bold text-ink/70">
          {locale === 'ur' ? accuracyBadge.ur : accuracyBadge.en}
        </p>
      </div>

      {/* Live Camera Viewfinder Overlay (when active) */}
      <AnimatePresence>
        {activeCamera && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative rounded-3xl overflow-hidden bg-black aspect-[3/4] max-h-[460px] shadow-2xl border-2 border-emerald-500/40"
          >
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-cover"
            />

            {/* Viewfinder Target Guide Overlay */}
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
              {/* Top slot pill */}
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white text-xs font-bold">
                  <activeSlotConfig.icon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    {locale === 'ur'
                      ? activeSlotConfig.labelUr
                      : activeSlotConfig.labelEn}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={stopLiveCamera}
                  className="pointer-events-auto w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center border border-white/20"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Central Aim Frame */}
              <div className="relative mx-auto w-56 h-56 sm:w-64 sm:h-64 rounded-3xl border-2 border-dashed border-white/60 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full bg-emerald-400/50 animate-ping absolute" />
                <div className="w-2 h-2 rounded-full bg-emerald-400 absolute" />
              </div>

              {/* Bottom Tip with Audio Button */}
              <div className="bg-black/75 backdrop-blur-md rounded-2xl p-3 border border-white/15 flex items-center justify-between gap-2">
                <p className="text-xs text-white/90 font-medium leading-relaxed">
                  {locale === 'ur'
                    ? activeSlotConfig.tipUr
                    : activeSlotConfig.tipEn}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    speakText(
                      locale === 'ur'
                        ? activeSlotConfig.tipUr
                        : activeSlotConfig.tipEn,
                      locale
                    );
                  }}
                  className="pointer-events-auto w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center flex-shrink-0"
                  aria-label="Read tip aloud"
                >
                  <Volume2 className="w-4 h-4 text-emerald-300" />
                </button>
              </div>
            </div>

            {/* Shutter Button & Controls */}
            <div className="absolute bottom-5 inset-x-0 flex items-center justify-around px-6 pointer-events-auto">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-md border border-white/25 text-white flex items-center justify-center hover:bg-black/80"
                title="Gallery"
              >
                <Upload className="w-5 h-5" />
              </button>

              {/* Big Shutter Button */}
              <button
                type="button"
                onClick={handleCaptureFromStream}
                className="w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-white border-4 border-emerald-500 shadow-xl flex items-center justify-center active:scale-90 transition-transform group"
                aria-label="Take Photo"
              >
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-600 group-hover:bg-emerald-500 transition-colors flex items-center justify-center">
                  <Camera className="w-7 h-7 text-white" />
                </div>
              </button>

              <button
                type="button"
                onClick={stopLiveCamera}
                className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-md border border-white/25 text-white flex items-center justify-center hover:bg-black/80"
                title="Done"
              >
                <Check className="w-5 h-5 text-emerald-400" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Guided Multi-Photo Slots Grid (Section 4.1) */}
      {!activeCamera && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-ink uppercase tracking-wider">
              {locale === 'ur' ? 'پودے کے حصے منتخب کریں' : 'Guided Organ Slots'}
            </h3>
            <span className="text-[11px] font-bold text-ink/60">
              {locale === 'ur' ? 'صرف ایک تصویر بھی کافی ہے' : '1 photo is enough'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {SLOTS.map((slot) => {
              const photo = photos[slot.key];
              const IconComp = slot.icon;
              const hasPhoto = Boolean(photo);

              return (
                <div
                  key={slot.key}
                  className={`relative rounded-2xl p-3 border transition-all ${
                    hasPhoto
                      ? 'bg-emerald-50/70 border-emerald-500/50 shadow-sm'
                      : 'bg-white hover:bg-canvas border-olive/20'
                  }`}
                >
                  {/* Photo Thumbnail or Empty Slot Placeholder */}
                  {hasPhoto && photo ? (
                    <div className="relative aspect-square rounded-xl overflow-hidden mb-2 bg-ink/5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.thumbnailDataUrl}
                        alt={slot.labelEn}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removePhoto(slot.key);
                        }}
                        className="absolute top-1 end-1 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>

                      {/* Quality indicator badge */}
                      <div className="absolute bottom-1 start-1">
                        {photo.quality.isAcceptable ? (
                          <div className="px-1.5 py-0.5 rounded-md bg-emerald-600/90 text-white text-[10px] font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>OK</span>
                          </div>
                        ) : (
                          <div className="px-1.5 py-0.5 rounded-md bg-amber-600/90 text-white text-[10px] font-bold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => startLiveCamera(slot.key)}
                      className="aspect-square rounded-xl border-2 border-dashed border-olive/30 hover:border-olive flex flex-col items-center justify-center cursor-pointer mb-2 bg-canvas/60 group"
                    >
                      <div className="w-10 h-10 rounded-full bg-olive/10 group-hover:bg-olive text-olive group-hover:text-white flex items-center justify-center transition-colors mb-1">
                        <Camera className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-bold text-ink/60">
                        {locale === 'ur' ? 'تصویر لیں' : 'Capture'}
                      </span>
                    </div>
                  )}

                  {/* Title & Spoken Tip Audio Button */}
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-black text-ink truncate">
                      {locale === 'ur' ? slot.labelUr : slot.labelEn}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        speakText(
                          locale === 'ur' ? slot.tipUr : slot.tipEn,
                          locale
                        );
                      }}
                      className="w-6 h-6 rounded-full bg-olive/10 hover:bg-olive/20 text-olive flex items-center justify-center flex-shrink-0"
                      title="Listen Tip"
                    >
                      <Volume2 className="w-3 h-3" />
                    </button>
                  </div>

                  {slot.isOptional && (
                    <span className="text-[10px] font-bold text-ink/45 block">
                      {locale === 'ur' ? '(اختیاری)' : '(Optional)'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Roots Special Agronomy Instruction Banner (Section 4.1) */}
          <div className="rounded-2xl p-3.5 bg-amber-500/10 border border-alert-amber/40 text-ink flex items-start gap-2.5">
            <Info className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <span className="font-extrabold text-amber-900 block mb-0.5">
                {locale === 'ur' ? 'جڑوں کے معائنے کی خاص ہدایت:' : 'Root Photo Rule:'}
              </span>
              <p className="text-ink/80">
                {locale === 'ur'
                  ? 'متاثرہ پودے کو احتیاط سے اکھاڑیں، مٹی جھاڑ لیں، ممکن ہو تو پانی سے دھوئیں اور جڑوں کی تصویر لیں۔ صحت مند پودا ہرگز مت اکھاڑیں۔'
                  : 'Gently pull one affected plant, shake off the soil, wash if possible, then photograph the roots. Never pull healthy plants.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Questions Sheet (Section 4.3) */}
      <AnimatePresence>
        {showQuestionsStep && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            className="rounded-3xl p-5 bg-white border-2 border-olive/30 shadow-soft space-y-4 text-start"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-ink">
                  {locale === 'ur'
                    ? 'فوری زرعی سوالات (اختیاری)'
                    : 'Quick Farm Questions (Optional)'}
                </h3>
                <p className="text-xs text-ink/65">
                  {locale === 'ur'
                    ? 'صرف 5 سیکنڈ میں بیماری کی تصدیق میں مدد ملتی ہے'
                    : 'Answers help AI diagnose with higher accuracy'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSkipQuestionsAndAnalyze}
                className="text-xs font-bold text-olive hover:underline"
              >
                {locale === 'ur' ? 'چھوڑ دیں' : 'Skip'}
              </button>
            </div>

            {/* Q1: Which crop is this? */}
            <div className="space-y-1.5">
              <label className="text-xs font-extrabold text-ink">
                {locale === 'ur' ? '1۔ یہ کون سی فصل ہے؟' : '1. Which crop is this?'}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {CROPS_LIST.slice(0, 6).map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSelectedCrop(c.key)}
                    className={`min-h-[40px] px-2 py-1 rounded-xl text-xs font-extrabold border transition-all ${
                      selectedCrop === c.key
                        ? 'bg-olive text-white border-olive'
                        : 'bg-canvas text-ink border-olive/20 hover:border-olive/50'
                    }`}
                  >
                    {locale === 'ur' ? c.ur : c.en}
                  </button>
                ))}
              </div>
            </div>

            {/* Q2: When did it start? */}
            <div className="space-y-1.5">
              <label className="text-xs font-extrabold text-ink">
                {locale === 'ur'
                  ? '2۔ مسئلہ پہلی بار کب دیکھا گیا؟'
                  : '2. When did it start?'}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  {
                    key: '1_to_2_days' as const,
                    ur: '1 سے 2 دن',
                    en: '1-2 days',
                  },
                  {
                    key: 'this_week' as const,
                    ur: 'اس ہفتے',
                    en: 'This week',
                  },
                  {
                    key: 'longer' as const,
                    ur: 'اس سے پرانا',
                    en: 'Longer ago',
                  },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setDuration(item.key)}
                    className={`min-h-[40px] px-2 py-1 rounded-xl text-xs font-bold border transition-all ${
                      duration === item.key
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-canvas text-ink border-olive/20 hover:border-olive/50'
                    }`}
                  >
                    {locale === 'ur' ? item.ur : item.en}
                  </button>
                ))}
              </div>
            </div>

            {/* Q3: How many plants affected? */}
            <div className="space-y-1.5">
              <label className="text-xs font-extrabold text-ink">
                {locale === 'ur'
                  ? '3۔ کتنے پودے متاثر ہیں؟'
                  : '3. How many plants affected?'}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  {
                    key: 'few_plants' as const,
                    ur: 'چند ایک پودے',
                    en: 'A few plants',
                  },
                  {
                    key: 'many_plants' as const,
                    ur: 'کافی پودے',
                    en: 'Many plants',
                  },
                  {
                    key: 'whole_field' as const,
                    ur: 'پورا کھیت',
                    en: 'Whole field',
                  },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSpread(item.key)}
                    className={`min-h-[40px] px-2 py-1 rounded-xl text-xs font-bold border transition-all ${
                      spread === item.key
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-canvas text-ink border-olive/20 hover:border-olive/50'
                    }`}
                  >
                    {locale === 'ur' ? item.ur : item.en}
                  </button>
                ))}
              </div>
            </div>

            {/* Q4: Recent rain, irrigation, spray or fertilizer? */}
            <div className="space-y-1.5">
              <label className="text-xs font-extrabold text-ink">
                {locale === 'ur'
                  ? '4۔ حالیہ بارش، پانی، سپرے یا کھاد دی؟'
                  : '4. Recent rain, spray or fertilizer?'}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { key: 'yes' as const, ur: 'جی ہاں', en: 'Yes' },
                  { key: 'no' as const, ur: 'نہیں', en: 'No' },
                  { key: 'not_sure' as const, ur: 'یقین نہیں', en: 'Not sure' },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setRecentEvents(item.key)}
                    className={`min-h-[40px] px-2 py-1 rounded-xl text-xs font-bold border transition-all ${
                      recentEvents === item.key
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-canvas text-ink border-olive/20 hover:border-olive/50'
                    }`}
                  >
                    {locale === 'ur' ? item.ur : item.en}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Bottom Sticky Action Button */}
      {!activeCamera && (
        <div className="pt-2">
          <button
            type="button"
            disabled={capturedCount === 0 || isAnalysing}
            onClick={handleProceed}
            className={`w-full min-h-[54px] rounded-full font-black text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg transition-all ${
              capturedCount > 0 && !isAnalysing
                ? 'bg-gradient-to-r from-olive to-emerald-600 hover:from-olive-dark hover:to-emerald-700 text-white cursor-pointer active:scale-[0.98]'
                : 'bg-ink/20 text-ink/40 cursor-not-allowed'
            }`}
          >
            <Sparkles className="w-5 h-5 text-emerald-300" />
            <span>
              {isAnalysing
                ? locale === 'ur'
                  ? 'معائنہ جاری ہے...'
                  : 'Analysing Plant...'
                : showQuestionsStep
                ? locale === 'ur'
                  ? 'رپورٹ تیار کریں'
                  : 'Generate Diagnosis Report'
                : locale === 'ur'
                ? `پودے کا معائنہ شروع کریں (${capturedCount} تصویر)`
                : `Analyze Plant Now (${capturedCount} Photo)`}
            </span>
            <ChevronRight className="w-5 h-5 rtl:rotate-180" />
          </button>
        </div>
      )}

      {/* Quality Advisory Modal (Section 4.2 - Never Hard Blocks!) */}
      <AnimatePresence>
        {pendingQualityPhoto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl border-2 border-alert-amber text-start space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center text-alert-amber flex-shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-ink">
                    {locale === 'ur'
                      ? 'تصویر کے معیار کا انتباہ'
                      : 'Photo Quality Warning'}
                  </h4>
                  <p className="text-xs text-ink/75 mt-1 leading-relaxed">
                    {locale === 'ur'
                      ? pendingQualityPhoto.quality.friendlyMessageUr ||
                        'تصویر تھوڑی دھندلی ہو سکتی ہے۔'
                      : pendingQualityPhoto.quality.friendlyMessageEn ||
                        'Photo might be blurry or poorly lit.'}
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-ink/60 bg-canvas p-2.5 rounded-xl">
                {locale === 'ur'
                  ? 'صاف تصویر سے تشخیص کا نتیجہ زیادہ درست آتا ہے۔ تاہم آپ چاہیں تو اسی تصویر پر بھی آگے بڑھ سکتے ہیں۔'
                  : 'Clear photos give more accurate diagnoses. You can always proceed if you cannot retake.'}
              </p>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPendingQualityPhoto(null);
                    startLiveCamera(pendingQualityPhoto.slot);
                  }}
                  className="min-h-[46px] rounded-full border border-olive/30 text-ink font-bold text-xs hover:bg-canvas flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-4 h-4 text-olive" />
                  <span>{locale === 'ur' ? 'دوبارہ لیں' : 'Retake'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => commitPhoto(pendingQualityPhoto)}
                  className="min-h-[46px] rounded-full bg-olive text-white font-extrabold text-xs hover:bg-olive-dark flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  <span>
                    {locale === 'ur' ? 'یہی استعمال کریں' : 'Use This Photo'}
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

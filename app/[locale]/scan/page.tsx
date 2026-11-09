'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Camera,
  Upload,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Sun,
  Leaf,
  X,
  Volume2,
  Sparkles,
  Layers,
  Sprout,
  CircleDot,
  Apple,
  ShieldAlert,
  ArrowRight,
  Info,
  Check,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';
import { CropDiagnosis, Advice } from '@/lib/schemas';
import { getSavedProfile, saveScanRecord } from '@/lib/supabase/client';
import { speakText, stopSpeaking, unlockAudio } from '@/lib/voice';
import { GuestPromptSheet } from '@/components/auth/GuestPromptSheet';
import {
  compressAndAssessLeafImage,
  ImageQualityReport,
} from '@/lib/image-quality';

/**
 * Zarkhez Two-Stage Intelligent Crop Scanner:
 * 1. Independent Image & Crop Recognition: Never forces user-selected crop.
 * 2. Visual Plant Part Detection: Leaf, Stem, Roots, Fruit, Flower, Whole Plant.
 * 3. Crop Mismatch Protection: Warns if selected crop doesn't match actual image.
 * 4. Evidence-based Agricultural Diagnosis & Safe Treatment Advice in Urdu & English.
 */
export default function ScanPage() {
  const t = useTranslations('scan');
  const tApp = useTranslations('app');
  const locale = useLocale() as 'ur' | 'en';
  const router = useRouter();

  const [selectedCrop, setSelectedCrop] = useState<string>('wheat');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [analysing, setAnalysing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<CropDiagnosis | null>(null);
  const [savedToDiary, setSavedToDiary] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);

  // Quality check state
  const [pendingQualityData, setPendingQualityData] = useState<{
    fileOrUrl: File | string;
    quality: ImageQualityReport;
  } | null>(null);

  // Live mobile camera stream state
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const supportedCrops = [
    { key: 'wheat', en: 'Wheat', ur: 'گندم' },
    { key: 'rice', en: 'Rice', ur: 'دھان (چاول)' },
    { key: 'cotton', en: 'Cotton', ur: 'کپاس' },
    { key: 'maize', en: 'Maize', ur: 'مکئی' },
    { key: 'sugarcane', en: 'Sugarcane', ur: 'کماد (گنا)' },
    { key: 'tomato', en: 'Tomato', ur: 'ٹماٹر' },
    { key: 'potato', en: 'Potato', ur: 'آلو' },
    { key: 'chili', en: 'Chili', ur: 'مرچ' },
    { key: 'mango', en: 'Mango', ur: 'آم' },
    { key: 'citrus', en: 'Citrus', ur: 'کنو / مالٹا' },
    { key: 'onion', en: 'Onion', ur: 'پیاز' },
  ] as const;

  const organGuides = [
    { icon: Leaf, ur: 'پتا', en: 'Leaf' },
    { icon: Sprout, ur: 'تنا یا شاخ', en: 'Stem' },
    { icon: CircleDot, ur: 'جڑیں', en: 'Roots' },
    { icon: Apple, ur: 'پھل / پھول', en: 'Fruit/Flower' },
    { icon: Layers, ur: 'پورا پودا', en: 'Whole plant' },
  ];

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopSpeaking();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, []);

  const handleOpenCamera = async () => {
    unlockAudio();
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
        setCameraActive(true);
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        }, 60);
        return;
      } catch {
        // Fallback to native file input with capture="environment"
      }
    }
    cameraInputRef.current?.click();
  };

  const handleCaptureFromLiveVideo = () => {
    unlockAudio();
    if (!videoRef.current) return;
    const video = videoRef.current;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      stopCameraStream();
      checkAndRunPipeline(dataUrl, selectedCrop);
    }
  };

  const checkAndRunPipeline = async (
    fileOrDataUrl: File | string,
    cropKey: string
  ) => {
    try {
      // OffscreenCanvas Quality Check (blur & lighting)
      const compressed = await compressAndAssessLeafImage(fileOrDataUrl);
      if (!compressed.quality.isAcceptable) {
        setPendingQualityData({
          fileOrUrl: compressed.fullDataUrl,
          quality: compressed.quality,
        });
        return;
      }
      runAnalysisPipeline(compressed.fullDataUrl, cropKey, false);
    } catch {
      runAnalysisPipeline(fileOrDataUrl, cropKey, false);
    }
  };

  const runAnalysisPipeline = async (
    fileOrDataUrl: File | string,
    cropKey: string,
    confirmMismatchOverride = false
  ) => {
    unlockAudio();
    setPendingQualityData(null);
    setErrorMsg(null);
    setAnalysing(true);
    setDiagnosis(null);
    setSavedToDiary(false);

    try {
      const compressed = await compressAndAssessLeafImage(fileOrDataUrl);
      setPreviewUrl(compressed.fullDataUrl);
      setThumbnailUrl(compressed.thumbnailDataUrl);

      // Two-Stage Gemini Vision Analysis (/api/scan/analyze)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 22000);

      const res = await fetch('/api/scan/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: compressed.fullDataUrl,
          selectedCrop: cropKey,
          confirmMismatchOverride,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const diagData: CropDiagnosis = await res.json();
      setDiagnosis(diagData);

      // Spoken Urdu Voice Readout
      const profile = getSavedProfile();
      if (profile.autoSpeakVoice !== false) {
        let speechText = '';
        if (diagData.diagnosis_status === 'crop_mismatch') {
          speechText = diagData.message[locale];
        } else if (diagData.diagnosis_status === 'invalid_image') {
          speechText = diagData.message[locale];
        } else {
          const cropPartIntro = `${diagData.detected_crop_ur} کے ${diagData.detected_plant_part_ur} کا معائنہ۔ `;
          const prob = `${diagData.problem_name[locale]}۔ `;
          const condition = `${diagData.plant_condition_ur}۔ `;
          const stepsIntro =
            diagData.recommendations.length > 0
              ? `سفارشات: ${diagData.recommendations
                  .map((r, i) => `${i + 1}۔ ${r[locale]}`)
                  .join(' ')}`
              : '';
          speechText = `${cropPartIntro}${prob}${condition}${stepsIntro}`;
        }

        setTimeout(() => {
          speakText(speechText, locale);
        }, 150);
      }

      if (!profile.isAuthenticated) {
        setTimeout(() => setShowGuestPrompt(true), 2800);
      }
    } catch (err) {
      console.error('Scan error:', err);
      setErrorMsg(
        locale === 'ur'
          ? 'معائنہ مکمل نہیں ہو سکا۔ براہِ کرم انٹرنیٹ کنکشن چیک کر کے دوبارہ کوشش کریں۔'
          : 'Analysis could not be completed. Please check connection and retry.'
      );
    } finally {
      setAnalysing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    unlockAudio();
    const file = e.target.files?.[0];
    if (!file) return;
    checkAndRunPipeline(file, selectedCrop);
    e.target.value = '';
  };

  const handleConfirmMismatch = () => {
    if (!previewUrl || !diagnosis) return;
    // User confirms the AI-detected crop
    setSelectedCrop(diagnosis.detected_crop);
    runAnalysisPipeline(previewUrl, diagnosis.detected_crop, true);
  };

  const handleSaveToDiary = async () => {
    if (!diagnosis || savedToDiary) return;

    const legacyAdvice: Advice = {
      problem_name: diagnosis.problem_name,
      plant_name: {
        en: diagnosis.detected_crop,
        ur: diagnosis.detected_crop_ur,
      },
      organ: {
        en: diagnosis.detected_plant_part,
        ur: diagnosis.detected_plant_part_ur,
      },
      confidence: diagnosis.identification_confidence,
      severity:
        diagnosis.severity === 'not_assessed' ? 'low' : diagnosis.severity,
      summary: diagnosis.message,
      steps:
        diagnosis.recommendations.length > 0
          ? diagnosis.recommendations
          : [
              {
                en: 'Continue routine scouting.',
                ur: 'معمول کی دیکھ بھال جاری رکھیں۔',
              },
            ],
      prevention:
        diagnosis.prevention.length > 0
          ? diagnosis.prevention
          : [
              {
                en: 'Maintain clean field borders.',
                ur: 'کھیت کی وٹیں صاف رکھیں۔',
              },
            ],
      see_expert: diagnosis.requires_expert_review,
      expert_reason: diagnosis.requires_expert_review
        ? {
            en: 'Condition requires field extension officer inspection.',
            ur: 'اس کیفیت کے لیے فیلڈ زرعی توسیعی افسر سے معائنہ ضروری ہے۔',
          }
        : undefined,
    };

    await saveScanRecord({
      crop: diagnosis.detected_crop,
      selected_crop: diagnosis.selected_crop,
      detected_crop: diagnosis.detected_crop,
      plant_part: diagnosis.detected_plant_part,
      diagnosis_status: diagnosis.diagnosis_status,
      thumbnailDataUrl: thumbnailUrl || previewUrl || '',
      label: diagnosis.problem_name.en,
      confidence: diagnosis.identification_confidence,
      advice: legacyAdvice,
    });

    setSavedToDiary(true);
  };

  const resetScan = () => {
    stopSpeaking();
    stopCameraStream();
    setPreviewUrl(null);
    setThumbnailUrl('');
    setDiagnosis(null);
    setSavedToDiary(false);
    setErrorMsg(null);
    setPendingQualityData(null);
  };

  const spokenDiagnosisText = diagnosis
    ? diagnosis.diagnosis_status === 'crop_mismatch'
      ? diagnosis.message[locale]
      : `${diagnosis.detected_crop_ur} کے ${diagnosis.detected_plant_part_ur} کا معائنہ۔ ${
          diagnosis.problem_name[locale]
        }۔ ${diagnosis.plant_condition_ur}۔ ${diagnosis.recommendations
          .map((r, i) => `${i + 1}۔ ${r[locale]}`)
          .join(' ')}`
    : '';

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas overflow-x-hidden">
      {/* Top Header */}
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

        <div className="mt-3.5">
          <h1 className="font-extrabold text-xl sm:text-2xl text-white">
            {locale === 'ur'
              ? 'فصل کا اے آئی ڈاکٹر (خودکار شناخت)'
              : 'Smart Crop Scanner'}
          </h1>
          <p className="text-xs text-cream font-medium mt-0.5">
            {locale === 'ur'
              ? 'پتا، تنا، جڑ، پھل یا پورا پودا — اے آئی خود فصل اور حصے کی درست شناخت کرے گی'
              : 'Two-stage vision: Independently detects crop, plant part, and symptoms'}
          </p>
        </div>
      </header>

      <main className="px-4 sm:px-5 mt-4 space-y-4 max-w-md mx-auto">
        {/* Step A: User Crop Selector (Treated as user input, NOT visual proof) */}
        {!diagnosis && !analysing && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-3.5 shadow-soft border border-olive/15 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <label className="font-extrabold text-xs text-ink flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-olive" />
                <span>
                  {locale === 'ur'
                    ? '1۔ آپ کی منتخب کردہ فصل:'
                    : '1. Your Selected Crop:'}
                </span>
              </label>
              <span className="text-[10px] font-bold text-ink/55 bg-canvas px-2 py-0.5 rounded-full">
                {locale === 'ur' ? 'کسان کا انتخاب' : 'Farmer input'}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {supportedCrops.slice(0, 8).map((c) => {
                const active = selectedCrop.toLowerCase() === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSelectedCrop(c.key)}
                    className={`min-h-[40px] rounded-xl font-extrabold text-xs transition-all border ${
                      active
                        ? 'bg-[#062409] text-white border-[#062409] shadow-sm'
                        : 'bg-canvas text-ink/80 hover:bg-olive/15 border-olive/15'
                    }`}
                  >
                    <span>{c[locale]}</span>
                  </button>
                );
              })}
            </div>
          </motion.section>
        )}

        {/* 1-Image Primary Capture Frame */}
        {!diagnosis && !analysing && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-4 sm:p-5 shadow-soft border border-olive/15 space-y-4"
          >
            {/* Viewfinder Window */}
            <div className="relative h-64 sm:h-72 rounded-2xl bg-[#062409] overflow-hidden flex flex-col items-center justify-center p-4 text-white shadow-inner">
              {cameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="relative z-10 w-48 h-48 border-2 border-dashed border-emerald-400 rounded-3xl pointer-events-none flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping absolute" />
                    <div className="w-2 h-2 rounded-full bg-emerald-400 absolute" />
                  </div>

                  <div className="absolute bottom-3 inset-x-0 z-20 flex items-center justify-center gap-4">
                    <button
                      type="button"
                      onClick={stopCameraStream}
                      className="w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                      aria-label="Cancel"
                    >
                      <X className="w-5 h-5" />
                    </button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.92 }}
                      onClick={handleCaptureFromLiveVideo}
                      className="px-6 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm shadow-lg border-2 border-white flex items-center gap-2"
                    >
                      <Camera className="w-4 h-4" />
                      <span>
                        {locale === 'ur' ? 'تصویر کھینچیں' : 'Capture Photo'}
                      </span>
                    </motion.button>
                  </div>
                </>
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://images.unsplash.com/photo-1592841200221-a6898f307baa?auto=format&fit=crop&w=800&q=70"
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover opacity-25"
                  />
                  <div className="relative z-10 text-center space-y-2 p-2">
                    <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md border border-white/20 mx-auto flex items-center justify-center">
                      <Sparkles className="w-8 h-8 text-emerald-400" />
                    </div>
                    <p className="font-black text-sm text-white">
                      {locale === 'ur'
                        ? 'کسی بھی ایک حصے کی 1 واضح تصویر لیں'
                        : 'Take 1 Clear Plant Photo'}
                    </p>
                    <p className="text-xs text-cream/80 max-w-[260px] mx-auto leading-relaxed">
                      {locale === 'ur'
                        ? 'پتا، تنا، جڑیں، پھل یا پورا پودا — اے آئی خود فصل اور حصے کی درست شناخت کرے گی'
                        : 'Leaf, stem, roots, fruit or whole plant — AI will independently identify crop & part'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Supported Organ Chips */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-extrabold text-ink/65 uppercase tracking-wider block">
                {locale === 'ur' ? 'قابل قبول حصے:' : 'Acceptable plant parts:'}
              </span>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold text-ink/80">
                {organGuides.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={idx}
                      className="px-2.5 py-1 rounded-full bg-canvas border border-olive/20 flex items-center gap-1.5 flex-shrink-0"
                    >
                      <Icon className="w-3.5 h-3.5 text-olive" />
                      <span>{locale === 'ur' ? item.ur : item.en}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Hidden File Inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* 1 Big Camera + 1 Gallery Button */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={handleOpenCamera}
                className="min-h-[52px] rounded-full bg-[#062409] hover:bg-olive-dark text-white font-black text-sm sm:text-base shadow-soft flex items-center justify-center gap-2.5 transition-all"
              >
                <Camera className="w-5 h-5 text-emerald-400" />
                <span>
                  {locale === 'ur' ? 'کیمرے سے تصویر لیں' : 'Take Plant Photo'}
                </span>
              </motion.button>

              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  unlockAudio();
                  uploadInputRef.current?.click();
                }}
                className="min-h-[52px] rounded-full bg-olive hover:bg-olive-dark text-white font-extrabold text-sm sm:text-base shadow-soft flex items-center justify-center gap-2.5 transition-all"
              >
                <Upload className="w-5 h-5 text-white" />
                <span>
                  {locale === 'ur'
                    ? 'گیلری سے تصویر منتخب کریں'
                    : 'Upload From Gallery'}
                </span>
              </motion.button>
            </div>
          </motion.section>
        )}

        {/* Quality Check Advisory Modal */}
        <AnimatePresence>
          {pendingQualityData && (
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
                        ? pendingQualityData.quality.friendlyMessageUr ||
                          'تصویر تھوڑی دھندلی ہے۔'
                        : pendingQualityData.quality.friendlyMessageEn ||
                          'Photo might be blurry.'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingQualityData(null);
                      handleOpenCamera();
                    }}
                    className="min-h-[46px] rounded-full border border-olive/30 text-ink font-bold text-xs hover:bg-canvas flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4 text-olive" />
                    <span>{locale === 'ur' ? 'دوبارہ لیں' : 'Retake'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      runAnalysisPipeline(
                        pendingQualityData.fileOrUrl,
                        selectedCrop,
                        false
                      )
                    }
                    className="min-h-[46px] rounded-full bg-olive text-white font-extrabold text-xs hover:bg-olive-dark flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    <span>
                      {locale === 'ur' ? 'یہی استعمال کریں' : 'Use Anyway'}
                    </span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Loading Radar Sweep */}
        <AnimatePresence>
          {analysing && (
            <motion.section
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-7 shadow-soft border border-olive/15 flex flex-col items-center text-center space-y-5"
            >
              <div className="relative w-44 h-44 rounded-3xl overflow-hidden border-4 border-emerald-500/40 shadow-lg flex items-center justify-center bg-[#062409]">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Scanning"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Leaf className="w-12 h-12 text-emerald-400 animate-pulse" />
                )}
                <motion.div
                  animate={{ top: ['6%', '88%', '6%'] }}
                  transition={{
                    duration: 1.8,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="absolute inset-x-2 h-1 bg-emerald-400 shadow-[0_0_14px_#4ade80] rounded-full"
                />
              </div>
              <div className="space-y-1">
                <h2 className="font-black text-lg text-ink">
                  {locale === 'ur'
                    ? 'پودے کا خودکار وژن معائنہ جاری ہے...'
                    : 'AI Vision analyzing plant...'}
                </h2>
                <p className="text-xs text-ink/70">
                  {locale === 'ur'
                    ? 'فصل کی حقیقی شناخت، پودے کا حصہ اور علامات جانچی جا رہی ہیں'
                    : 'Independently verifying crop species, plant organ & symptoms'}
                </p>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Error State */}
        {errorMsg && (
          <div className="bg-alert-red/10 border border-alert-red/35 rounded-2xl p-4 text-sm text-ink space-y-3">
            <p>{errorMsg}</p>
            <button
              type="button"
              onClick={resetScan}
              className="min-h-[44px] px-4 py-2 rounded-full bg-alert-red text-white font-bold text-xs"
            >
              {tApp('retry')}
            </button>
          </div>
        )}

        {/* CASE 1: CROP MISMATCH SCREEN (Section 1 & 9) */}
        {diagnosis && diagnosis.diagnosis_status === 'crop_mismatch' && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-5 sm:p-6 shadow-soft border-2 border-amber-500 text-start space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 flex items-center justify-center text-amber-700 flex-shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[11px] font-black uppercase text-amber-700 bg-amber-500/10 px-2.5 py-0.5 rounded-full inline-block mb-1">
                  {locale === 'ur' ? 'فصل کی عدم مطابقت' : 'Crop Mismatch Detected'}
                </span>
                <h3 className="font-black text-base sm:text-lg text-ink">
                  {locale === 'ur'
                    ? 'منتخب کردہ فصل اور تصویر میں فرق ہے'
                    : 'Image does not match selected crop'}
                </h3>
              </div>
            </div>

            {/* Comparison Cards */}
            <div className="grid grid-cols-2 gap-2 bg-canvas p-3 rounded-2xl border border-olive/15 text-xs">
              <div className="p-2 rounded-xl bg-white/80 border border-amber-500/30">
                <span className="text-[10px] font-bold text-ink/50 block">
                  {locale === 'ur' ? 'آپ نے منتخب کی:' : 'You Selected:'}
                </span>
                <span className="font-extrabold text-sm text-ink block mt-0.5">
                  {diagnosis.selected_crop}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-500/40">
                <span className="text-[10px] font-bold text-emerald-800 block">
                  {locale === 'ur' ? 'اے آئی نے تصویر میں دیکھا:' : 'AI Detected in Photo:'}
                </span>
                <span className="font-extrabold text-sm text-emerald-900 block mt-0.5">
                  {diagnosis.detected_crop_ur} ({diagnosis.detected_plant_part_ur})
                </span>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-ink/85 leading-relaxed bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 font-medium">
              {diagnosis.message[locale]}
            </p>

            <p className="text-[11px] text-ink/65 leading-relaxed">
              {locale === 'ur'
                ? 'اہم حفاظتی اصول: زرخیز غلط فصل کا علاج تجویز نہیں کرتا تاکہ فصل کو نقصان نہ پہنچے۔ آپ تصویر میں نظر آنے والی فصل کی تصدیق کر کے درست معائنہ حاصل کر سکتے ہیں۔'
                : 'Safety rule: Zarkhez prevents diagnosing one crop as another. Please confirm the detected crop to proceed.'}
            </p>

            {/* Decision Buttons */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handleConfirmMismatch}
                className="w-full min-h-[50px] rounded-full bg-gradient-to-r from-emerald-600 to-olive hover:from-emerald-700 hover:to-olive-dark text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
              >
                <Check className="w-4 h-4" />
                <span>
                  {locale === 'ur'
                    ? `جی ہاں، یہ ${diagnosis.detected_crop_ur} ہے (تشخیص جاری رکھیں)`
                    : `Yes, this is ${diagnosis.detected_crop} (Continue)`}
                </span>
              </button>

              <button
                type="button"
                onClick={resetScan}
                className="w-full min-h-[46px] rounded-full bg-canvas hover:bg-ink/10 text-ink font-bold text-xs flex items-center justify-center gap-2 border border-olive/20 transition-all"
              >
                <RotateCcw className="w-4 h-4 text-ink/60" />
                <span>
                  {locale === 'ur'
                    ? 'دوسری تصویر لیں یا فصل تبدیل کریں'
                    : 'Retake Photo / Select Different Crop'}
                </span>
              </button>
            </div>
          </motion.section>
        )}

        {/* CASE 2: INVALID IMAGE (NON-PLANT, SCREEN, OBJECT) */}
        {diagnosis && diagnosis.diagnosis_status === 'invalid_image' && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-5 sm:p-6 shadow-soft border-2 border-red-500/40 text-start space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-red-500/15 flex items-center justify-center text-red-600 flex-shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[11px] font-black uppercase text-red-600 bg-red-500/10 px-2.5 py-0.5 rounded-full inline-block mb-1">
                  {locale === 'ur' ? 'غیر متعلقہ تصویر' : 'Invalid Image'}
                </span>
                <h3 className="font-black text-base sm:text-lg text-ink">
                  {diagnosis.problem_name[locale]}
                </h3>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-ink/80 leading-relaxed bg-canvas p-3.5 rounded-2xl border border-olive/15">
              {diagnosis.message[locale]}
            </p>

            <button
              type="button"
              onClick={resetScan}
              className="w-full min-h-[50px] rounded-full bg-[#062409] hover:bg-olive-dark text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
            >
              <Camera className="w-4 h-4 text-emerald-400" />
              <span>
                {locale === 'ur'
                  ? 'اصلی پودے یا فصل کی تصویر لیں'
                  : 'Take Photo of Real Plant'}
              </span>
            </button>
          </motion.section>
        )}

        {/* CASE 3: COMPLETE STRUCTURED DIAGNOSTIC REPORT (Section 6) */}
        {diagnosis &&
          diagnosis.diagnosis_status !== 'crop_mismatch' &&
          diagnosis.diagnosis_status !== 'invalid_image' && (
            <motion.section
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-4 text-start"
            >
              {/* Expert Review Advisory Banner */}
              {diagnosis.requires_expert_review && (
                <div className="bg-cream border-2 border-alert-amber rounded-2xl p-4 shadow-soft flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-alert-amber text-ink flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="flex-1 space-y-1 min-w-0">
                    <h4 className="font-black text-sm text-ink">
                      {t('expertBannerTitle')}
                    </h4>
                    <p className="text-xs text-ink/85 leading-relaxed">
                      {locale === 'ur'
                        ? 'علامات حساس ہیں یا سو فیصد واضح نہیں ہیں۔ کسی بھی کیمیائی سپرے سے قبل مقامی زرعی توسیعی افسر سے معائنہ کروائیں۔'
                        : 'Symptoms require on-site confirmation by your local agricultural extension officer before spraying.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Main Report Card */}
              <div className="bg-white rounded-3xl p-5 shadow-soft border border-olive/15 space-y-4">
                {/* Image & Header Details */}
                <div className="flex items-start gap-3.5">
                  {previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="Scanned plant"
                      className="w-20 h-20 rounded-2xl object-cover border-2 border-emerald-500/40 flex-shrink-0 shadow-sm"
                    />
                  )}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* AI-Detected Crop Badge */}
                      <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300/60">
                        {diagnosis.detected_crop_ur}
                      </span>

                      {/* Plant Part Badge */}
                      <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-olive/15 text-olive-dark">
                        {diagnosis.detected_plant_part_ur}
                      </span>

                      {/* Severity Badge */}
                      <span
                        className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${
                          diagnosis.severity === 'high'
                            ? 'bg-alert-red/15 text-alert-red'
                            : diagnosis.severity === 'medium'
                            ? 'bg-alert-amber/25 text-amber-900'
                            : 'bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {diagnosis.severity === 'high'
                          ? t('severityHigh')
                          : diagnosis.severity === 'medium'
                          ? t('severityMedium')
                          : t('severityLow')}
                      </span>
                    </div>

                    <h2 className="font-black text-lg sm:text-xl text-ink leading-tight">
                      {diagnosis.problem_name[locale]}
                    </h2>

                    <p className="text-xs font-bold text-ink/65">
                      {diagnosis.plant_condition_ur}
                    </p>
                  </div>
                </div>

                {/* Spoken Audio Banner (Reads Aloud in Fluent Human Urdu) */}
                <div className="rounded-2xl p-3.5 bg-gradient-to-r from-emerald-500/10 via-olive/10 to-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                      <Volume2 className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-black text-ink block">
                        {locale === 'ur'
                          ? 'اردو وائس خلاصہ:'
                          : 'Urdu Voice Summary:'}
                      </span>
                      <p className="text-[11px] text-ink/75 leading-tight">
                        {locale === 'ur'
                          ? 'مکمل تشخیص اور علاج سنیں'
                          : 'Listen to spoken diagnosis aloud'}
                      </p>
                    </div>
                  </div>

                  <ReadAloudButton text={spokenDiagnosisText} lang={locale} />
                </div>

                {/* Observed Symptoms */}
                {diagnosis.observed_symptoms &&
                  diagnosis.observed_symptoms.length > 0 && (
                    <div className="space-y-1.5 bg-canvas/80 p-3.5 rounded-2xl border border-olive/10">
                      <span className="text-[11px] font-black text-ink/60 uppercase block">
                        {locale === 'ur'
                          ? 'تصویر میں دیکھی گئی علامات:'
                          : 'Observed Symptoms in Image:'}
                      </span>
                      <ul className="space-y-1 text-xs text-ink/85 font-medium">
                        {diagnosis.observed_symptoms.map((sym, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-olive font-black">•</span>
                            <span>{sym[locale]}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {/* Practical Low-Cost Actions First (Cultural, Water, Sanitation) */}
                {diagnosis.recommendations &&
                  diagnosis.recommendations.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="font-black text-xs sm:text-sm text-ink flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>{t('stepsTitle')}</span>
                      </h3>
                      <ol className="space-y-2">
                        {diagnosis.recommendations.map((rec, i) => (
                          <li
                            key={i}
                            className="text-xs sm:text-sm text-ink bg-canvas/80 p-3 rounded-xl border border-olive/10 flex items-start gap-2.5"
                          >
                            <span className="w-5 h-5 rounded-full bg-olive text-white text-[11px] font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            <span className="leading-relaxed font-medium">
                              {rec[locale]}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                {/* Prevention */}
                {diagnosis.prevention && diagnosis.prevention.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-olive/10">
                    <h3 className="font-extrabold text-xs sm:text-sm text-ink flex items-center gap-1.5">
                      <Sun className="w-4 h-4 text-amber-600" />
                      <span>{t('preventionTitle')}</span>
                    </h3>
                    <ul className="space-y-1.5">
                      {diagnosis.prevention.map((pv, i) => (
                        <li
                          key={i}
                          className="text-xs text-ink/80 bg-canvas/60 p-2.5 rounded-xl border border-olive/10 flex items-start gap-2"
                        >
                          <span className="text-olive font-black">•</span>
                          <span>{pv[locale]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actions: Save to Farm Diary & Scan Another */}
                <div className="grid grid-cols-2 gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={handleSaveToDiary}
                    disabled={savedToDiary}
                    className={`min-h-[48px] rounded-full font-extrabold text-xs flex items-center justify-center gap-1.5 transition-all ${
                      savedToDiary
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-white hover:bg-canvas text-ink border-2 border-olive/30 shadow-sm'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>
                      {savedToDiary ? t('savedToDiary') : t('saveToDiary')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={resetScan}
                    className="min-h-[48px] rounded-full bg-gradient-to-r from-olive to-emerald-600 hover:from-olive-dark hover:to-emerald-700 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
                  >
                    <RotateCcw className="w-4 h-4 text-white" />
                    <span>
                      {locale === 'ur'
                        ? 'نیا پودا اسکین کریں'
                        : 'Scan Another Plant'}
                    </span>
                  </button>
                </div>
              </div>
            </motion.section>
          )}
      </main>

      <BottomNav />

      {/* Guest Prompt Sheet */}
      <GuestPromptSheet
        isOpen={showGuestPrompt}
        onClose={() => setShowGuestPrompt(false)}
        onGoogleSignIn={() => router.push('/profile')}
        onEmailSignIn={() => router.push('/profile')}
      />
    </div>
  );
}

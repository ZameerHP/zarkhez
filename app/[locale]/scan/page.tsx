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
import { CropDiagnosis, Advice, AppLang, getLocalizedText } from '@/lib/schemas';
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
  const [reportLang, setReportLang] = useState<AppLang>(locale === 'en' ? 'en' : 'ur');
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
          clientQuality: compressed.quality,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const diagData: CropDiagnosis = await res.json();
      setDiagnosis(diagData);

      // Spoken Voice Readout
      const profile = getSavedProfile();
      if (profile.autoSpeakVoice !== false) {
        let speechText = '';
        if (diagData.diagnosis_status === 'crop_mismatch') {
          speechText = getLocalizedText(diagData.message, reportLang);
        } else if (diagData.diagnosis_status === 'invalid_image') {
          speechText = getLocalizedText(diagData.message, reportLang);
        } else {
          const prob = getLocalizedText(diagData.problem_name, reportLang);
          const why = getLocalizedText(diagData.why_suspected, reportLang);
          const stepsIntro =
            diagData.recommendations.length > 0
              ? `سفارشات: ${diagData.recommendations
                  .map((r, i) => `${i + 1}۔ ${getLocalizedText(r, reportLang)}`)
                  .join(' ')}`
              : '';
          speechText = `${prob}۔ ${why}۔ ${stepsIntro}`;
        }

        setTimeout(() => {
          speakText(speechText, reportLang === 'en' ? 'en' : 'ur');
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
      ? getLocalizedText(diagnosis.message, reportLang)
      : `${getLocalizedText(diagnosis.problem_name, reportLang)}۔ ${getLocalizedText(
          diagnosis.why_suspected,
          reportLang
        )}۔ ${diagnosis.recommendations
          .map((r, i) => `${i + 1}۔ ${getLocalizedText(r, reportLang)}`)
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
              {/* Language Selector Bar (Urdu, Roman Urdu, Sindhi, English) */}
              <div className="bg-white rounded-2xl p-2 shadow-soft border border-olive/15 flex items-center justify-between gap-1">
                <span className="text-[11px] font-black text-ink/60 px-2">
                  {reportLang === 'ur'
                    ? 'زبان منتخب کریں:'
                    : reportLang === 'sd'
                    ? 'ٻولي چونڊيو:'
                    : reportLang === 'roman_ur'
                    ? 'Zuban Chunein:'
                    : 'Report Language:'}
                </span>
                <div className="flex items-center gap-1 overflow-x-auto">
                  {(
                    [
                      { key: 'ur', label: 'اردو' },
                      { key: 'roman_ur', label: 'Roman' },
                      { key: 'sd', label: 'سنڌي' },
                      { key: 'en', label: 'English' },
                    ] as const
                  ).map((langItem) => {
                    const active = reportLang === langItem.key;
                    return (
                      <button
                        key={langItem.key}
                        type="button"
                        onClick={() => {
                          unlockAudio();
                          setReportLang(langItem.key);
                        }}
                        className={`px-2.5 py-1 rounded-xl text-xs font-black transition-all ${
                          active
                            ? 'bg-[#062409] text-white shadow-sm'
                            : 'bg-canvas text-ink/70 hover:bg-olive/15'
                        }`}
                      >
                        {langItem.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Expert Review Advisory Banner */}
              {diagnosis.requires_expert_review && (
                <div className="bg-cream border-2 border-alert-amber rounded-2xl p-4 shadow-soft flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-alert-amber text-ink flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="flex-1 space-y-1 min-w-0">
                    <h4 className="font-black text-sm text-ink">
                      {reportLang === 'ur'
                        ? 'فیلڈ تصدیق کی سفارش'
                        : reportLang === 'sd'
                        ? 'ميداني تصديق جي سفارش'
                        : reportLang === 'roman_ur'
                        ? 'Field Tasdeeq ki Safarish'
                        : 'Field Expert Inspection Recommended'}
                    </h4>
                    <p className="text-xs text-ink/85 leading-relaxed">
                      {getLocalizedText(diagnosis.when_to_consult_expert, reportLang)}
                    </p>
                  </div>
                </div>
              )}

              {/* Main Report Card */}
              <div className="bg-white rounded-3xl p-5 shadow-soft border border-olive/15 space-y-4">
                {/* 1. Detected Crop, Plant Part, Stage, Confidence & Severity */}
                <div className="flex items-start gap-3.5">
                  {previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="Scanned plant"
                      className="w-20 h-20 rounded-2xl object-cover border-2 border-emerald-500/40 flex-shrink-0 shadow-sm"
                    />
                  )}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* AI-Detected Crop Badge */}
                      <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300/60">
                        {reportLang === 'en'
                          ? diagnosis.detected_crop
                          : reportLang === 'sd'
                          ? diagnosis.detected_crop_sd || diagnosis.detected_crop_ur
                          : reportLang === 'roman_ur'
                          ? diagnosis.detected_crop_roman_ur || diagnosis.detected_crop
                          : diagnosis.detected_crop_ur}
                      </span>

                      {/* Plant Part Badge */}
                      <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-olive/15 text-olive-dark">
                        {reportLang === 'en'
                          ? diagnosis.detected_plant_part
                          : reportLang === 'sd'
                          ? diagnosis.detected_plant_part_sd || diagnosis.detected_plant_part_ur
                          : reportLang === 'roman_ur'
                          ? diagnosis.detected_plant_part_roman_ur || diagnosis.detected_plant_part
                          : diagnosis.detected_plant_part_ur}
                      </span>

                      {/* Growth Stage Badge */}
                      {diagnosis.growth_stage && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-canvas text-ink/75 border border-olive/15">
                          {reportLang === 'en'
                            ? diagnosis.growth_stage
                            : reportLang === 'sd'
                            ? diagnosis.growth_stage_sd || diagnosis.growth_stage_ur
                            : reportLang === 'roman_ur'
                            ? diagnosis.growth_stage_roman_ur || diagnosis.growth_stage
                            : diagnosis.growth_stage_ur}
                        </span>
                      )}

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
                          ? reportLang === 'en'
                            ? 'High Severity'
                            : reportLang === 'sd'
                            ? 'تيز شدت'
                            : reportLang === 'roman_ur'
                            ? 'Zyada Shiddat'
                            : 'شدید شدت'
                          : diagnosis.severity === 'medium'
                          ? reportLang === 'en'
                            ? 'Medium Severity'
                            : reportLang === 'sd'
                            ? 'درمياني شدت'
                            : reportLang === 'roman_ur'
                            ? 'Darmiyani Shiddat'
                            : 'درمیانی شدت'
                          : reportLang === 'en'
                          ? 'Low / Normal'
                          : reportLang === 'sd'
                          ? 'گهٽ / معمول'
                          : reportLang === 'roman_ur'
                          ? 'Kam / Mamool'
                          : 'معمولی / تندرست'}
                      </span>
                    </div>

                    <h2 className="font-black text-lg sm:text-xl text-ink leading-tight">
                      {getLocalizedText(diagnosis.problem_name, reportLang)}
                    </h2>

                    {/* Confidence Level Pill */}
                    <div className="flex items-center gap-2 pt-0.5">
                      <div className="flex items-center gap-1 text-[11px] font-extrabold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        <Sparkles className="w-3 h-3 text-emerald-600" />
                        <span>
                          {Math.round(diagnosis.identification_confidence * 100)}%{' '}
                          {reportLang === 'en'
                            ? 'Confidence'
                            : reportLang === 'sd'
                            ? 'يقين'
                            : reportLang === 'roman_ur'
                            ? 'Yaqeen'
                            : 'اعتماد'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Spoken Audio Banner (Reads Aloud in Selected Language) */}
                <div className="rounded-2xl p-3.5 bg-gradient-to-r from-emerald-500/10 via-olive/10 to-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                      <Volume2 className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-black text-ink block">
                        {reportLang === 'en'
                          ? 'Voice Audio Summary:'
                          : reportLang === 'sd'
                          ? 'آواز ۾ ٻڌو:'
                          : reportLang === 'roman_ur'
                          ? 'Awaz mein sunein:'
                          : 'آواز میں خلاصہ سنیں:'}
                      </span>
                      <p className="text-[11px] text-ink/75 leading-tight">
                        {reportLang === 'en'
                          ? 'Listen to diagnosis and next steps'
                          : reportLang === 'sd'
                          ? 'تشخيص ۽ هدايتون ٻڌو'
                          : reportLang === 'roman_ur'
                          ? 'Tashkhees aur hidayat sunein'
                          : 'مکمل معائنہ اور زرعی مشورہ سنیں'}
                      </p>
                    </div>
                  </div>

                  <ReadAloudButton
                    text={spokenDiagnosisText}
                    lang={reportLang === 'en' ? 'en' : 'ur'}
                  />
                </div>

                {/* 2. Overall Condition */}
                <div className="bg-canvas/80 p-3.5 rounded-2xl border border-olive/15 space-y-1">
                  <span className="text-[11px] font-black text-ink/60 uppercase block">
                    {reportLang === 'en'
                      ? 'Overall Condition:'
                      : reportLang === 'sd'
                      ? 'مجموعي حالت:'
                      : reportLang === 'roman_ur'
                      ? 'Majmooi Halat:'
                      : 'پودے کی مجموعی حالت:'}
                  </span>
                  <p className="text-xs sm:text-sm text-ink/90 font-medium leading-relaxed">
                    {reportLang === 'en'
                      ? diagnosis.plant_condition
                      : reportLang === 'sd'
                      ? diagnosis.plant_condition_sd || diagnosis.plant_condition_ur
                      : reportLang === 'roman_ur'
                      ? diagnosis.plant_condition_roman_ur || diagnosis.plant_condition
                      : diagnosis.plant_condition_ur}
                  </p>
                </div>

                {/* 3. Visual Lesion & Symptom Inspection Details */}
                {diagnosis.visual_inspection && (
                  <div className="bg-canvas/80 p-3.5 rounded-2xl border border-olive/15 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-ink/60 uppercase flex items-center gap-1.5">
                        <Leaf className="w-3.5 h-3.5 text-olive" />
                        <span>
                          {reportLang === 'en'
                            ? 'Visual Lesion Inspection:'
                            : reportLang === 'sd'
                            ? 'پن جي نشانن جي چڪاس:'
                            : reportLang === 'roman_ur'
                            ? 'Dhabbun ka Basri Muaina:'
                            : 'دھبوں کا تفصیلی بصری معائنہ:'}
                        </span>
                      </span>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          diagnosis.visual_inspection.lesion_detected
                            ? 'bg-alert-red/15 text-alert-red'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {diagnosis.visual_inspection.lesion_detected
                          ? reportLang === 'en'
                            ? 'Lesions Visible'
                            : reportLang === 'sd'
                            ? 'نشان موجود آهن'
                            : reportLang === 'roman_ur'
                            ? 'Dhabbe Mojood Hain'
                            : 'مشتبہ دھبے موجود ہیں'
                          : reportLang === 'en'
                          ? 'Zero Lesions'
                          : reportLang === 'sd'
                          ? 'ڪوبه نشان ناهي'
                          : reportLang === 'roman_ur'
                          ? 'Koi Dhabba Nahi'
                          : 'کوئی دھبے نہیں'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-ink/85 pt-1">
                      <div className="p-2 rounded-xl bg-white border border-olive/10">
                        <span className="text-[10px] text-ink/50 font-bold block">
                          {reportLang === 'en'
                            ? 'Lesion Count / Density:'
                            : reportLang === 'sd'
                            ? 'نشانن جو تعداد:'
                            : reportLang === 'roman_ur'
                            ? 'Dhabbun ki Taadad:'
                            : 'دھبوں کی تعداد:'}
                        </span>
                        <span className="font-extrabold text-ink mt-0.5 block">
                          {diagnosis.visual_inspection.lesion_count}
                        </span>
                      </div>
                      <div className="p-2 rounded-xl bg-white border border-olive/10">
                        <span className="text-[10px] text-ink/50 font-bold block">
                          {reportLang === 'en'
                            ? 'Lesion Shape:'
                            : reportLang === 'sd'
                            ? 'نشانن جي شڪل:'
                            : reportLang === 'roman_ur'
                            ? 'Dhabbay ki Shakal:'
                            : 'دھبوں کی ساخت:'}
                        </span>
                        <span className="font-extrabold text-ink mt-0.5 block">
                          {diagnosis.visual_inspection.lesion_shape}
                        </span>
                      </div>
                    </div>

                    {diagnosis.visual_inspection.lesion_colors &&
                      diagnosis.visual_inspection.lesion_colors.length > 0 && (
                        <div className="text-[11px] text-ink/75 bg-white p-2 rounded-xl border border-olive/10">
                          <span className="text-[10px] text-ink/50 font-bold block">
                            {reportLang === 'en'
                              ? 'Observed Colors & Margins:'
                              : reportLang === 'sd'
                              ? 'رنگ ۽ ڪنارا:'
                              : reportLang === 'roman_ur'
                              ? 'Rung aur Kinare:'
                              : 'رنگت و حاشیہ:'}
                          </span>
                          <span className="font-bold text-ink mt-0.5 block">
                            {diagnosis.visual_inspection.lesion_colors.join(', ')}
                            {diagnosis.visual_inspection.lesion_margins !== 'none'
                              ? ` (${diagnosis.visual_inspection.lesion_margins})`
                              : ''}
                          </span>
                        </div>
                      )}
                  </div>
                )}

                {/* 4. Observed Symptoms List */}
                {diagnosis.observed_symptoms &&
                  diagnosis.observed_symptoms.length > 0 && (
                    <div className="space-y-1.5 bg-canvas/80 p-3.5 rounded-2xl border border-olive/10">
                      <span className="text-[11px] font-black text-ink/60 uppercase block">
                        {reportLang === 'en'
                          ? 'Observed Symptoms in Image:'
                          : reportLang === 'sd'
                          ? 'تصوير ۾ ڏٺل علامتون:'
                          : reportLang === 'roman_ur'
                          ? 'Tasveer mein dekhi gayi alamaat:'
                          : 'تصویر میں دیکھی گئی علامات:'}
                      </span>
                      <ul className="space-y-1 text-xs text-ink/85 font-medium">
                        {diagnosis.observed_symptoms.map((sym, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-olive font-black">•</span>
                            <span>{getLocalizedText(sym, reportLang)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {/* 5. Why AI Suspects It (Visual Diagnostic Evidence) */}
                {diagnosis.why_suspected && (
                  <div className="bg-emerald-500/10 p-3.5 rounded-2xl border border-emerald-500/25 space-y-1">
                    <span className="text-[11px] font-black text-emerald-950 uppercase flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                      <span>
                        {reportLang === 'en'
                          ? 'Why AI Suspects This Condition:'
                          : reportLang === 'sd'
                          ? 'اي آءِ ڇو هيءَ تشخيص ڪئي:'
                          : reportLang === 'roman_ur'
                          ? 'AI ne yeh tashkhees kyun ki:'
                          : 'اے آئی کو اس بیماری کا شبہ کیوں ہے:'}
                      </span>
                    </span>
                    <p className="text-xs sm:text-sm text-emerald-950 font-medium leading-relaxed">
                      {getLocalizedText(diagnosis.why_suspected, reportLang)}
                    </p>
                  </div>
                )}

                {/* 6. Alternative Diagnoses */}
                {diagnosis.alternative_diagnoses &&
                  diagnosis.alternative_diagnoses.length > 0 && (
                    <div className="bg-canvas/60 p-3 rounded-2xl border border-olive/10 space-y-1 text-xs">
                      <span className="text-[10px] font-black text-ink/60 uppercase block">
                        {reportLang === 'en'
                          ? 'Alternative Possibilities Checked:'
                          : reportLang === 'sd'
                          ? 'ٻيون امڪاني بيماريون:'
                          : reportLang === 'roman_ur'
                          ? 'Doosri imkani beemariyan:'
                          : 'دیگر امکانی بیماریوں کا تقابل:'}
                      </span>
                      {diagnosis.alternative_diagnoses.map((alt, i) => (
                        <div key={i} className="pt-1">
                          <span className="font-bold text-ink">
                            • {alt.name}:
                          </span>{' '}
                          <span className="text-ink/80">
                            {getLocalizedText(alt.reason, reportLang)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                {/* 7. Severity Explanation */}
                {diagnosis.severity_explanation && (
                  <div className="bg-canvas/50 p-2.5 rounded-xl border border-olive/10 text-xs text-ink/80 flex items-start gap-2">
                    <Info className="w-4 h-4 text-olive flex-shrink-0 mt-0.5" />
                    <span>{getLocalizedText(diagnosis.severity_explanation, reportLang)}</span>
                  </div>
                )}

                {/* 8. What To Do Now (Immediate Cultural & Protective Steps) */}
                {diagnosis.recommendations &&
                  diagnosis.recommendations.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="font-black text-xs sm:text-sm text-ink flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>
                          {reportLang === 'en'
                            ? 'What To Do Now (Recommended Steps):'
                            : reportLang === 'sd'
                            ? 'هاڻي ڇا ڪجي (عملي قدم):'
                            : reportLang === 'roman_ur'
                            ? 'Ab Kya Karein (Amli Iqdamaat):'
                            : 'ابھی کیا کریں (فوری عملی اقدامات):'}
                        </span>
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
                              {getLocalizedText(rec, reportLang)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                {/* 9. Prevention Advice */}
                {diagnosis.prevention && diagnosis.prevention.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-olive/10">
                    <h3 className="font-extrabold text-xs sm:text-sm text-ink flex items-center gap-1.5">
                      <Sun className="w-4 h-4 text-amber-600" />
                      <span>
                        {reportLang === 'en'
                          ? 'Prevention Advice (Next Season):'
                          : reportLang === 'sd'
                          ? 'ايندڙ سيزن لاءِ بچاءُ جا طريقا:'
                          : reportLang === 'roman_ur'
                          ? 'Agli Fasal Bachane ki Tadabeer:'
                          : 'اگلی فصل کے لیے احتیاطی تدابیر:'}
                      </span>
                    </h3>
                    <ul className="space-y-1.5">
                      {diagnosis.prevention.map((pv, i) => (
                        <li
                          key={i}
                          className="text-xs text-ink/80 bg-canvas/60 p-2.5 rounded-xl border border-olive/10 flex items-start gap-2"
                        >
                          <span className="text-olive font-black">•</span>
                          <span>{getLocalizedText(pv, reportLang)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 10. When To Consult An Expert */}
                {diagnosis.when_to_consult_expert && (
                  <div className="bg-amber-500/10 p-3 rounded-2xl border border-amber-500/25 space-y-1 text-xs">
                    <span className="text-[10px] font-black text-amber-900 uppercase flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                      <span>
                        {reportLang === 'en'
                          ? 'When To Consult An Expert:'
                          : reportLang === 'sd'
                          ? 'زرعي ماهر سان ڪڏهن رابطو ڪجي:'
                          : reportLang === 'roman_ur'
                          ? 'Zaria Afsar se kab rabta karein:'
                          : 'زرعی ماہر سے کب مشورہ کریں:'}
                      </span>
                    </span>
                    <p className="text-amber-950 font-medium leading-relaxed">
                      {getLocalizedText(diagnosis.when_to_consult_expert, reportLang)}
                    </p>
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
                      {reportLang === 'en'
                        ? 'Scan Another Plant'
                        : reportLang === 'sd'
                        ? 'ٻيو ٻوٽو اسڪين ڪريو'
                        : reportLang === 'roman_ur'
                        ? 'Naya poda scan karein'
                        : 'نیا پودا اسکین کریں'}
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

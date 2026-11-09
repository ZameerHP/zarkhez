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
  Eye,
  Sun,
  Maximize2,
  Leaf,
  X,
  Volume2,
  Sparkles,
  Layers,
  Sprout,
  CircleDot,
  Apple,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';
import {
  predictLeafDisease,
  prepareLeafImage,
  ScanPredictionResult,
} from '@/lib/model';
import { Advice, SecondOpinion } from '@/lib/schemas';
import { getSavedProfile, saveScanRecord } from '@/lib/supabase/client';
import { speakText, stopSpeaking, unlockAudio } from '@/lib/voice';
import { getStaticFallbackAdvice } from '@/lib/gemini';
import { GuestPromptSheet } from '@/components/auth/GuestPromptSheet';
import {
  compressAndAssessLeafImage,
  ImageQualityReport,
} from '@/lib/image-quality';

/**
 * Zarkhez 1-Image Fast Scan Screen:
 * - Accepts 1 photo of ANY plant organ (Leaf, Stem, Roots, Fruit/Flower, or Whole Plant).
 * - Gemini Multimodal Vision accurately identifies crop, organ, disease, severity & treatments.
 * - Human-sounding spoken Urdu reads results aloud automatically with high reliability.
 * - OffscreenCanvas quality assessment flags blur/lighting without hard-blocking.
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
  const [prediction, setPrediction] = useState<ScanPredictionResult | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [secondOpinion, setSecondOpinion] = useState<SecondOpinion | null>(null);
  const [loadingSecondOpinion, setLoadingSecondOpinion] = useState(false);
  const [savedToDiary, setSavedToDiary] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);
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
    { key: 'rice', en: 'Rice', ur: 'دھان' },
    { key: 'cotton', en: 'Cotton', ur: 'کپاس' },
    { key: 'maize', en: 'Maize', ur: 'مکئی' },
    { key: 'sugarcane', en: 'Sugarcane', ur: 'کماد' },
    { key: 'tomato', en: 'Tomato', ur: 'ٹماٹر' },
    { key: 'potato', en: 'Potato', ur: 'آلو' },
    { key: 'chili', en: 'Chili', ur: 'مرچ' },
  ] as const;

  const organGuides = [
    { icon: Leaf, ur: 'پتا (اوپر یا نیچے)', en: 'Leaf (top or under)' },
    { icon: Sprout, ur: 'تنا یا شاخ', en: 'Stem & branch' },
    { icon: CircleDot, ur: 'جڑیں یا بنیاد', en: 'Roots & base' },
    { icon: Apple, ur: 'پھل یا پھول', en: 'Fruit or flower' },
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
      // Quality check on phone (blur & lighting)
      const compressed = await compressAndAssessLeafImage(fileOrDataUrl);
      if (!compressed.quality.isAcceptable) {
        setPendingQualityData({
          fileOrUrl: compressed.fullDataUrl,
          quality: compressed.quality,
        });
        return;
      }
      runAnalysisPipeline(compressed.fullDataUrl, cropKey);
    } catch {
      runAnalysisPipeline(fileOrDataUrl, cropKey);
    }
  };

  const runAnalysisPipeline = async (
    fileOrDataUrl: File | string,
    cropKey: string
  ) => {
    unlockAudio();
    setPendingQualityData(null);
    setErrorMsg(null);
    setAnalysing(true);
    setPrediction(null);
    setAdvice(null);
    setSecondOpinion(null);
    setSavedToDiary(false);

    try {
      const prepared = await prepareLeafImage(fileOrDataUrl);
      setPreviewUrl(prepared.resizedDataUrl);
      setThumbnailUrl(prepared.thumbnailDataUrl);

      // 1. Fast on-device model guess (instant baseline)
      let onDevicePred: ScanPredictionResult | null = null;
      try {
        onDevicePred = await predictLeafDisease(
          prepared.imageElement,
          cropKey
        );
        setPrediction(onDevicePred);
      } catch {
        // Continue to Gemini Multimodal
      }

      // 2. Multimodal AI Analysis with Gemini (understands leaf, stem, roots, fruit, whole plant)
      let fetchedAdvice: Advice | null = null;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        const res = await fetch('/api/advice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: onDevicePred?.topLabel || 'unclear',
            confidence: onDevicePred?.confidence || 0.85,
            crop: cropKey,
            image: prepared.resizedDataUrl,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          if (data.advice) {
            fetchedAdvice = data.advice;
          }
        }
      } catch (fetchErr) {
        console.warn('API advice fetch error, falling back:', fetchErr);
      }

      if (!fetchedAdvice) {
        fetchedAdvice = getStaticFallbackAdvice(
          onDevicePred?.topLabel || 'unclear',
          onDevicePred?.confidence || 0.8
        );
      }

      setAdvice(fetchedAdvice);

      // Sync prediction confidence if AI returned a confidence score
      if (fetchedAdvice.confidence && onDevicePred) {
        setPrediction({
          ...onDevicePred,
          confidence: fetchedAdvice.confidence,
          tier: fetchedAdvice.confidence >= 0.75 ? 'confident' : 'likely',
        });
      }

      // 3. Spoken Urdu Voice Readout (Fluent, Natural, Human Sounding)
      const profile = getSavedProfile();
      if (profile.autoSpeakVoice !== false && fetchedAdvice) {
        const plantIntro = fetchedAdvice.plant_name
          ? `${fetchedAdvice.plant_name[locale]} کا معائنہ۔ `
          : '';
        const organIntro = fetchedAdvice.organ
          ? `${fetchedAdvice.organ[locale]} پر `
          : '';
        const spoken = `${plantIntro}${organIntro}${fetchedAdvice.problem_name[locale]}۔ ${
          fetchedAdvice.summary[locale]
        }۔ تدابیر: ${fetchedAdvice.steps
          .map((s, i) => `${i + 1}۔ ${s[locale]}`)
          .join(' ')}`;

        setTimeout(() => {
          speakText(spoken, locale);
        }, 150);
      }

      // Guest prompt if unauthenticated
      const currentProfile = getSavedProfile();
      if (!currentProfile.isAuthenticated) {
        setTimeout(() => setShowGuestPrompt(true), 2800);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('permissionError'));
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

  const handleRequestSecondOpinion = async () => {
    if (!previewUrl || loadingSecondOpinion) return;
    setLoadingSecondOpinion(true);
    try {
      const res = await fetch('/api/verify-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: previewUrl,
          crop: selectedCrop,
          label: prediction?.topLabel || 'unclear',
        }),
      });
      const data = await res.json();
      if (data.secondOpinion) {
        setSecondOpinion(data.secondOpinion);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSecondOpinion(false);
    }
  };

  const handleSaveToDiary = async () => {
    if (!advice || savedToDiary) return;
    await saveScanRecord({
      crop: selectedCrop,
      thumbnailDataUrl: thumbnailUrl || previewUrl || '',
      label: prediction?.topLabel || advice.problem_name.en,
      confidence: prediction?.confidence || 0.85,
      advice,
    });
    setSavedToDiary(true);
  };

  const resetScan = () => {
    stopSpeaking();
    stopCameraStream();
    setPreviewUrl(null);
    setPrediction(null);
    setAdvice(null);
    setSecondOpinion(null);
    setSavedToDiary(false);
    setErrorMsg(null);
    setPendingQualityData(null);
  };

  const spokenAdviceText = advice
    ? `${advice.plant_name ? advice.plant_name[locale] + '۔ ' : ''}${
        advice.organ ? advice.organ[locale] + ' پر ' : ''
      }${advice.problem_name[locale]}۔ ${advice.summary[locale]}۔ ${advice.steps
        .map((s, i) => `${i + 1}۔ ${s[locale]}`)
        .join(' ')}`
    : '';

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas overflow-x-hidden">
      {/* Header */}
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
            {locale === 'ur' ? 'فصل کا اے آئی ڈاکٹر (1 تصویر معائنہ)' : 'Plant Doctor (1-Photo Scan)'}
          </h1>
          <p className="text-xs text-cream font-medium mt-0.5">
            {locale === 'ur'
              ? 'پتے، تنے، جڑ، پھل یا پورے پودے کی صرف 1 تصویر لیں — مکمل تشخیص و علاج'
              : 'Take 1 photo of leaf, stem, roots, fruit or whole plant for instant diagnosis'}
          </p>
        </div>
      </header>

      <main className="px-4 sm:px-5 mt-4 space-y-4 max-w-md mx-auto">
        {/* Crop Selector Strip */}
        {!prediction && !analysing && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-3.5 shadow-soft border border-olive/15 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <label className="font-extrabold text-xs text-ink">
                {locale === 'ur' ? 'اپنی فصل منتخب کریں:' : 'Select Crop:'}
              </label>
              <span className="text-[11px] font-bold text-olive">
                {locale === 'ur' ? 'یا براہِ راست تصویر لیں' : 'Or take photo directly'}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {supportedCrops.map((c) => {
                const active = selectedCrop === c.key;
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

        {/* 1-Image Primary Viewfinder / Capture Frame */}
        {!prediction && !analysing && (
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
                  {/* Aim target */}
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
                    <p className="font-extrabold text-sm text-white">
                      {locale === 'ur'
                        ? 'صرف 1 واضح تصویر لیں'
                        : 'Take 1 Clear Photo'}
                    </p>
                    <p className="text-xs text-cream/80 max-w-[240px] mx-auto leading-relaxed">
                      {locale === 'ur'
                        ? 'پتا، تنا، جڑ، پھل یا پورا پودا — اے آئی ہر حصے کو خود پہچان لے گی'
                        : 'Leaf, stem, roots, fruit or whole plant — AI detects organ automatically'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Organ Visual Chips */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-ink/65 uppercase tracking-wider block">
                {locale === 'ur' ? 'کسی بھی ایک حصے کی تصویر لیں:' : 'Accepts any 1 plant part:'}
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

        {/* Quality Check Advisory Modal (Never Hard-Blocking) */}
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
                        selectedCrop
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

        {/* Radar Scanner Animation during Analysis */}
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
                    ? 'پودے کا باریک بینی سے معائنہ کیا جا رہا ہے...'
                    : 'Analysing plant in detail...'}
                </h2>
                <p className="text-xs text-ink/70">
                  {locale === 'ur'
                    ? 'پتے، تنے، جڑوں اور علامات کی شناخت و علاج تیار ہو رہا ہے'
                    : 'Identifying plant, organ, disease and safe treatments'}
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

        {/* Complete Results Display (Section 5.2) */}
        {advice && !analysing && (
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-4 text-start"
          >
            {/* Expert Referral Banner */}
            {advice.see_expert && (
              <div className="bg-cream border-2 border-alert-amber rounded-2xl p-4 shadow-soft flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-alert-amber text-ink flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1 space-y-1.5 min-w-0">
                  <h3 className="font-extrabold text-sm text-ink">
                    {t('expertBannerTitle')}
                  </h3>
                  <p className="text-xs text-ink/85 leading-relaxed">
                    {advice.expert_reason
                      ? advice.expert_reason[locale]
                      : t('expertBannerDefault')}
                  </p>
                </div>
              </div>
            )}

            {/* Main Result Card */}
            <div className="bg-white rounded-3xl p-5 shadow-soft border border-olive/15 space-y-4">
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
                    {/* Plant Organ Badge */}
                    {advice.organ && (
                      <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-olive/15 text-olive-dark">
                        {advice.organ[locale]}
                      </span>
                    )}
                    {/* Severity Badge */}
                    <span
                      className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${
                        advice.severity === 'high'
                          ? 'bg-alert-red/15 text-alert-red'
                          : advice.severity === 'medium'
                          ? 'bg-alert-amber/25 text-amber-900'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {advice.severity === 'high'
                        ? t('severityHigh')
                        : advice.severity === 'medium'
                        ? t('severityMedium')
                        : t('severityLow')}
                    </span>
                  </div>

                  {advice.plant_name && (
                    <span className="text-xs font-bold text-ink/60 block">
                      {advice.plant_name[locale]}
                    </span>
                  )}

                  <h2 className="font-black text-lg sm:text-xl text-ink leading-tight">
                    {advice.problem_name[locale]}
                  </h2>
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
                      {locale === 'ur' ? 'اردو وائس خلاصہ:' : 'Urdu Voice Summary:'}
                    </span>
                    <p className="text-[11px] text-ink/75 leading-tight">
                      {locale === 'ur'
                        ? 'آواز میں مکمل تشخیص اور علاج سنیں'
                        : 'Listen to spoken diagnosis aloud'}
                    </p>
                  </div>
                </div>

                <ReadAloudButton text={spokenAdviceText} lang={locale} />
              </div>

              {/* Summary */}
              <div className="bg-canvas rounded-2xl p-3.5">
                <p className="text-xs sm:text-sm text-ink leading-relaxed font-medium">
                  {advice.summary[locale]}
                </p>
              </div>

              {/* Practical Steps First (Low cost, field hygiene, irrigation) */}
              <div className="space-y-2">
                <h3 className="font-black text-xs sm:text-sm text-ink flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{t('stepsTitle')}</span>
                </h3>
                <ol className="space-y-2">
                  {advice.steps.map((st, i) => (
                    <li
                      key={i}
                      className="text-xs sm:text-sm text-ink bg-canvas/80 p-3 rounded-xl border border-olive/10 flex items-start gap-2.5"
                    >
                      <span className="w-5 h-5 rounded-full bg-olive text-white text-[11px] font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed font-medium">
                        {st[locale]}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Prevention */}
              {advice.prevention && advice.prevention.length > 0 && (
                <div className="space-y-2 pt-1 border-t border-olive/10">
                  <h3 className="font-extrabold text-xs sm:text-sm text-ink flex items-center gap-1.5">
                    <Sun className="w-4 h-4 text-amber-600" />
                    <span>{t('preventionTitle')}</span>
                  </h3>
                  <ul className="space-y-1.5">
                    {advice.prevention.map((pv, i) => (
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
                    {locale === 'ur' ? 'نیا پودا اسکین کریں' : 'Scan Another Plant'}
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

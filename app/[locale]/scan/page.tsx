'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Camera,
  Upload,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  BookmarkCheck,
  BookmarkPlus,
  RotateCcw,
  Eye,
  Sun,
  Maximize2,
  Leaf,
  X,
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
import { speakText, unlockAudio } from '@/lib/voice';
import { getStaticFallbackAdvice } from '@/lib/anthropic';

/**
 * Scan Screen (Real Leaf Photos Only — Zero Fake Samples):
 * - Works on all mobile phones: Live rear camera viewfinder (when secure context)
 *   with automatic fallback to native phone camera (<input capture="environment">) + gallery picker.
 * - Smooth Framer Motion radar laser sweep during analysis.
 * - Automatic human Urdu/English voice readout unlocked on user tap.
 */
export default function ScanPage() {
  const t = useTranslations('scan');
  const tApp = useTranslations('app');
  const locale = useLocale() as 'ur' | 'en';

  const [selectedCrop, setSelectedCrop] = useState<
    'tomato' | 'wheat' | 'maize' | 'rice'
  >('tomato');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [analysing, setAnalysing] = useState(false);
  const [prediction, setPrediction] = useState<ScanPredictionResult | null>(
    null
  );
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [secondOpinion, setSecondOpinion] = useState<SecondOpinion | null>(
    null
  );
  const [loadingSecondOpinion, setLoadingSecondOpinion] = useState(false);
  const [savedToDiary, setSavedToDiary] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live mobile camera stream state
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const supportedCrops = [
    { key: 'tomato', en: 'Tomato', ur: 'ٹماٹر' },
    { key: 'wheat', en: 'Wheat', ur: 'گندم' },
    { key: 'maize', en: 'Maize', ur: 'مکئی' },
    { key: 'rice', en: 'Rice', ur: 'دھان' },
  ] as const;

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, []);

  const handleOpenCamera = async () => {
    unlockAudio();
    // Try live rear camera stream if supported in current context, else fallback to native phone camera input
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
      runAnalysisPipeline(dataUrl, selectedCrop);
    }
  };

  const runAnalysisPipeline = async (
    fileOrDataUrl: File | string,
    cropKey: string
  ) => {
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

      const predResult = await predictLeafDisease(
        prepared.imageElement,
        cropKey
      );
      setPrediction(predResult);

      let fetchedAdvice: Advice | null = null;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch('/api/advice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: predResult.topLabel,
            confidence: predResult.confidence,
            crop: cropKey,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          if (data.advice) fetchedAdvice = data.advice;
        }
      } catch {
        // Fall back directly to verified agronomy database
      }

      if (!fetchedAdvice) {
        fetchedAdvice = getStaticFallbackAdvice(
          predResult.topLabel,
          predResult.confidence
        );
      }
      setAdvice(fetchedAdvice);

      // Automatically speak the diagnosis summary in human Urdu/English voice
      const profile = getSavedProfile();
      if (profile.autoSpeakVoice !== false && fetchedAdvice) {
        const spoken = `${fetchedAdvice.problem_name[locale]}۔ ${
          fetchedAdvice.summary[locale]
        }۔ ${fetchedAdvice.steps
          .map((s, i) => `${i + 1}۔ ${s[locale]}`)
          .join(' ')}`;
        speakText(spoken, locale);
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
    runAnalysisPipeline(file, selectedCrop);
    e.target.value = '';
  };

  const handleRequestSecondOpinion = async () => {
    if (!previewUrl || !prediction || loadingSecondOpinion) return;
    setLoadingSecondOpinion(true);
    try {
      const res = await fetch('/api/verify-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: previewUrl,
          crop: selectedCrop,
          label: prediction.topLabel,
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
    if (!prediction || !advice || savedToDiary) return;
    await saveScanRecord({
      crop: selectedCrop,
      thumbnailDataUrl: thumbnailUrl || previewUrl || '',
      label: prediction.topLabel,
      confidence: prediction.confidence,
      advice,
    });
    setSavedToDiary(true);
  };

  const resetScan = () => {
    stopCameraStream();
    setPreviewUrl(null);
    setPrediction(null);
    setAdvice(null);
    setSecondOpinion(null);
    setSavedToDiary(false);
    setErrorMsg(null);
  };

  const spokenAdviceText = advice
    ? `${advice.problem_name[locale]}۔ ${advice.summary[locale]}۔ ${advice.steps
        .map((s, i) => `${i + 1}۔ ${s[locale]}`)
        .join(' ')}`
    : '';

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas overflow-x-hidden">
      {/* Header with Cropped Zarkhez Emblem */}
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
            {t('title')}
          </h1>
          <p className="text-xs text-cream font-medium mt-0.5">
            {t('subtitle')}
          </p>
        </div>
      </header>

      <main className="px-4 sm:px-5 mt-4 space-y-4">
        {/* Step 1: Supported Crop Selector */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-card p-4 shadow-soft border border-olive/10 space-y-3"
        >
          <label className="block font-bold text-xs sm:text-sm text-ink">
            {t('selectCrop')}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {supportedCrops.map((c) => {
              const active = selectedCrop === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setSelectedCrop(c.key)}
                  className={`relative min-h-[44px] rounded-tile font-bold text-xs sm:text-sm transition-all ${
                    active
                      ? 'text-white shadow-sm'
                      : 'bg-canvas text-ink hover:bg-olive/15'
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="scan-crop-pill"
                      transition={{
                        type: 'spring',
                        stiffness: 360,
                        damping: 28,
                      }}
                      className="absolute inset-0 rounded-tile bg-[#062409]"
                    />
                  )}
                  <span className="relative z-10">{c[locale]}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] sm:text-xs text-ink/70 leading-relaxed bg-canvas p-2.5 rounded-tile">
            {t('supportedNote')}
          </p>
        </motion.section>

        {/* Guide Frame & Capture/Upload Controls */}
        {!prediction && !analysing && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/10 space-y-4"
          >
            <div className="relative h-64 rounded-card bg-[#062409] overflow-hidden flex flex-col items-center justify-center p-4 text-white">
              {cameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="relative z-10 w-44 h-44 border-2 border-dashed border-emerald-400 rounded-3xl pointer-events-none" />
                  <div className="absolute bottom-3 inset-x-0 z-20 flex items-center justify-center gap-4">
                    <button
                      type="button"
                      onClick={stopCameraStream}
                      className="w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center"
                    >
                      <X className="w-5 h-5" />
                    </button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.9 }}
                      onClick={handleCaptureFromLiveVideo}
                      className="px-6 py-2.5 rounded-full bg-emerald-500 text-white font-extrabold text-sm shadow-lg border-2 border-white flex items-center gap-2"
                    >
                      <Camera className="w-4 h-4" />
                      <span>
                        {locale === 'ur' ? 'تصویر کھینچیں' : 'Capture Leaf'}
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
                    className="absolute inset-0 w-full h-full object-cover opacity-30"
                  />
                  <motion.div
                    animate={{ scale: [1, 1.03, 1] }}
                    transition={{ duration: 2.6, repeat: Infinity }}
                    className="relative z-10 w-44 h-44 border-2 border-dashed border-emerald-400 rounded-3xl flex flex-col items-center justify-center text-center p-4"
                  >
                    <Leaf className="w-10 h-10 text-emerald-400 mb-2" />
                    <span className="text-xs font-bold text-cream">
                      {t('tipSingleLeaf')}
                    </span>
                  </motion.div>
                </>
              )}
            </div>

            {/* 3 Tips Row */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-canvas rounded-tile p-2.5 flex flex-col items-center">
                <Leaf className="w-4 h-4 text-olive mb-1" />
                <span className="text-[11px] font-bold text-ink">
                  {t('tipSingleLeaf')}
                </span>
              </div>
              <div className="bg-canvas rounded-tile p-2.5 flex flex-col items-center">
                <Sun className="w-4 h-4 text-wheat mb-1" />
                <span className="text-[11px] font-bold text-ink">
                  {t('tipGoodLight')}
                </span>
              </div>
              <div className="bg-canvas rounded-tile p-2.5 flex flex-col items-center">
                <Maximize2 className="w-4 h-4 text-olive mb-1" />
                <span className="text-[11px] font-bold text-ink">
                  {t('tipFillFrame')}
                </span>
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

            {/* Primary Capture & Upload Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={handleOpenCamera}
                className="min-h-[52px] rounded-full bg-[#062409] hover:bg-olive-dark text-white font-extrabold text-sm sm:text-base shadow-soft flex items-center justify-center gap-2.5 transition-all"
              >
                <Camera className="w-5 h-5 text-emerald-400" />
                <span>{t('takePhoto')}</span>
              </motion.button>

              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  unlockAudio();
                  uploadInputRef.current?.click();
                }}
                className="min-h-[52px] rounded-full bg-olive hover:bg-olive-dark text-white font-bold text-sm sm:text-base shadow-soft flex items-center justify-center gap-2.5 transition-all"
              >
                <Upload className="w-5 h-5" />
                <span>{t('uploadPhoto')}</span>
              </motion.button>
            </div>
          </motion.section>
        )}

        {/* Analysing State with Animated Laser Radar Sweep */}
        <AnimatePresence>
          {analysing && (
            <motion.section
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-card p-7 shadow-soft border border-olive/15 flex flex-col items-center text-center space-y-5"
            >
              <div className="relative w-40 h-40 rounded-3xl overflow-hidden border-4 border-emerald-500/40 shadow-lg flex items-center justify-center bg-[#062409]">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Scanning leaf"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Leaf className="w-12 h-12 text-emerald-400 animate-pulse" />
                )}
                {/* Animated Laser Line */}
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
              <div>
                <h2 className="font-extrabold text-lg text-ink">
                  {t('analysing')}
                </h2>
                <p className="text-xs text-ink/70 mt-1">{t('analysingSub')}</p>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Error State */}
        {errorMsg && (
          <div className="bg-alert-red/10 border border-alert-red/35 rounded-card p-4 text-sm text-ink space-y-3">
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

        {/* Result Card */}
        {prediction && advice && !analysing && (
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-4"
          >
            {(prediction.tier !== 'confident' || advice.see_expert) && (
              <div className="bg-cream border-2 border-alert-amber rounded-card p-4 shadow-soft flex items-start gap-3">
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

                  {prediction.confidence < 0.75 && !secondOpinion && (
                    <button
                      type="button"
                      onClick={handleRequestSecondOpinion}
                      disabled={loadingSecondOpinion}
                      className="mt-2 inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-full bg-ink text-white text-xs font-bold shadow-sm"
                    >
                      <Eye className="w-4 h-4 text-olive-fresh" />
                      <span>
                        {loadingSecondOpinion
                          ? t('secondOpinionLoading')
                          : t('secondOpinionBtn')}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {secondOpinion && (
              <div className="bg-white rounded-card p-4 shadow-soft border-2 border-olive space-y-2">
                <div className="flex items-center gap-2 text-olive-dark font-extrabold text-sm">
                  <Eye className="w-4 h-4" />
                  <span>{t('secondOpinionTitle')}</span>
                </div>
                <p className="text-sm text-ink">
                  {secondOpinion.visible_symptoms[locale]}
                </p>
                <p className="text-xs text-ink/75 font-medium">
                  {secondOpinion.recommendation[locale]}
                </p>
              </div>
            )}

            <div className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/15 space-y-4">
              <div className="flex items-start gap-3.5">
                {previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Scanned leaf"
                    className="w-20 h-20 rounded-2xl object-cover border border-olive/20 flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full ${
                        advice.severity === 'high'
                          ? 'bg-alert-red/15 text-alert-red'
                          : advice.severity === 'medium'
                          ? 'bg-alert-amber/25 text-ink'
                          : 'bg-olive/15 text-olive-dark'
                      }`}
                    >
                      {advice.severity === 'high'
                        ? t('severityHigh')
                        : advice.severity === 'medium'
                        ? t('severityMedium')
                        : t('severityLow')}
                    </span>
                    <bdi
                      dir="ltr"
                      className="text-xs text-ink/55 font-semibold"
                    >
                      {prediction.inferenceMs} ms
                    </bdi>
                  </div>

                  <h2 className="font-extrabold text-lg sm:text-xl text-ink mt-1.5">
                    {advice.problem_name[locale]}
                  </h2>
                </div>
              </div>

              <div className="bg-canvas rounded-tile p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-ink/80">{t('confidenceLabel')}</span>
                  <bdi dir="ltr" className="text-sm font-extrabold text-ink">
                    {Math.round(prediction.confidence * 100)}%
                  </bdi>
                </div>
                <div className="w-full h-3 bg-white rounded-full overflow-hidden border border-olive/15">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.round(prediction.confidence * 100)}%`,
                    }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    className={`h-full rounded-full ${
                      prediction.confidence >= 0.75
                        ? 'bg-olive-fresh'
                        : prediction.confidence >= 0.5
                        ? 'bg-alert-amber'
                        : 'bg-alert-red'
                    }`}
                  />
                </div>
                <p className="text-xs font-semibold text-ink/75">
                  {prediction.tier === 'confident'
                    ? t('confidentBadge')
                    : prediction.tier === 'likely'
                    ? t('likelyBadge')
                    : t('unsureBadge')}
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-sm sm:text-base text-ink leading-relaxed font-medium">
                  {advice.summary[locale]}
                </p>
                <ReadAloudButton text={spokenAdviceText} />
              </div>

              <div className="space-y-2.5 pt-2 border-t border-olive/10">
                <h3 className="font-extrabold text-sm sm:text-base text-olive-dark flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-olive" />
                  <span>{t('stepsTitle')}</span>
                </h3>
                <ol className="space-y-2">
                  {advice.steps.map((step, i) => (
                    <li
                      key={i}
                      className="bg-canvas rounded-tile p-3 text-xs sm:text-sm text-ink flex items-start gap-3"
                    >
                      <span className="w-6 h-6 rounded-full bg-olive text-white font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                        <bdi dir="ltr">{i + 1}</bdi>
                      </span>
                      <span className="leading-relaxed">{step[locale]}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-2 pt-2 border-t border-olive/10">
                <h3 className="font-extrabold text-sm sm:text-base text-ink flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-wheat" />
                  <span>{t('preventionTitle')}</span>
                </h3>
                <ul className="space-y-1.5">
                  {advice.prevention.map((tip, i) => (
                    <li
                      key={i}
                      className="text-xs sm:text-sm text-ink/85 flex items-start gap-2 ps-1"
                    >
                      <span className="text-wheat font-bold">•</span>
                      <span>{tip[locale]}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-ink/65 bg-cream/60 p-3 rounded-tile">
                {tApp('disclaimer')}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSaveToDiary}
                  disabled={savedToDiary}
                  className={`min-h-[50px] rounded-full font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                    savedToDiary
                      ? 'bg-olive/20 text-olive-dark'
                      : 'bg-olive hover:bg-olive-dark text-white shadow-soft'
                  }`}
                >
                  {savedToDiary ? (
                    <>
                      <BookmarkCheck className="w-5 h-5" />
                      <span>{t('savedToDiary')}</span>
                    </>
                  ) : (
                    <>
                      <BookmarkPlus className="w-5 h-5" />
                      <span>{t('saveToDiary')}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={resetScan}
                  className="min-h-[50px] rounded-full bg-[#062409] text-white font-bold text-sm flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{t('scanAnother')}</span>
                </button>
              </div>
            </div>
          </motion.section>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

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
  Crosshair,
  Eye,
  FlaskConical,
  Bug,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';
import {
  CropDiagnosis,
  CropDiagnosisSchema,
  PublicScanError,
  PublicScanErrorSchema,
  Advice,
  getLocalizedText,
} from '@/lib/schemas';
import {
  getCustomerErrorMessage,
  sanitizeCustomerText,
} from '@/lib/customer-messages';
import { getSavedProfile, saveScanRecord } from '@/lib/supabase/client';
import { speakText, stopSpeaking, unlockAudio } from '@/lib/voice';
import { buildScanVoiceNarration } from '@/lib/voice/speech-prep';
import { GuestPromptSheet } from '@/components/auth/GuestPromptSheet';
import {
  compressAndAssessLeafImage,
  ImageQualityReport,
} from '@/lib/image-quality';
import { buildOfflinePreliminaryAssessment } from '@/lib/offline-assessment';
import {
  formatProblemCategoryLabel,
  RegionSelectorBar,
  TechnicalDetailsDrawer,
} from '@/components/scan/VisionInsightsAndFeedback';
import { SUPPORTED_AGRICULTURAL_CROPS } from '@/lib/vision/knowledge-base';

type ScanStage =
  | 'idle'
  | 'validating_image'
  | 'processing'
  | 'analyzing_cloud'
  | 'quality_warning'
  | 'crop_mismatch'
  | 'retake_required'
  | 'diagnosis_ready'
  | 'error';

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const ALLOWED_IMAGE_EXT_RGX = /\.(jpe?g|png|webp|heic|heif)$/i;

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
  const [preservedQuality, setPreservedQuality] = useState<ImageQualityReport | null>(null);
  const [scanStage, setScanStage] = useState<ScanStage>('idle');
  const [analysing, setAnalysing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<CropDiagnosis | null>(null);
  const [reportLang, setReportLang] = useState<'en' | 'ur'>(locale === 'en' ? 'en' : 'ur');
  const [savedToDiary, setSavedToDiary] = useState(false);
  const [savingToDiary, setSavingToDiary] = useState(false);
  const [diarySaveNote, setDiarySaveNote] = useState<string | null>(null);
  const [scanError, setScanError] = useState<PublicScanError | null>(null);
  const [voiceErrorMsg, setVoiceErrorMsg] = useState<string | null>(null);
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);
  const [viewMode, setViewMode] = useState<'annotated' | 'original'>('annotated');
  const [region, setRegion] = useState<string>('');
  const [showAllCrops, setShowAllCrops] = useState(false);

  // Quality check state
  const [pendingQualityData, setPendingQualityData] = useState<{
    fileOrUrl: File | string;
    quality: ImageQualityReport;
  } | null>(null);

  // Live mobile camera stream state & duplicate request guard refs
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const scanInFlightRef = useRef(false);
  const activeAbortRef = useRef<AbortController | null>(null);

  const supportedCrops = SUPPORTED_AGRICULTURAL_CROPS.map((c) => ({
    key: c.slug,
    en: c.en,
    ur: c.ur,
  }));

  useEffect(() => {
    const p = getSavedProfile();
    if (p?.province || p?.district) {
      const txt = `${p.province || ''} ${p.district || ''}`.toLowerCase();
      if (txt.includes('sindh') || txt.includes('hyderabad') || txt.includes('sukkur')) setRegion('sindh_delta');
      else if (txt.includes('multan') || txt.includes('bahawal')) setRegion('south_punjab');
      else if (txt.includes('punjab') || txt.includes('lahore')) setRegion('central_punjab');
      else if (txt.includes('potohar') || txt.includes('rawalpindi') || txt.includes('chakwal')) setRegion('potohar_rainfed');
      else if (txt.includes('kp') || txt.includes('peshawar') || txt.includes('swat')) setRegion('kp_valleys');
      else if (txt.includes('baloch') || txt.includes('quetta')) setRegion('balochistan_arid');
    }
  }, []);

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
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, []);

  const validateSelectedFile = (file: File): PublicScanError | null => {
    if (file.size === 0) {
      return {
        error: 'structured_scan_error',
        error_category: 'invalid_image_input',
        retryable: false,
        user_message: {
          en: 'This photo appears empty. Please take or choose another clear plant photo.',
          ur: 'منتخب کردہ تصویر خالی ہے۔ براہِ کرم پودے کی دوسری واضح تصویر لیں۔',
        },
      };
    }

    const mime = (file.type || '').toLowerCase().trim();
    const hasAllowedExt = ALLOWED_IMAGE_EXT_RGX.test(file.name || '');
    if (mime ? !ALLOWED_IMAGE_MIME_TYPES.has(mime) : !hasAllowedExt) {
      return {
        error: 'structured_scan_error',
        error_category: 'invalid_image_input',
        retryable: false,
        user_message: {
          en: "We couldn't process this file type. Please choose a standard camera photo.",
          ur: 'یہ فائل قابل قبول نہیں۔ براہِ کرم فون کے کیمرے سے لی گئی عام تصویر منتخب کریں۔',
        },
      };
    }

    if (file.size > 25 * 1024 * 1024) {
      return {
        error: 'structured_scan_error',
        error_category: 'invalid_image_input',
        retryable: false,
        user_message: {
          en: 'This photo file is too large. Please take a standard camera photo.',
          ur: 'یہ تصویر بہت بڑی ہے۔ براہِ کرم عام سائز کی نئی تصویر لیں۔',
        },
      };
    }

    return null;
  };

  const handleOpenCamera = async () => {
    unlockAudio();
    if (scanInFlightRef.current) return;
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
    if (scanInFlightRef.current || !videoRef.current) return;
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
    if (scanInFlightRef.current) return;
    setScanError(null);
    setVoiceErrorMsg(null);
    setScanStage('validating_image');

    if (fileOrDataUrl instanceof File) {
      const validationErr = validateSelectedFile(fileOrDataUrl);
      if (validationErr) {
        setScanStage('error');
        setScanError(validationErr);
        return;
      }
    }

    try {
      setScanStage('processing');
      // OffscreenCanvas Quality Check (blur & lighting)
      const compressed = await compressAndAssessLeafImage(fileOrDataUrl);
      setPreviewUrl(compressed.fullDataUrl);
      setThumbnailUrl(compressed.thumbnailDataUrl);
      setPreservedQuality(compressed.quality);

      if (!compressed.quality.isAcceptable) {
        setScanStage('quality_warning');
        setPendingQualityData({
          fileOrUrl: compressed.fullDataUrl,
          quality: compressed.quality,
        });
        return;
      }
      runAnalysisPipeline(compressed.fullDataUrl, cropKey, false, compressed.quality);
    } catch {
      setScanStage('error');
      setScanError({
        error: 'structured_scan_error',
        error_category: 'invalid_image_input',
        retryable: false,
        user_message: getCustomerErrorMessage('invalid_image_input', 'scan'),
      });
    }
  };

  const triggerSpokenDiagnosis = (diagData: CropDiagnosis) => {
    const profile = getSavedProfile();
    if (profile.autoSpeakVoice === false) return;

    const speechText = buildScanVoiceNarration(
      diagData,
      reportLang === 'en' ? 'en' : 'ur'
    );

    if (!speechText.trim()) return;
    setTimeout(() => {
      speakText(
        speechText,
        reportLang === 'en' ? 'en' : 'ur',
        {
          onError: () => {
            setVoiceErrorMsg(
              locale === 'ur'
                ? 'آواز سنانے میں عارضی مسئلہ آیا، لیکن مکمل تحریری رپورٹ نیچے موجود ہے۔'
                : 'Voice summary unavailable right now; full text report is ready below.'
            );
          },
        }
      );
    }, 150);
  };

  const runAnalysisPipeline = async (
    fileOrDataUrl: File | string,
    cropKey: string,
    confirmMismatchOverride = false,
    cachedQuality?: ImageQualityReport
  ) => {
    unlockAudio();
    if (scanInFlightRef.current) return;
    scanInFlightRef.current = true;

    setPendingQualityData(null);
    setScanError(null);
    setVoiceErrorMsg(null);
    setDiarySaveNote(null);
    setAnalysing(true);
    setScanStage('processing');
    setDiagnosis(null);
    setSavedToDiary(false);

    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
    }
    const controller = new AbortController();
    activeAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 48000);

    try {
      let fullDataUrl: string;
      let thumbUrl: string;
      let qualityReport: ImageQualityReport;

      if (typeof fileOrDataUrl === 'string' && fileOrDataUrl.startsWith('data:image/') && cachedQuality && thumbnailUrl) {
        fullDataUrl = fileOrDataUrl;
        thumbUrl = thumbnailUrl;
        qualityReport = cachedQuality;
      } else {
        const compressed = await compressAndAssessLeafImage(fileOrDataUrl);
        fullDataUrl = compressed.fullDataUrl;
        thumbUrl = compressed.thumbnailDataUrl;
        qualityReport = compressed.quality;
        setPreviewUrl(fullDataUrl);
        setThumbnailUrl(thumbUrl);
        setPreservedQuality(qualityReport);
      }

      // Guard upload payload size cleanly
      if (fullDataUrl.length > 3_900_000) {
        clearTimeout(timeoutId);
        setScanStage('error');
        setScanError({
          error: 'structured_scan_error',
          error_category: 'invalid_image_input',
          retryable: false,
          user_message: {
            en: 'This picture is still too large to send. Please take a regular camera photo.',
            ur: 'تصویر کا سائز بہت بڑا ہے۔ براہِ کرم کیمرے سے عام تصویر لیں۔',
          },
        });
        return;
      }

      // Fast pre-flight network check
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        clearTimeout(timeoutId);
        setScanStage('error');
        setScanError({
          error: 'structured_scan_error',
          error_category: 'network_or_timeout',
          retryable: true,
          user_message: getCustomerErrorMessage('network_or_timeout', 'scan'),
        });
        return;
      }

      setScanStage('analyzing_cloud');

      const res = await fetch('/api/scan/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: fullDataUrl,
          selectedCrop: cropKey,
          confirmMismatchOverride,
          clientQuality: qualityReport,
          region: region || undefined,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const rawResponseText = await res.text();
      let parsedBody: unknown = null;
      try {
        parsedBody = rawResponseText ? JSON.parse(rawResponseText) : null;
      } catch {
        parsedBody = null;
      }

      if (!res.ok) {
        const structuredParsed = PublicScanErrorSchema.safeParse(parsedBody);
        if (structuredParsed.success) {
          setScanStage('error');
          setScanError({
            error: 'structured_scan_error',
            error_category: structuredParsed.data.error_category,
            retryable: structuredParsed.data.retryable,
            user_message: {
              en: sanitizeCustomerText(
                structuredParsed.data.user_message.en,
                'en',
                structuredParsed.data.error_category,
                'scan'
              ),
              ur: sanitizeCustomerText(
                structuredParsed.data.user_message.ur,
                'ur',
                structuredParsed.data.error_category,
                'scan'
              ),
            },
          });
          return;
        }

        const fallbackCategory =
          res.status === 429
            ? 'rate_limited'
            : res.status === 413 || res.status === 400
            ? 'invalid_image_input'
            : res.status === 401 || res.status === 403
            ? 'permanent_config_error'
            : 'temporary_service_failure';

        setScanStage('error');
        setScanError({
          error: 'structured_scan_error',
          error_category: fallbackCategory,
          retryable: res.status !== 400 && res.status !== 401 && res.status !== 403 && res.status !== 413,
          user_message: getCustomerErrorMessage(fallbackCategory, 'scan'),
        });
        return;
      }

      // Strictly validate canonical diagnosis contract on client before rendering
      const diagValidated = CropDiagnosisSchema.safeParse(parsedBody);
      if (!diagValidated.success) {
        setScanStage('error');
        setScanError({
          error: 'structured_scan_error',
          error_category: 'schema_validation_failed',
          retryable: true,
          user_message: getCustomerErrorMessage('schema_validation_failed', 'scan'),
        });
        return;
      }

      const diagData = diagValidated.data;
      setDiagnosis(diagData);
      setScanStage(
        diagData.diagnosis_status === 'crop_mismatch'
          ? 'crop_mismatch'
          : diagData.requires_retake || diagData.diagnosis_status === 'invalid_image'
          ? 'retake_required'
          : 'diagnosis_ready'
      );

      triggerSpokenDiagnosis(diagData);

      const profile = getSavedProfile();
      if (!profile.isAuthenticated) {
        setTimeout(() => setShowGuestPrompt(true), 2800);
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      if (isAbort && !timedOut) {
        // Explicit user cancellation
        setScanStage('idle');
        return;
      }

      setScanStage('error');
      setScanError({
        error: 'structured_scan_error',
        error_category: 'network_or_timeout',
        retryable: true,
        user_message: getCustomerErrorMessage('network_or_timeout', 'scan'),
      });
    } finally {
      clearTimeout(timeoutId);
      scanInFlightRef.current = false;
      activeAbortRef.current = null;
      setAnalysing(false);
    }
  };

  const handleRetryAnalysis = () => {
    if (!previewUrl || scanInFlightRef.current) return;
    setScanError(null);
    runAnalysisPipeline(previewUrl, selectedCrop, false, preservedQuality || undefined);
  };

  const handleRunOfflinePreliminary = () => {
    if (!previewUrl) return;
    const offlineReport = buildOfflinePreliminaryAssessment(
      selectedCrop,
      preservedQuality || undefined
    );
    setScanError(null);
    setDiagnosis(offlineReport);
    setScanStage('diagnosis_ready');
    triggerSpokenDiagnosis(offlineReport);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    unlockAudio();
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || scanInFlightRef.current) return;
    checkAndRunPipeline(file, selectedCrop);
  };

  const handleConfirmMismatch = () => {
    if (!previewUrl || !diagnosis || scanInFlightRef.current) return;
    const targetCrop = diagnosis.detected_crop || selectedCrop;
    setSelectedCrop(targetCrop);
    runAnalysisPipeline(previewUrl, targetCrop, true, preservedQuality || undefined);
  };

  const handleCancelInFlight = () => {
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
    }
    scanInFlightRef.current = false;
    setAnalysing(false);
    setScanStage('idle');
  };

  const handleSaveToDiary = async () => {
    if (!diagnosis || savedToDiary || savingToDiary) return;
    setSavingToDiary(true);
    setDiarySaveNote(null);

    try {
      const legacyAdvice: Advice = {
        problem_name: diagnosis.problem_name,
        plant_name: {
          en: diagnosis.detected_crop || selectedCrop,
          ur: diagnosis.detected_crop_ur || selectedCrop,
        },
        organ: {
          en: diagnosis.detected_plant_part || 'Leaf',
          ur: diagnosis.detected_plant_part_ur || 'پتا',
        },
        confidence: diagnosis.identification_confidence ?? 0,
        severity:
          diagnosis.severity === 'not_assessed' ? 'low' : diagnosis.severity,
        summary: diagnosis.message,
        steps:
          diagnosis.recommendations && diagnosis.recommendations.length > 0
            ? diagnosis.recommendations
            : [
                {
                  en: 'Continue routine scouting.',
                  ur: 'معمول کی دیکھ بھال جاری رکھیں۔',
                },
              ],
        prevention:
          diagnosis.prevention && diagnosis.prevention.length > 0
            ? diagnosis.prevention
            : [
                {
                  en: 'Maintain clean field borders.',
                  ur: 'کھیت کی وٹیں صاف رکھیں۔',
                },
              ],
        see_expert: Boolean(diagnosis.requires_expert_review),
        expert_reason: diagnosis.requires_expert_review
          ? {
              en: 'Condition requires field extension officer inspection.',
              ur: 'اس کیفیت کے لیے فیلڈ زرعی توسیعی افسر سے معائنہ ضروری ہے۔',
            }
          : undefined,
      };

      const saved = await saveScanRecord({
        crop: diagnosis.detected_crop || selectedCrop,
        selected_crop: diagnosis.selected_crop || selectedCrop,
        detected_crop: diagnosis.detected_crop || selectedCrop,
        plant_part: diagnosis.detected_plant_part || 'Leaf',
        diagnosis_status: diagnosis.diagnosis_status,
        thumbnailDataUrl: thumbnailUrl || previewUrl || '',
        label: getLocalizedText(diagnosis.problem_name, 'en', 'Plant Scan'),
        confidence: diagnosis.identification_confidence ?? 0,
        advice: legacyAdvice,
      });

      setSavedToDiary(true);
      if (saved && 'cloudSynced' in saved && saved.cloudSynced === false) {
        setDiarySaveNote(
          locale === 'ur'
            ? 'آپ کے فون میں محفوظ ہو گیا (کلاؤڈ سنک انٹرنیٹ آنے پر ہوگا)۔'
            : 'Saved on your device (cloud sync skipped while offline/guest).'
        );
      }
    } catch {
      setDiarySaveNote(
        locale === 'ur'
          ? 'فون کی اسٹوریج بھری ہونے کی وجہ سے محفوظ کرنے میں مسئلہ آیا۔'
          : 'Could not save scan to diary due to device storage limits.'
      );
    } finally {
      setSavingToDiary(false);
    }
  };

  const resetScan = () => {
    stopSpeaking();
    stopCameraStream();
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
    }
    scanInFlightRef.current = false;
    setAnalysing(false);
    setScanStage('idle');
    setPreviewUrl(null);
    setThumbnailUrl('');
    setPreservedQuality(null);
    setDiagnosis(null);
    setSavedToDiary(false);
    setSavingToDiary(false);
    setDiarySaveNote(null);
    setScanError(null);
    setVoiceErrorMsg(null);
    setPendingQualityData(null);
  };

  const spokenDiagnosisText = diagnosis
    ? buildScanVoiceNarration(diagnosis, reportLang === 'en' ? 'en' : 'ur')
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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {(showAllCrops ? supportedCrops : supportedCrops.slice(0, 8)).map((c) => {
                const active = selectedCrop.toLowerCase() === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSelectedCrop(c.key)}
                    className={`min-h-[40px] px-2 rounded-xl font-extrabold text-[11px] sm:text-xs transition-all border ${
                      active
                        ? 'bg-[#062409] text-white border-[#062409] shadow-sm'
                        : c.key === 'auto'
                        ? 'bg-emerald-50 text-emerald-950 hover:bg-emerald-100 border-emerald-300'
                        : 'bg-canvas text-ink/80 hover:bg-olive/15 border-olive/15'
                    }`}
                  >
                    <span>{c[locale]}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowAllCrops((v) => !v)}
                className="text-[11px] font-extrabold text-olive hover:underline"
              >
                {showAllCrops
                  ? locale === 'ur'
                    ? 'کم فصلیں دکھائیں'
                    : 'Show fewer crops'
                  : locale === 'ur'
                  ? `مزید فصلیں اور باغات دیکھیں (${supportedCrops.length})`
                  : `Show all ${supportedCrops.length} crops & orchards`}
              </button>
            </div>
          </motion.section>
        )}

        {!diagnosis && !analysing && (
          <RegionSelectorBar
            locale={locale}
            region={region}
            onRegionChange={setRegion}
          />
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
              className="bg-white rounded-3xl p-6 sm:p-7 shadow-soft border border-olive/15 flex flex-col items-center text-center space-y-5"
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
              <div className="space-y-1.5">
                <h2 className="font-black text-lg text-ink">
                  {scanStage === 'validating_image'
                    ? locale === 'ur'
                      ? 'تصویر کی جانچ کی جا رہی ہے...'
                      : 'Validating image file...'
                    : scanStage === 'processing'
                    ? locale === 'ur'
                      ? 'تصویر کا معیار اور روشنی چیک ہو رہی ہے...'
                      : 'Checking clarity & optimizing photo...'
                    : locale === 'ur'
                    ? 'زرخیز کلاؤڈ وژن معائنہ جاری ہے...'
                    : 'Zarkhez Cloud Vision analyzing plant...'}
                </h2>
                <p className="text-xs text-ink/70">
                  {locale === 'ur'
                    ? 'فصل کی حقیقی شناخت، پودے کا حصہ، دھبے، موازنہ اور حفاظتی فلٹر جانچے جا رہے ہیں'
                    : 'Inspecting crop species, organ, symptoms, differential look-alikes & safety filters'}
                </p>
                <div className="flex flex-wrap justify-center gap-1.5 pt-1 text-[10px] font-bold">
                  {(
                    [
                      { key: 'validating_image', en: '1. File Check', ur: '1۔ فائل جانچ' },
                      { key: 'processing', en: '2. Clarity & Light', ur: '2۔ روشنی و صفائی' },
                      { key: 'analyzing_cloud', en: '3. AI & Differential', ur: '3۔ اے آئی تجزیہ و تقابل' },
                    ] as const
                  ).map((st) => {
                    const isCurrent = scanStage === st.key;
                    const isDone =
                      (scanStage === 'processing' && st.key === 'validating_image') ||
                      (scanStage === 'analyzing_cloud' && st.key !== 'analyzing_cloud');
                    return (
                      <span
                        key={st.key}
                        className={`px-2 py-0.5 rounded-full border ${
                          isDone
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : isCurrent
                            ? 'bg-[#062409] text-white border-[#062409]'
                            : 'bg-canvas text-ink/45 border-olive/15'
                        }`}
                      >
                        {locale === 'ur' ? st.ur : st.en}
                      </span>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCancelInFlight}
                className="px-5 py-2 rounded-full border border-olive/25 bg-canvas hover:bg-ink/10 text-xs font-bold text-ink/75 transition-all"
              >
                {locale === 'ur' ? 'معائنہ منسوخ کریں' : 'Cancel Scan'}
              </button>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Clean Urdu-First Structured Error State (Zero raw Zod dumps to farmer) */}
        {scanError && !analysing && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-5 sm:p-6 shadow-soft border-2 border-red-500/35 text-start space-y-4 mb-6"
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  scanError.error_category === 'network_or_timeout'
                    ? 'bg-amber-500/15 text-amber-700'
                    : 'bg-red-500/15 text-red-600'
                }`}
              >
                {scanError.error_category === 'network_or_timeout' ? (
                  <WifiOff className="w-6 h-6" />
                ) : (
                  <AlertTriangle className="w-6 h-6" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span
                  className={`text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full inline-block mb-1 ${
                    scanError.error_category === 'network_or_timeout'
                      ? 'text-amber-800 bg-amber-500/15'
                      : scanError.error_category === 'invalid_image_input'
                      ? 'text-orange-800 bg-orange-500/15'
                      : 'text-red-700 bg-red-500/10'
                  }`}
                >
                  {scanError.error_category === 'network_or_timeout'
                    ? locale === 'ur'
                      ? 'انٹرنیٹ کا مسئلہ'
                      : 'Connection Issue'
                    : scanError.error_category === 'rate_limited' ||
                      scanError.error_category === 'quota_exhausted'
                    ? locale === 'ur'
                      ? 'سروس مصروف ہے'
                      : 'Temporarily Busy'
                    : scanError.error_category === 'invalid_image_input'
                    ? locale === 'ur'
                      ? 'دوسری تصویر لگائیں'
                      : 'Photo Issue'
                    : scanError.error_category === 'permanent_config_error'
                    ? locale === 'ur'
                      ? 'سروس عارضی طور پر بند'
                      : 'Service Unavailable'
                    : locale === 'ur'
                    ? 'معائنہ مکمل نہیں ہو سکا'
                    : 'Scan Incomplete'}
                </span>
                <h3 className="font-black text-base sm:text-lg text-ink leading-snug">
                  {scanError.error_category === 'invalid_image_input'
                    ? locale === 'ur'
                      ? 'براہِ کرم پودے کی واضح تصویر منتخب کریں'
                      : 'Please Choose Another Plant Photo'
                    : scanError.error_category === 'permanent_config_error'
                    ? locale === 'ur'
                      ? 'یہ سروس اس وقت دستیاب نہیں ہے'
                      : 'Service Temporarily Unavailable'
                    : scanError.error_category === 'rate_limited' || scanError.error_category === 'quota_exhausted'
                    ? locale === 'ur'
                      ? 'اس وقت بہت سے کسان استعمال کر رہے ہیں'
                      : 'AI Scanning Is Busy Right Now'
                    : locale === 'ur'
                    ? 'پودے کا معائنہ مکمل نہیں ہو سکا'
                    : 'Could Not Complete Plant Scan'}
                </h3>
              </div>
            </div>

            {/* Preserved Image Preview Bar (when valid photo exists) */}
            {previewUrl && scanError.error_category !== 'invalid_image_input' && (
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-canvas border border-olive/20">
                <div className="w-14 h-14 rounded-xl overflow-hidden border border-olive/30 flex-shrink-0 bg-black/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl || previewUrl}
                    alt="Preserved crop foliage"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0 text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-800 font-extrabold text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                    <span>
                      {locale === 'ur' ? 'آپ کی تصویر محفوظ ہے' : 'Your photo is preserved'}
                    </span>
                  </div>
                  <p className="text-ink/65 text-[11px] mt-0.5 leading-tight">
                    {locale === 'ur'
                      ? 'دوبارہ تصویر لینے کی ضرورت نہیں؛ نیچے دیئے گئے بٹن سے دوبارہ کوشش کریں'
                      : 'No need to retake photo; tap retry to try again'}
                  </p>
                </div>
              </div>
            )}

            {/* Friendly Localized Message */}
            <p className="text-xs sm:text-sm text-ink/85 leading-relaxed bg-canvas p-3.5 rounded-2xl border border-olive/15 font-medium">
              {getLocalizedText(scanError.user_message, locale)}
            </p>

            {/* Primary Recovery Actions */}
            <div className="space-y-2 pt-1">
              {previewUrl && scanError.retryable && (
                <button
                  type="button"
                  onClick={handleRetryAnalysis}
                  disabled={analysing}
                  className="w-full min-h-[50px] rounded-full bg-gradient-to-r from-emerald-600 to-olive hover:from-emerald-700 hover:to-olive-dark text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
                >
                  <RotateCcw className={`w-4 h-4 ${analysing ? 'animate-spin' : ''}`} />
                  <span>
                    {locale === 'ur'
                      ? 'دوبارہ کوشش کریں (تصویر محفوظ ہے)'
                      : 'Try Again (Photo Preserved)'}
                  </span>
                </button>
              )}

              {/* Honest Offline Preliminary Check ONLY when online fails and image exists */}
              {previewUrl &&
                scanError.error_category !== 'invalid_image_input' && (
                  <button
                    type="button"
                    onClick={handleRunOfflinePreliminary}
                    className="w-full min-h-[46px] rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-950 font-extrabold text-xs flex items-center justify-center gap-2 border border-amber-500/35 transition-all"
                  >
                    <Eye className="w-4 h-4 text-amber-700" />
                    <span>
                      {locale === 'ur'
                        ? 'ابتدائی آف لائن تصویر چیک دیکھیں (غیر حتمی)'
                        : 'View Offline Preliminary Check'}
                    </span>
                  </button>
                )}

              <button
                type="button"
                onClick={resetScan}
                className="w-full min-h-[46px] rounded-full bg-canvas hover:bg-ink/10 text-ink/85 font-bold text-xs flex items-center justify-center gap-2 border border-olive/20 transition-all"
              >
                <Camera className="w-3.5 h-3.5 text-ink/60" />
                <span>
                  {scanError.error_category === 'invalid_image_input'
                    ? locale === 'ur'
                      ? 'پودے کی نئی واضح تصویر لیں'
                      : 'Take / Choose Valid Plant Photo'
                    : locale === 'ur'
                    ? 'نئی تصویر لیں / کینسل کریں'
                    : 'Take New Photo / Cancel'}
                </span>
              </button>
            </div>
          </motion.div>
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
                  {diagnosis.selected_crop || selectedCrop}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-500/40">
                <span className="text-[10px] font-bold text-emerald-800 block">
                  {locale === 'ur' ? 'اے آئی نے تصویر میں دیکھا:' : 'AI Detected in Photo:'}
                </span>
                <span className="font-extrabold text-sm text-emerald-900 block mt-0.5">
                  {(locale === 'ur' ? diagnosis.detected_crop_ur : diagnosis.detected_crop) ||
                    diagnosis.detected_crop}{' '}
                  ({(locale === 'ur' ? diagnosis.detected_plant_part_ur : diagnosis.detected_plant_part) ||
                    diagnosis.detected_plant_part})
                </span>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-ink/85 leading-relaxed bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 font-medium">
              {getLocalizedText(diagnosis.message, locale)}
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
                disabled={analysing}
                className="w-full min-h-[50px] rounded-full bg-gradient-to-r from-emerald-600 to-olive hover:from-emerald-700 hover:to-olive-dark text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
              >
                <Check className="w-4 h-4" />
                <span>
                  {locale === 'ur'
                    ? `جی ہاں، یہ ${diagnosis.detected_crop_ur || diagnosis.detected_crop} ہے (تشخیص جاری رکھیں)`
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
                  {getLocalizedText(diagnosis.problem_name, locale, 'Invalid Plant Image')}
                </h3>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-ink/80 leading-relaxed bg-canvas p-3.5 rounded-2xl border border-olive/15">
              {getLocalizedText(diagnosis.message, locale)}
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
              {/* Offline Assessment Clarity Banner (Never falsely presents offline check as Cloud AI) */}
              {diagnosis.inspection_source === 'offline_assessment' && (
                <div className="bg-amber-50 border-2 border-amber-500 rounded-2xl p-4 shadow-soft space-y-2">
                  <div className="flex items-start gap-2.5">
                    <WifiOff className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <span className="font-black text-amber-900 uppercase tracking-wide block">
                        {reportLang === 'en'
                          ? 'OFFLINE PRELIMINARY SCREENING (NOT CLOUD AI)'
                          : 'آف لائن ابتدائی جائزہ (یہ کلاؤڈ اے آئی تشخیص نہیں)'}
                      </span>
                      <p className="text-amber-950 font-medium leading-relaxed">
                        {getLocalizedText(diagnosis.confidence_limitations, reportLang)}
                      </p>
                    </div>
                  </div>
                  {previewUrl && (
                    <button
                      type="button"
                      onClick={handleRetryAnalysis}
                      className="w-full min-h-[42px] rounded-full bg-amber-600 hover:bg-amber-700 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>
                        {reportLang === 'en'
                          ? 'Retry Online Cloud Vision Analysis'
                          : 'دوبارہ آن لائن کلاؤڈ معائنہ کریں'}
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Retake Required Banner */}
              {diagnosis.requires_retake && (
                <div className="bg-orange-50 border-2 border-orange-500 rounded-2xl p-4 shadow-soft flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Camera className="w-5 h-5 text-orange-700 flex-shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <span className="font-black text-orange-950 block">
                        {reportLang === 'en'
                          ? 'Clearer Photo Needed'
                          : 'واضح تصویر دوبارہ درکار ہے'}
                      </span>
                      <p className="text-orange-900/90 mt-0.5 leading-snug">
                        {getLocalizedText(diagnosis.message, reportLang)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetScan}
                    className="px-3.5 py-2 rounded-full bg-orange-600 text-white font-black text-[11px] flex-shrink-0"
                  >
                    {reportLang === 'en' ? 'Retake' : 'دوبارہ لیں'}
                  </button>
                </div>
              )}

              {/* Language Selector Bar (Urdu & English only) */}
              <div className="bg-white rounded-2xl p-2 shadow-soft border border-olive/15 flex items-center justify-between gap-1">
                <span className="text-[11px] font-black text-ink/60 px-2">
                  {reportLang === 'ur' ? 'زبان منتخب کریں:' : 'Report Language:'}
                </span>
                <div className="flex items-center gap-1 overflow-x-auto">
                  {(
                    [
                      { key: 'ur', label: 'اردو' },
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
                        className={`px-3 py-1 rounded-xl text-xs font-black transition-all ${
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

              {/* Main Simple & Clear Result Card */}
              <div className="bg-white rounded-3xl p-5 shadow-soft border border-olive/15 space-y-4">
                {/* 1. Scanned Plant Photo + Optional Lesion Highlights */}
                {previewUrl && (
                  <div className="relative rounded-2xl overflow-hidden border-2 border-olive/20 shadow-md bg-black select-none">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Scanned plant"
                      className="w-full h-64 sm:h-72 object-cover"
                    />

                    {viewMode === 'annotated' &&
                      diagnosis.visual_inspection?.detected_hotspots &&
                      diagnosis.visual_inspection.detected_hotspots.map((box, idx) => (
                        <div
                          key={idx}
                          style={{
                            left: `${Math.max(0, Math.min(90, box.x))}%`,
                            top: `${Math.max(0, Math.min(90, box.y))}%`,
                            width: `${Math.max(10, Math.min(100 - box.x, box.w))}%`,
                            height: `${Math.max(10, Math.min(100 - box.y, box.h))}%`,
                          }}
                          className="absolute border-2 border-red-500 bg-red-500/20 rounded-lg pointer-events-none transition-all flex flex-col justify-between p-1 z-10"
                        >
                          <span className="text-[9px] font-black text-white bg-black/80 px-1.5 py-0.5 rounded shadow self-start">
                            {box.label || `#${idx + 1}`}
                          </span>
                        </div>
                      ))}

                    <div className="absolute top-2.5 right-2.5 rtl:right-auto rtl:left-2.5 flex items-center gap-1.5 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 text-white text-[11px] font-extrabold z-20">
                      <button
                        type="button"
                        onClick={() => setViewMode(viewMode === 'annotated' ? 'original' : 'annotated')}
                        className="flex items-center gap-1.5 hover:text-emerald-300 transition-colors"
                      >
                        {viewMode === 'annotated' ? (
                          <>
                            <Eye className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{reportLang === 'en' ? 'Hide Marks' : 'نشانات چھپائیں'}</span>
                          </>
                        ) : (
                          <>
                            <Crosshair className="w-3.5 h-3.5 text-red-400" />
                            <span>{reportLang === 'en' ? 'Show Marks' : 'نشانات دکھائیں'}</span>
                          </>
                        )}
                      </button>
                    </div>

                    {diagnosis.visual_inspection?.affected_area_pct !== undefined &&
                      diagnosis.visual_inspection.affected_area_pct > 0 && (
                        <div className="absolute bottom-2.5 left-2.5 rtl:left-auto rtl:right-2.5 bg-black/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/20 text-white text-xs flex items-center gap-2 z-20">
                          <span className="font-bold">
                            {reportLang === 'en' ? 'Affected Part:' : 'متاثرہ حصہ:'}{' '}
                            <strong className="text-emerald-400 font-black">
                              {diagnosis.visual_inspection.affected_area_pct}%
                            </strong>
                          </span>
                        </div>
                      )}
                  </div>
                )}

                {/* 2. Clear Summary Header (100% Localized, Zero Raw Technical Slugs) */}
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300/60">
                      {reportLang === 'en' ? diagnosis.detected_crop : diagnosis.detected_crop_ur}
                    </span>

                    <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-olive/15 text-olive-dark">
                      {reportLang === 'en'
                        ? diagnosis.detected_plant_part
                        : diagnosis.detected_plant_part_ur}
                    </span>

                    {diagnosis.problem_category && (
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-canvas text-ink/80 border border-olive/20">
                        {formatProblemCategoryLabel(diagnosis.problem_category, reportLang)}
                      </span>
                    )}

                    <span
                      className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full ${
                        diagnosis.diagnosis_status === 'healthy_no_symptoms'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : diagnosis.severity === 'high'
                          ? 'bg-alert-red/15 text-alert-red'
                          : diagnosis.severity === 'medium'
                          ? 'bg-alert-amber/25 text-amber-900'
                          : 'bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      {diagnosis.diagnosis_status === 'healthy_no_symptoms'
                        ? reportLang === 'en' ? 'Healthy' : 'تندرست'
                        : diagnosis.severity === 'high'
                        ? reportLang === 'en' ? 'High Risk' : 'زیادہ شدت'
                        : diagnosis.severity === 'medium'
                        ? reportLang === 'en' ? 'Medium Risk' : 'درمیانی شدت'
                        : diagnosis.severity === 'not_assessed'
                        ? reportLang === 'en' ? 'Needs Check' : 'معائنہ درکار'
                        : reportLang === 'en' ? 'Low Risk' : 'ہلکی شدت'}
                    </span>

                    {diagnosis.inspection_source !== 'offline_assessment' && (
                      <span className="text-[11px] font-extrabold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-emerald-600" />
                        <span>
                          {Math.round((diagnosis.identification_confidence || 0) * 100)}%{' '}
                          {reportLang === 'en' ? 'Sure' : 'یقین'}
                        </span>
                      </span>
                    )}
                  </div>

                  <h2 className="font-black text-xl sm:text-2xl text-ink leading-tight">
                    {getLocalizedText(diagnosis.problem_name, reportLang)}
                  </h2>

                  <p className="text-xs sm:text-sm text-ink/85 font-medium leading-relaxed bg-canvas/80 p-3.5 rounded-2xl border border-olive/10">
                    {diagnosis.explanations?.farmer_friendly
                      ? getLocalizedText(diagnosis.explanations.farmer_friendly, reportLang)
                      : getLocalizedText(diagnosis.why_suspected, reportLang) || diagnosis.plant_condition}
                  </p>
                </div>

                {/* 3. Listen in Voice */}
                <div className="space-y-1.5">
                  <div className="rounded-2xl p-3.5 bg-gradient-to-r from-emerald-500/10 via-olive/10 to-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                        <Volume2 className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-xs font-black text-ink block">
                          {reportLang === 'en' ? 'Listen to Summary' : 'آواز میں خلاصہ سنیں'}
                        </span>
                        <p className="text-[11px] text-ink/75 leading-tight">
                          {reportLang === 'en' ? 'Clear spoken explanation' : 'آسان الفاظ میں مکمل رہنمائی'}
                        </p>
                      </div>
                    </div>

                    <ReadAloudButton
                      text={spokenDiagnosisText}
                      lang={reportLang === 'en' ? 'en' : 'ur'}
                    />
                  </div>
                  {voiceErrorMsg && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200 font-medium">
                      {voiceErrorMsg}
                    </p>
                  )}
                </div>

                {/* 4. What Is Visible & Why (Clean Bullets) */}
                {((diagnosis.observed_symptoms && diagnosis.observed_symptoms.length > 0) ||
                  (diagnosis.possible_causes && diagnosis.possible_causes.length > 0)) && (
                  <div className="bg-canvas/80 p-4 rounded-2xl border border-olive/15 space-y-3 text-xs sm:text-sm">
                    {diagnosis.observed_symptoms && diagnosis.observed_symptoms.length > 0 && (
                      <div className="space-y-1.5">
                        <h3 className="font-black text-ink flex items-center gap-1.5 text-xs uppercase tracking-wide">
                          <Leaf className="w-4 h-4 text-olive" />
                          <span>
                            {reportLang === 'en' ? 'Signs Seen on Plant:' : 'پودے پر نظر آنے والی علامات:'}
                          </span>
                        </h3>
                        <ul className="space-y-1 text-ink/85 font-medium">
                          {diagnosis.observed_symptoms.map((sym, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-olive font-black">•</span>
                              <span>{getLocalizedText(sym, reportLang)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {diagnosis.possible_causes && diagnosis.possible_causes.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-olive/10">
                        <h3 className="font-black text-amber-900 text-xs uppercase tracking-wide">
                          {reportLang === 'en' ? 'Likely Reason:' : 'ممکنہ وجہ:'}
                        </h3>
                        <ul className="space-y-1 text-ink/85 font-medium">
                          {diagnosis.possible_causes.map((cause, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-amber-600 font-black">•</span>
                              <span>{getLocalizedText(cause, reportLang)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. Clear What-To-Do Action Plan (Deduplicated & Easy to Read) */}
                {(() => {
                  const immediate = diagnosis.treatment_pillars?.immediate_actions || [];
                  const steps =
                    immediate.length > 0 ? immediate : diagnosis.recommendations || [];
                  const seenCare = new Set<string>();
                  const careList = [
                    ...(diagnosis.treatment_pillars?.cultural_management || []),
                    ...(diagnosis.prevention || []),
                  ].filter((item) => {
                    const text = getLocalizedText(item, reportLang).trim();
                    if (!text || seenCare.has(text.toLowerCase())) return false;
                    seenCare.add(text.toLowerCase());
                    return true;
                  });
                  const chemicals = diagnosis.treatment_pillars?.chemical_management || [];
                  const bio = diagnosis.treatment_pillars?.biological_management || [];

                  return (
                    <div className="space-y-3">
                      {steps.length > 0 && (
                        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 space-y-2">
                          <h3 className="font-black text-sm text-ink flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>
                              {reportLang === 'en' ? 'What To Do Now:' : 'ابھی کیا کریں (آسان اقدامات):'}
                            </span>
                          </h3>
                          <ol className="space-y-2 text-xs sm:text-sm text-ink font-medium">
                            {steps.map((act, i) => (
                              <li key={i} className="flex items-start gap-2.5">
                                <span className="w-5 h-5 rounded-full bg-emerald-700 text-white text-[11px] font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                                  {i + 1}
                                </span>
                                <span className="leading-relaxed">
                                  {getLocalizedText(act, reportLang)}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {careList.length > 0 && (
                        <div className="bg-canvas/70 border border-olive/15 rounded-2xl p-4 space-y-1.5">
                          <h3 className="font-black text-xs text-olive-dark uppercase flex items-center gap-1.5">
                            <Sun className="w-3.5 h-3.5 text-amber-600" />
                            <span>
                              {reportLang === 'en' ? 'Care & Prevention Tips:' : 'بچاؤ اور دیکھ بھال:'}
                            </span>
                          </h3>
                          <ul className="space-y-1 text-xs text-ink/85 font-medium">
                            {careList.slice(0, 4).map((pv, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span className="text-olive font-black">•</span>
                                <span>{getLocalizedText(pv, reportLang)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {(chemicals.length > 0 || bio.length > 0) && (
                        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 space-y-2 text-xs">
                          <h3 className="font-black text-amber-950 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-amber-700" />
                            <span>
                              {reportLang === 'en'
                                ? 'Safe Treatment Options (Confirm With Local Expert):'
                                : 'حفاظتی علاج و دوا کی رہنمائی (زرعی افسر سے تصدیق کے بعد):'}
                            </span>
                          </h3>
                          {bio.map((b, i) => (
                            <p key={`bio-${i}`} className="text-emerald-950 font-medium">
                              • {getLocalizedText(b, reportLang)}
                            </p>
                          ))}
                          {chemicals.map((chem, i) => (
                            <div key={`ch-${i}`} className="bg-white/90 p-2.5 rounded-xl border border-amber-200 space-y-1">
                              <strong className="text-ink block">{chem.active_ingredient}</strong>
                              <p className="text-ink/80">{getLocalizedText(chem.purpose, reportLang)}</p>
                              <p className="text-amber-900 font-medium">
                                {getLocalizedText(chem.safety_precautions, reportLang)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Single Clear Expert Advice Note (Only when needed — never repeated twice) */}
                {diagnosis.requires_expert_review && diagnosis.when_to_consult_expert && (
                  <div className="bg-cream border border-alert-amber/50 rounded-2xl p-3.5 flex items-start gap-2.5 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-ink block">
                        {reportLang === 'en' ? 'When To Ask a Local Expert:' : 'زرعی ماہر کو کب دکھائیں:'}
                      </strong>
                      <p className="text-ink/85 mt-0.5 leading-relaxed">
                        {getLocalizedText(diagnosis.when_to_consult_expert, reportLang)}
                      </p>
                    </div>
                  </div>
                )}

                {/* Collapsible Advanced / Scientific / Feedback Section (Cleanly tucked away) */}
                <TechnicalDetailsDrawer
                  diagnosis={diagnosis}
                  reportLang={reportLang}
                  region={region}
                />

                {/* Actions: Save to Farm Diary & Scan Another */}
                <div className="space-y-2 pt-2">
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={handleSaveToDiary}
                      disabled={savedToDiary || savingToDiary}
                      className={`min-h-[48px] rounded-full font-extrabold text-xs flex items-center justify-center gap-1.5 transition-all ${
                        savedToDiary
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-white hover:bg-canvas text-ink border-2 border-olive/30 shadow-sm'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>
                        {savingToDiary
                          ? locale === 'ur'
                            ? 'محفوظ ہو رہا ہے...'
                            : 'Saving...'
                          : savedToDiary
                          ? t('savedToDiary')
                          : t('saveToDiary')}
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
                          : 'نیا پودا اسکین کریں'}
                      </span>
                    </button>
                  </div>
                  {diarySaveNote && (
                    <p className="text-[11px] text-ink/70 text-center font-medium">
                      {diarySaveNote}
                    </p>
                  )}
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

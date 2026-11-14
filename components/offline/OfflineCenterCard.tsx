'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Volume2,
  Wifi,
  WifiOff,
  XCircle,
  AlertTriangle,
  PackageCheck,
} from 'lucide-react';
import {
  detectDeviceCapabilities,
  formatBytes,
  type DeviceCapabilityReport,
} from '@/lib/offline/config';
import { useOfflineConnectivity } from '@/lib/offline/connectivity';
import {
  clearAllOfflineCachesAndStores,
  getOfflineStorageSummary,
  type OfflineModelRecord,
  type OfflineStorageSummary,
  type SyncOutboxRecord,
} from '@/lib/offline/db';
import { syncGuidesToOfflineDb } from '@/lib/offline/knowledge-base';
import {
  cancelModelDownload,
  deleteVisionModel,
  downloadAndVerifyVisionModel,
  getVisionModelStatus,
  VISION_MODEL_SPEC,
  type DownloadProgress,
} from '@/lib/offline/model-manager';
import { syncSchemesToOfflineDb } from '@/lib/offline/schemes';
import { flushSyncOutbox, listSyncOutbox, type SyncFlushResult } from '@/lib/offline/sync';
import {
  auditOfflineVoiceCapabilities,
  type OfflineVoiceAudit,
} from '@/lib/offline/voice-offline';

export function OfflineCenterCard() {
  const locale = useLocale() as 'en' | 'ur';
  const { isOnline } = useOfflineConnectivity();

  const [caps, setCaps] = useState<DeviceCapabilityReport | null>(null);
  const [storage, setStorage] = useState<OfflineStorageSummary | null>(null);
  const [visionModel, setVisionModel] = useState<OfflineModelRecord | null>(null);
  const [voiceAudit, setVoiceAudit] = useState<OfflineVoiceAudit | null>(null);
  const [outbox, setOutbox] = useState<SyncOutboxRecord[]>([]);

  const [downloadingModel, setDownloadingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [preparingBundle, setPreparingBundle] = useState(false);
  const [bundleReadyBanner, setBundleReadyBanner] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncFlushResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [c, s, m, v, q] = await Promise.all([
        detectDeviceCapabilities(),
        getOfflineStorageSummary(),
        getVisionModelStatus(),
        auditOfflineVoiceCapabilities(locale),
        listSyncOutbox(),
      ]);
      setCaps(c);
      setStorage(s);
      setVisionModel(m);
      setVoiceAudit(v);
      setOutbox(q);
    } catch {
      // ignore IndexedDB initialization race
    }
  }, [locale]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handlePrepareEssentialPack = async () => {
    setPreparingBundle(true);
    setErrorMsg(null);
    setBundleReadyBanner(null);
    try {
      const [guideCount, schemeCount] = await Promise.all([
        syncGuidesToOfflineDb(),
        syncSchemesToOfflineDb(),
      ]);

      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && isOnline) {
        const reg = await navigator.serviceWorker.ready.catch(() => null);
        reg?.active?.postMessage({
          type: 'WARM_SHELL',
          urls: [
            `/${locale}/home`,
            `/${locale}/weather`,
            `/${locale}/scan`,
            `/${locale}/assistant`,
            `/${locale}/diary`,
            `/${locale}/tools/calendar`,
            `/${locale}/tools/fertilizer`,
            `/${locale}/schemes`,
            `/${locale}/offline-center`,
          ],
        });
      }

      await refreshAll();
      setBundleReadyBanner(
        locale === 'ur'
          ? `ضروری آف لائن پیک محفوظ: ${guideCount} زرعی گائیڈز اور ${schemeCount} تصدیق شدہ اسکیمیں۔`
          : `Essential Offline Pack ready: ${guideCount} farming guides & ${schemeCount} verified schemes saved locally.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to prepare offline bundle');
    } finally {
      setPreparingBundle(false);
    }
  };

  const handleDownloadVisionModel = async () => {
    setDownloadingModel(true);
    setErrorMsg(null);
    setDownloadProgress({
      modelId: VISION_MODEL_SPEC.modelId,
      phase: 'checking',
      loadedBytes: 0,
      totalBytes: VISION_MODEL_SPEC.totalApproximateBytes,
      percent: 0,
    });
    try {
      await downloadAndVerifyVisionModel((prog) => {
        setDownloadProgress(prog);
      });
      await refreshAll();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setErrorMsg(err instanceof Error ? err.message : 'Model download failed');
      }
      await refreshAll();
    } finally {
      setDownloadingModel(false);
      setDownloadProgress(null);
    }
  };

  const handleCancelDownload = () => {
    cancelModelDownload(VISION_MODEL_SPEC.modelId);
    setDownloadingModel(false);
    setDownloadProgress(null);
  };

  const handleDeleteModel = async () => {
    await deleteVisionModel();
    await refreshAll();
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setErrorMsg(null);
    try {
      const res = await flushSyncOutbox({ forceRetry: true });
      setSyncResult(res);
      await refreshAll();
    } finally {
      setSyncing(false);
    }
  };

  const handleClearAllOfflineData = async () => {
    await clearAllOfflineCachesAndStores();
    setBundleReadyBanner(null);
    setSyncResult(null);
    await refreshAll();
  };

  const isVisionInstalled = visionModel?.status === 'installed';
  const pendingCount = outbox.filter(
    (x) => x.status === 'pending' || x.status === 'failed'
  ).length;
  const conflictCount = outbox.filter((x) => x.status === 'conflict').length;

  return (
    <div className="space-y-4">
      {/* Connection Status Banner */}
      <section className="bg-white rounded-card p-4 shadow-soft border border-olive/15 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${
              isOnline
                ? 'bg-emerald-500/15 text-olive-dark'
                : 'bg-alert-amber/20 text-alert-amber'
            }`}
          >
            {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <h2 className="font-extrabold text-sm text-ink">
              {isOnline
                ? locale === 'ur'
                  ? 'انٹرنیٹ منسلک ہے (آن لائن موڈ فعال)'
                  : 'Connected Online (Live AI & Cloud Active)'
                : locale === 'ur'
                ? 'آف لائن موڈ (محفوظ ڈیٹا و مقامی ماڈلز فعال)'
                : 'Offline Mode (Local Data & Models Active)'}
            </h2>
            <p className="text-[11px] text-ink/65 mt-0.5 leading-snug">
              {locale === 'ur'
                ? 'انٹرنیٹ دستیاب ہونے پر ایپ ہمیشہ لائیو Gemini اور Supabase استعمال کرتی ہے۔'
                : 'Zarkhez always keeps your existing online Gemini & Supabase features active whenever internet is available.'}
            </p>
          </div>
        </div>
      </section>

      {errorMsg && (
        <div className="p-3 rounded-2xl bg-alert-red/10 border border-alert-red/30 text-alert-red text-xs font-bold flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {bundleReadyBanner && (
        <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 text-olive-dark text-xs font-bold flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{bundleReadyBanner}</span>
        </div>
      )}

      {/* Card 1: Prepare Essential Offline Data Pack */}
      <section className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/15 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-olive/12 text-olive-dark flex items-center justify-center flex-shrink-0">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-ink">
                {locale === 'ur'
                  ? 'آف لائن استعمال کی تیاری (ضروری پیک)'
                  : 'Prepare for Offline Use (Essential Pack)'}
              </h3>
              <p className="text-[11px] text-ink/65">
                {locale === 'ur'
                  ? 'زرعی گائیڈز، کھاد شیڈول، سرکاری اسکیمیں اور اسکرینز (~0.5 MB)'
                  : 'Crop guides, fertilizer stages, verified govt schemes & app screens (~0.5 MB)'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-canvas rounded-xl p-2.5 border border-olive/10">
            <span className="block font-extrabold text-base text-olive-dark">
              {storage?.storeCounts.farmingGuides ?? 0}
            </span>
            <span className="text-[10px] font-bold text-ink/65">
              {locale === 'ur' ? 'زرعی گائیڈز' : 'Guides'}
            </span>
          </div>
          <div className="bg-canvas rounded-xl p-2.5 border border-olive/10">
            <span className="block font-extrabold text-base text-olive-dark">
              {storage?.storeCounts.schemes ?? 0}
            </span>
            <span className="text-[10px] font-bold text-ink/65">
              {locale === 'ur' ? 'سرکاری اسکیمیں' : 'Schemes'}
            </span>
          </div>
          <div className="bg-canvas rounded-xl p-2.5 border border-olive/10">
            <span className="block font-extrabold text-base text-olive-dark">
              {storage?.storeCounts.weatherSnapshots ?? 0}
            </span>
            <span className="text-[10px] font-bold text-ink/65">
              {locale === 'ur' ? 'موسم اسنیپ شاٹس' : 'Weather Snaps'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handlePrepareEssentialPack}
          disabled={preparingBundle}
          className="w-full min-h-[46px] rounded-full bg-[#062409] hover:bg-olive-dark text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-soft transition-all disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          <span>
            {preparingBundle
              ? locale === 'ur'
                ? 'آف لائن پیک محفوظ ہو رہا ہے...'
                : 'Preparing Offline Bundle...'
              : locale === 'ur'
              ? 'ضروری آف لائن پیک ڈاؤن لوڈ / تازہ کریں'
              : 'Prepare / Refresh Essential Offline Pack'}
          </span>
        </button>
      </section>

      {/* Card 2: Opt-In On-Device Vision ONNX AI Model */}
      <section className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/15 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                isVisionInstalled
                  ? 'bg-emerald-500/15 text-olive-dark'
                  : 'bg-canvas text-ink/70 border border-olive/15'
              }`}
            >
              <ShieldCheck className="w-3 h-3" />
              {isVisionInstalled
                ? locale === 'ur'
                  ? 'انسٹال اور تصدیق شدہ'
                  : 'Installed & SHA-256 Verified'
                : locale === 'ur'
                ? 'اختیاری ڈاؤن لوڈ'
                : 'Opt-In On-Device AI Model'}
            </span>
            <h3 className="font-extrabold text-sm sm:text-base text-ink">
              {locale === 'ur'
                ? 'آف لائن پودے کی بیماری پہچان ماڈل (ONNX MobileNetV2)'
                : 'Offline Leaf Disease Scanner (MobileNetV2 ONNX)'}
            </h3>
            <p className="text-[11px] text-ink/70 leading-relaxed">
              {locale === 'ur'
                ? `اندازاً سائز: ~17.6 MB (2.7 MB ماڈل + 14.9 MB WASM رن ٹائم)۔ سپورٹڈ فصلیں: ٹماٹر، مکئی، آلو، مرچ، کینو۔ گندم، دھان، کپاس اور کماد کے لیے آن لائن کلاؤڈ AI ضروری ہے۔`
                : `Total size: ~17.6 MB (2.69 MB INT8 ONNX + 14.95 MB local WASM runtime). Covers Tomato, Maize, Potato, Chili & Citrus. Wheat, Rice, Cotton & Sugarcane require Online Cloud AI.`}
            </p>
          </div>
        </div>

        {downloadProgress && (
          <div className="space-y-1.5 bg-canvas p-3 rounded-xl border border-olive/15">
            <div className="flex items-center justify-between text-[11px] font-bold text-ink">
              <span>
                {downloadProgress.phase === 'downloading_runtime'
                  ? locale === 'ur'
                    ? 'WASM رن ٹائم کیش ہو رہا ہے...'
                    : 'Caching WASM runtime...'
                  : downloadProgress.phase === 'downloading_model'
                  ? locale === 'ur'
                    ? 'ONNX ماڈل ڈاؤن لوڈ ہو رہا ہے...'
                    : 'Downloading ONNX weights...'
                  : downloadProgress.phase === 'verifying'
                  ? locale === 'ur'
                    ? 'SHA-256 تصدیق جاری ہے...'
                    : 'Verifying SHA-256 checksum...'
                  : locale === 'ur'
                  ? 'تیار ہو رہا ہے...'
                  : 'Finalizing...'}
              </span>
              <span dir="ltr">
                {formatBytes(downloadProgress.loadedBytes)} /{' '}
                {formatBytes(downloadProgress.totalBytes)} ({downloadProgress.percent}%)
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-olive/15 overflow-hidden">
              <div
                className="h-full bg-olive transition-all duration-150"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!downloadingModel ? (
            <>
              <button
                type="button"
                onClick={handleDownloadVisionModel}
                disabled={!isOnline && !isVisionInstalled}
                className="flex-1 min-h-[44px] rounded-full bg-olive hover:bg-olive-dark text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-soft disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>
                  {isVisionInstalled
                    ? locale === 'ur'
                      ? 'ماڈل دوبارہ تصدیق کریں'
                      : 'Re-verify / Update Model'
                    : locale === 'ur'
                    ? 'ویژن AI ماڈل ڈاؤن لوڈ کریں'
                    : 'Download Offline Vision AI (~17.6 MB)'}
                </span>
              </button>
              {isVisionInstalled && (
                <button
                  type="button"
                  onClick={handleDeleteModel}
                  className="min-h-[44px] px-4 rounded-full bg-alert-red/10 text-alert-red font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{locale === 'ur' ? 'حذف کریں' : 'Delete'}</span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={handleCancelDownload}
              className="w-full min-h-[44px] rounded-full bg-alert-red/15 text-alert-red font-bold text-xs flex items-center justify-center gap-1.5"
            >
              <XCircle className="w-4 h-4" />
              <span>{locale === 'ur' ? 'ڈاؤن لوڈ منسوخ کریں' : 'Cancel Download'}</span>
            </button>
          )}
        </div>
      </section>

      {/* Card 3: Cloud Sync Outbox */}
      <section className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/15 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 text-olive-dark ${syncing ? 'animate-spin' : ''}`} />
            <h3 className="font-extrabold text-sm text-ink">
              {locale === 'ur' ? 'کلاؤڈ سنک قطار (Sync Queue)' : 'Background Sync Outbox'}
            </h3>
          </div>
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-canvas text-ink/75 border border-olive/15">
            {pendingCount} pending {conflictCount > 0 ? `• ${conflictCount} conflicts` : ''}
          </span>
        </div>

        <p className="text-[11px] text-ink/65 leading-snug">
          {locale === 'ur'
            ? 'آف لائن محفوظ کیے گئے کھیت، ڈائری اور اسکن انٹرنیٹ آتے ہی خودکار طور پر Supabase میں سنک ہو جاتے ہیں۔'
            : 'Fields, diary entries, and scan logs created offline queue safely and sync to Supabase automatically when you reconnect.'}
        </p>

        {syncResult && (
          <p className="text-[11px] font-bold text-olive-dark bg-emerald-50 rounded-xl px-3 py-2">
            {syncResult.skippedReason
              ? `Sync skipped (${syncResult.skippedReason})`
              : `Processed: ${syncResult.processed}, Synced: ${syncResult.synced}, Conflicts: ${syncResult.conflicts}, Failed: ${syncResult.failed}`}
          </p>
        )}

        <button
          type="button"
          onClick={handleManualSync}
          disabled={!isOnline || syncing}
          className="w-full min-h-[42px] rounded-full bg-canvas border border-olive/25 hover:bg-olive/10 text-ink font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>{locale === 'ur' ? 'ابھی سنک کریں' : 'Sync Queued Items Now'}</span>
        </button>
      </section>

      {/* Card 4: Hardware, Storage Quota & Voice Audit */}
      <section className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/15 space-y-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-olive-dark" />
          <h3 className="font-extrabold text-sm text-ink">
            {locale === 'ur'
              ? 'ڈیوائس صلاحیت، اسٹوریج اور آف لائن آواز'
              : 'Device Hardware, Storage & Voice Check'}
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-canvas rounded-xl p-2.5 border border-olive/10">
            <span className="text-[10px] text-ink/60 block">Hardware Tier</span>
            <span className="font-bold text-ink">
              {caps
                ? `${caps.deviceMemoryGb ?? '?'} GB RAM • ${caps.cpuCores ?? '?'} Cores (${
                    caps.hasWebGpu ? 'WebGPU+WASM' : caps.hasWasm ? 'WASM' : 'Basic'
                  })`
                : '...'}
            </span>
          </div>
          <div className="bg-canvas rounded-xl p-2.5 border border-olive/10">
            <span className="text-[10px] text-ink/60 block flex items-center gap-1">
              <HardDrive className="w-3 h-3" /> Browser Storage
            </span>
            <span className="font-bold text-ink">
              {storage?.usageBytes !== null && storage?.usageBytes !== undefined
                ? `${formatBytes(storage.usageBytes)} used (${formatBytes(
                    storage.modelsCacheBytes
                  )} models)`
                : 'Protected Quota'}
            </span>
          </div>
        </div>

        {caps?.isLowEndDevice && (
          <p className="text-[11px] font-bold text-amber-800 bg-amber-500/10 rounded-xl p-2.5 border border-amber-500/25">
            {locale === 'ur'
              ? 'کم میموری والی ڈیوائس detected: لائیٹ آف لائن گائیڈز بہترین چلیں گی؛ بڑے مقامی ماڈلز سست ہو سکتے ہیں۔'
              : 'Low-memory device detected: Essential Offline Guides run fast; heavy local neural models are restricted for stability.'}
          </p>
        )}

        {voiceAudit && (
          <div className="bg-canvas rounded-xl p-3 border border-olive/10 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-olive-dark">
              <Volume2 className="w-3.5 h-3.5" />
              <span>
                {locale === 'ur' ? 'آف لائن آواز کا معائنہ' : 'Offline Voice Capability'}
              </span>
            </div>
            <p className="text-[11px] text-ink/75 leading-relaxed">
              {voiceAudit.honestNotice[locale]}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={handleClearAllOfflineData}
          className="w-full min-h-[40px] rounded-xl bg-alert-red/10 hover:bg-alert-red/15 text-alert-red font-bold text-xs flex items-center justify-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>
            {locale === 'ur'
              ? 'تمام آف لائن ماڈلز اور کیش صاف کریں'
              : 'Clear Offline Caches & Downloaded Models'}
          </span>
        </button>
      </section>
    </div>
  );
}

'use client';

/**
 * ZARKHEZ Isolated Offline Architecture — Configuration & Feature Flags
 *
 * Zero-Regression Rule:
 * - Online features remain 100% primary whenever internet is available.
 * - Each offline subsystem is independently toggled via OFFLINE_FLAGS.
 */

export interface OfflineFeatureFlags {
  enabled: boolean;
  offlineDb: boolean;
  weatherCache: boolean;
  fertilizerGuide: boolean;
  farmingGuides: boolean;
  schemes: boolean;
  onnxCropScanner: boolean;
  offlineChatKb: boolean;
  localLlmOptIn: boolean;
  voiceOfflineCache: boolean;
  syncOutbox: boolean;
}

export const DEFAULT_OFFLINE_FLAGS: OfflineFeatureFlags = {
  enabled: true,
  offlineDb: true,
  weatherCache: true,
  fertilizerGuide: true,
  farmingGuides: true,
  schemes: true,
  onnxCropScanner: true,
  offlineChatKb: true,
  localLlmOptIn: true,
  voiceOfflineCache: true,
  syncOutbox: true,
};

export const OFFLINE_CACHE_NAMESPACES = {
  MODELS: 'zarkhez-offline-models-v1',
  KB_ASSETS: 'zarkhez-offline-kb-v1',
  VOICE_TTS: 'zarkhez-tts-v4',
} as const;

export const OFFLINE_DB_NAME = 'zarkhez_offline_v2';
export const OFFLINE_DB_VERSION = 3;
export const OFFLINE_STATE_CHANGED_EVENT = 'zarkhez:offline-updated';

export function notifyOfflineStateChanged(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_STATE_CHANGED_EVENT));
  } catch {
    // ignore in restricted contexts
  }
}

export function isLikelyLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemoryGb =
    typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : null;
  const cpuCores =
    typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency > 0
      ? navigator.hardwareConcurrency
      : null;
  return (
    (deviceMemoryGb !== null && deviceMemoryGb <= 2) ||
    (cpuCores !== null && cpuCores <= 2)
  );
}

const FLAGS_STORAGE_KEY = 'zarkhez_offline_flags_v1';

export function getOfflineFlags(): OfflineFeatureFlags {
  if (typeof window === 'undefined') return DEFAULT_OFFLINE_FLAGS;
  try {
    const raw = window.localStorage.getItem(FLAGS_STORAGE_KEY);
    if (!raw) return DEFAULT_OFFLINE_FLAGS;
    const parsed = JSON.parse(raw) as Partial<OfflineFeatureFlags>;
    return {
      ...DEFAULT_OFFLINE_FLAGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_OFFLINE_FLAGS;
  }
}

export function setOfflineFlagOverride(
  patch: Partial<OfflineFeatureFlags>
): OfflineFeatureFlags {
  const next = { ...getOfflineFlags(), ...patch };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(FLAGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failure
    }
  }
  return next;
}

export interface DeviceCapabilityReport {
  deviceMemoryGb: number | null;
  cpuCores: number | null;
  hasWasm: boolean;
  hasWebGpu: boolean;
  hasServiceWorker: boolean;
  hasIndexedDb: boolean;
  hasCacheApi: boolean;
  storageQuotaBytes: number | null;
  storageUsageBytes: number | null;
  storageAvailableBytes: number | null;
  isLowEndDevice: boolean;
  canRunVisionOnnx: boolean;
  canRunLocalLlm: boolean;
  recommendedTier: 'full' | 'standard' | 'light';
}

export async function detectDeviceCapabilities(): Promise<DeviceCapabilityReport> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      deviceMemoryGb: null,
      cpuCores: null,
      hasWasm: false,
      hasWebGpu: false,
      hasServiceWorker: false,
      hasIndexedDb: false,
      hasCacheApi: false,
      storageQuotaBytes: null,
      storageUsageBytes: null,
      storageAvailableBytes: null,
      isLowEndDevice: false,
      canRunVisionOnnx: false,
      canRunLocalLlm: false,
      recommendedTier: 'light',
    };
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: unknown;
  };
  const deviceMemoryGb =
    typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0
      ? nav.deviceMemory
      : null;
  const cpuCores =
    typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency > 0
      ? navigator.hardwareConcurrency
      : null;
  const hasWasm = typeof WebAssembly !== 'undefined';
  const hasWebGpu = Boolean(nav.gpu);
  const hasServiceWorker = 'serviceWorker' in navigator;
  const hasIndexedDb = typeof indexedDB !== 'undefined';
  const hasCacheApi = typeof caches !== 'undefined';

  let storageQuotaBytes: number | null = null;
  let storageUsageBytes: number | null = null;
  let storageAvailableBytes: number | null = null;

  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      storageQuotaBytes = typeof est.quota === 'number' ? est.quota : null;
      storageUsageBytes = typeof est.usage === 'number' ? est.usage : null;
      if (storageQuotaBytes !== null && storageUsageBytes !== null) {
        storageAvailableBytes = Math.max(0, storageQuotaBytes - storageUsageBytes);
      }
    }
  } catch {
    // ignore browser restriction
  }

  const isLowEndDevice =
    (deviceMemoryGb !== null && deviceMemoryGb <= 2) ||
    (cpuCores !== null && cpuCores <= 2);

  const canRunVisionOnnx = hasWasm && hasIndexedDb;
  const canRunLocalLlm =
    hasWasm &&
    hasIndexedDb &&
    (deviceMemoryGb === null || deviceMemoryGb >= 4) &&
    (cpuCores === null || cpuCores >= 4) &&
    (storageAvailableBytes === null || storageAvailableBytes >= 220 * 1024 * 1024);

  const recommendedTier: 'full' | 'standard' | 'light' = isLowEndDevice
    ? 'light'
    : canRunLocalLlm
    ? 'full'
    : 'standard';

  return {
    deviceMemoryGb,
    cpuCores,
    hasWasm,
    hasWebGpu,
    hasServiceWorker,
    hasIndexedDb,
    hasCacheApi,
    storageQuotaBytes,
    storageUsageBytes,
    storageAvailableBytes,
    isLowEndDevice,
    canRunVisionOnnx,
    canRunLocalLlm,
    recommendedTier,
  };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

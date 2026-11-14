'use client';

import { OFFLINE_CACHE_NAMESPACES, detectDeviceCapabilities } from './config';
import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  OFFLINE_STORES,
  type OfflineModelRecord,
} from './db';

/**
 * ZARKHEZ Offline Model & Bundle Manager
 *
 * Manages opt-in download, streaming progress, cancellation, SHA-256 verification,
 * compatibility checks, and deletion for the quantized PlantVillage ONNX vision model
 * plus its self-hosted ONNX Runtime WASM runtime files.
 */

export const VISION_MODEL_ID = 'plantvillage-mobilenetv2-q8';
export const VISION_MODEL_CACHE_URL = '/_offline/models/plantvillage-mobilenetv2-q8.onnx';

export const VISION_MODEL_SPEC = {
  modelId: VISION_MODEL_ID,
  name: 'PlantVillage Crop Leaf ONNX (MobileNetV2 Quantized)',
  version: '1.0-int8',
  license: 'MIT Runtime + Open PlantVillage Weights',
  remoteUrl:
    'https://huggingface.co/onnx-community/mobilenet_v2_1.0_224-plant-disease-identification-ONNX/resolve/main/onnx/model_quantized.onnx',
  expectedBytes: 2_687_606,
  expectedSha256:
    '40fa4e13b5e555c1a6f3819751400ad6f923a42cf932306042b8efb53eca20fc',
  ortRuntimeFiles: [
    '/onnxruntime/ort.wasm.bundle.min.mjs',
    '/onnxruntime/ort-wasm-simd-threaded.mjs',
    '/onnxruntime/ort-wasm-simd-threaded.wasm',
    '/workers/plant-disease.worker.js',
  ],
  totalApproximateBytes: 17_638_220, // ~2.69 MB model + ~14.95 MB self-hosted WASM runtime
} as const;

export interface DownloadProgress {
  modelId: string;
  phase: 'checking' | 'downloading_runtime' | 'downloading_model' | 'verifying' | 'saving' | 'done';
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

const activeControllers = new Map<string, AbortController>();

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return '';
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function fetchWithProgress(
  url: string,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }
  const headerTotal = Number(response.headers.get('content-length') || 0);
  if (!response.body) {
    const buf = await response.arrayBuffer();
    onProgress(buf.byteLength, headerTotal || buf.byteLength);
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, headerTotal || loaded);
    }
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export async function getVisionModelStatus(): Promise<OfflineModelRecord | null> {
  const rec = await idbGet<OfflineModelRecord>(OFFLINE_STORES.MODELS, VISION_MODEL_ID);
  if (
    rec &&
    rec.status === 'downloading' &&
    !activeControllers.has(VISION_MODEL_ID) &&
    Date.now() - (rec.updatedAt || 0) > 60_000
  ) {
    // Recover stale interrupted download status left by closed tab/crash
    const recovered: OfflineModelRecord = {
      ...rec,
      status: 'error',
      errorMessage: 'Previous download was interrupted. Tap to resume or retry.',
      updatedAt: Date.now(),
    };
    await idbPut(OFFLINE_STORES.MODELS, recovered);
    return recovered;
  }
  return rec;
}

export async function listOfflineModels(): Promise<OfflineModelRecord[]> {
  return idbGetAll<OfflineModelRecord>(OFFLINE_STORES.MODELS);
}

export async function isVisionModelReadyOffline(): Promise<boolean> {
  const record = await getVisionModelStatus();
  if (!record || record.status !== 'installed') return false;
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(OFFLINE_CACHE_NAMESPACES.MODELS);
    const modelMatch = await cache.match(VISION_MODEL_CACHE_URL);
    if (!modelMatch) return false;
    const runtimeChecks = await Promise.all(
      VISION_MODEL_SPEC.ortRuntimeFiles.map((path) => cache.match(path))
    );
    return runtimeChecks.every(Boolean);
  } catch {
    return false;
  }
}

export function cancelModelDownload(modelId: string = VISION_MODEL_ID): void {
  const controller = activeControllers.get(modelId);
  if (controller) {
    controller.abort();
    activeControllers.delete(modelId);
  }
}

export async function deleteVisionModel(): Promise<boolean> {
  cancelModelDownload(VISION_MODEL_ID);
  import('./crop-scanner')
    .then(({ disposeOfflineVisionWorker }) => disposeOfflineVisionWorker())
    .catch(() => {});
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(OFFLINE_CACHE_NAMESPACES.MODELS);
      await cache.delete(VISION_MODEL_CACHE_URL);
      for (const runtimePath of VISION_MODEL_SPEC.ortRuntimeFiles) {
        await cache.delete(runtimePath);
      }
    } catch {
      // ignore
    }
  }
  return idbDelete(OFFLINE_STORES.MODELS, VISION_MODEL_ID);
}

export async function downloadAndVerifyVisionModel(
  onProgress?: (progress: DownloadProgress) => void
): Promise<OfflineModelRecord> {
  const existingController = activeControllers.get(VISION_MODEL_ID);
  if (existingController) {
    existingController.abort();
  }

  const controller = new AbortController();
  activeControllers.set(VISION_MODEL_ID, controller);

  const emit = (
    phase: DownloadProgress['phase'],
    loadedBytes: number,
    totalBytes: number
  ) => {
    const pct = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0;
    onProgress?.({
      modelId: VISION_MODEL_ID,
      phase,
      loadedBytes,
      totalBytes,
      percent: pct,
    });
  };

  try {
    emit('checking', 0, VISION_MODEL_SPEC.totalApproximateBytes);
    const caps = await detectDeviceCapabilities();
    if (!caps.canRunVisionOnnx) {
      throw new Error('This device or browser does not support WebAssembly/IndexedDB required for offline ONNX inference.');
    }
    if (
      caps.storageAvailableBytes !== null &&
      caps.storageAvailableBytes < VISION_MODEL_SPEC.totalApproximateBytes + 5 * 1024 * 1024
    ) {
      throw new Error('Insufficient free browser storage (at least 25 MB free space required).');
    }

    await idbPut<OfflineModelRecord>(OFFLINE_STORES.MODELS, {
      modelId: VISION_MODEL_ID,
      name: VISION_MODEL_SPEC.name,
      kind: 'vision-onnx',
      version: VISION_MODEL_SPEC.version,
      status: 'downloading',
      expectedBytes: VISION_MODEL_SPEC.totalApproximateBytes,
      downloadedBytes: 0,
      updatedAt: Date.now(),
    });

    if (typeof caches === 'undefined') {
      throw new Error('Cache API is unavailable in this browser.');
    }
    const cache = await caches.open(OFFLINE_CACHE_NAMESPACES.MODELS);

    // 1. Warm self-hosted ONNX Runtime Web WASM runtime locally (skip already-cached valid files to save bandwidth on retry)
    let runtimeLoadedBytes = 0;
    for (const assetPath of VISION_MODEL_SPEC.ortRuntimeFiles) {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      emit('downloading_runtime', runtimeLoadedBytes, VISION_MODEL_SPEC.totalApproximateBytes);

      const existing = await cache.match(assetPath);
      const cachedLen = existing
        ? Number(
            existing.headers.get('x-cached-bytes') ||
              existing.headers.get('content-length') ||
              0
          )
        : 0;
      if (existing && existing.ok && cachedLen > 500) {
        runtimeLoadedBytes += cachedLen;
        continue;
      }

      const res = await fetch(assetPath, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Failed to cache local ONNX runtime asset (${assetPath})`);
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 500) {
        throw new Error(`Invalid ONNX runtime asset payload (${assetPath})`);
      }
      runtimeLoadedBytes += buf.byteLength;
      const headers = new Headers(res.headers);
      headers.set('x-cached-bytes', String(buf.byteLength));
      if (!headers.get('content-type')) {
        headers.set(
          'content-type',
          assetPath.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/javascript; charset=utf-8'
        );
      }
      await cache.put(assetPath, new Response(buf, { status: 200, headers }));
    }

    // 2. Reuse verified cached weights on re-verify or stream quantized MobileNetV2 ONNX weights from HuggingFace
    let modelBuffer: ArrayBuffer | null = null;
    const existingModel = await cache.match(VISION_MODEL_CACHE_URL);
    if (existingModel && existingModel.ok) {
      const existingBuf = await existingModel.arrayBuffer();
      if (existingBuf.byteLength === VISION_MODEL_SPEC.expectedBytes) {
        const existingHash = await sha256Hex(existingBuf);
        if (!existingHash || existingHash === VISION_MODEL_SPEC.expectedSha256) {
          modelBuffer = existingBuf;
        }
      }
    }

    if (!modelBuffer) {
      modelBuffer = await fetchWithProgress(
        VISION_MODEL_SPEC.remoteUrl,
        controller.signal,
        (loaded, total) => {
          emit(
            'downloading_model',
            runtimeLoadedBytes + loaded,
            runtimeLoadedBytes + (total || VISION_MODEL_SPEC.expectedBytes)
          );
        }
      );
    }

    // 3. Integrity verification: size check + SHA-256 verification
    emit('verifying', VISION_MODEL_SPEC.totalApproximateBytes, VISION_MODEL_SPEC.totalApproximateBytes);
    if (modelBuffer.byteLength !== VISION_MODEL_SPEC.expectedBytes) {
      await cache.delete(VISION_MODEL_CACHE_URL);
      throw new Error(
        `Model integrity size mismatch (got ${modelBuffer.byteLength} bytes, expected ${VISION_MODEL_SPEC.expectedBytes}).`
      );
    }

    const hashHex = await sha256Hex(modelBuffer);
    if (typeof crypto !== 'undefined' && Boolean(crypto.subtle)) {
      if (!hashHex || hashHex !== VISION_MODEL_SPEC.expectedSha256) {
        await cache.delete(VISION_MODEL_CACHE_URL);
        throw new Error('Downloaded ONNX model SHA-256 checksum verification failed.');
      }
    }

    emit('saving', VISION_MODEL_SPEC.totalApproximateBytes, VISION_MODEL_SPEC.totalApproximateBytes);
    await cache.put(
      VISION_MODEL_CACHE_URL,
      new Response(modelBuffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(modelBuffer.byteLength),
          'X-Model-SHA256': hashHex || VISION_MODEL_SPEC.expectedSha256,
        },
      })
    );

    const installedRecord: OfflineModelRecord = {
      modelId: VISION_MODEL_ID,
      name: VISION_MODEL_SPEC.name,
      kind: 'vision-onnx',
      version: VISION_MODEL_SPEC.version,
      status: 'installed',
      expectedBytes: runtimeLoadedBytes + modelBuffer.byteLength,
      downloadedBytes: runtimeLoadedBytes + modelBuffer.byteLength,
      checksumSha256: hashHex || VISION_MODEL_SPEC.expectedSha256,
      backendUsed: 'wasm',
      updatedAt: Date.now(),
    };
    await idbPut(OFFLINE_STORES.MODELS, installedRecord);
    emit('done', installedRecord.downloadedBytes, installedRecord.expectedBytes);
    return installedRecord;
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    if (aborted) {
      await idbDelete(OFFLINE_STORES.MODELS, VISION_MODEL_ID);
      throw err;
    }
    const msg = err instanceof Error ? err.message : 'Download failed';
    await idbPut<OfflineModelRecord>(OFFLINE_STORES.MODELS, {
      modelId: VISION_MODEL_ID,
      name: VISION_MODEL_SPEC.name,
      kind: 'vision-onnx',
      version: VISION_MODEL_SPEC.version,
      status: 'error',
      expectedBytes: VISION_MODEL_SPEC.totalApproximateBytes,
      downloadedBytes: 0,
      updatedAt: Date.now(),
      errorMessage: msg,
    });
    throw err;
  } finally {
    activeControllers.delete(VISION_MODEL_ID);
  }
}

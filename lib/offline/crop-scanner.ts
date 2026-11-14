'use client';

import { CropDiagnosisSchema, type CropDiagnosis } from '@/lib/schemas';
import { buildOfflinePreliminaryAssessment } from '@/lib/offline-assessment';
import type { ImageQualityReport } from '@/lib/image-quality';
import {
  extractPvHostFromLabel,
  getPlantVillageClassMeta,
  isCropSupportedByPlantVillageOnnx,
  normalizeSelectedCropToPvHost,
  PLANTVILLAGE_RAW_LABELS,
} from './plantvillage-catalog';
import {
  isVisionModelReadyOffline,
  VISION_MODEL_CACHE_URL,
  VISION_MODEL_ID,
} from './model-manager';
import { isLikelyLowEndDevice, OFFLINE_CACHE_NAMESPACES } from './config';

/**
 * ZARKHEZ On-Device ONNX Crop Scanner (lib/offline/crop-scanner.ts)
 *
 * Executes real MobileNetV2-1.0-224 quantized ONNX neural network inference
 * strictly inside a dedicated Web Worker (/workers/plant-disease.worker.js).
 *
 * Honesty & Safety Guarantees:
 * - Only claims disease classification when:
 *   1. The local quantized ONNX model + WASM runtime are installed & verified.
 *   2. Selected crop belongs to PlantVillage supported classes (Tomato, Maize, Potato, Chili, Citrus, etc.).
 *   3. Top softmax confidence passes ONNX_CONFIDENCE_THRESHOLD (0.55).
 * - For unsupported crops (Wheat, Rice, Cotton, Sugarcane, Mango, Onion) or low confidence,
 *   explicitly refuses guessing and falls back safely to optical pre-screening + honest limits.
 */

export const ONNX_CONFIDENCE_THRESHOLD = 0.55;
export const ONNX_MIN_MARGIN_BELOW_65 = 0.12;

export interface OnnxWorkerPrediction {
  idx: number;
  prob: number;
}

export interface OnnxScanOutcome {
  usedOnnxModel: boolean;
  supportedCrop: boolean;
  confidenceMet: boolean;
  backend?: string;
  latencyMs?: number;
  diagnosis: CropDiagnosis;
}

const INPUT_SIZE = 224;
const PLANE_SIZE = INPUT_SIZE * INPUT_SIZE;
let sharedWorker: Worker | null = null;
let msgCounter = 0;
let workerSessionReady = false;
let workerWarmPromise: Promise<boolean> | null = null;
let idleDisposeTimer: number | null = null;
let sharedTensorScratch: Float32Array | null = null;

function getTensorScratch(): Float32Array {
  if (!sharedTensorScratch) {
    sharedTensorScratch = new Float32Array(3 * PLANE_SIZE);
  }
  return sharedTensorScratch;
}

function getVisionWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null;
  }
  if (!sharedWorker) {
    try {
      sharedWorker = new Worker('/workers/plant-disease.worker.js', {
        type: 'module',
      });
      workerSessionReady = false;
    } catch {
      sharedWorker = null;
    }
  }
  return sharedWorker;
}

function scheduleWorkerIdleDispose(): void {
  if (typeof window === 'undefined') return;
  if (idleDisposeTimer) {
    window.clearTimeout(idleDisposeTimer);
  }
  const delayMs = isLikelyLowEndDevice() ? 90_000 : 240_000;
  idleDisposeTimer = window.setTimeout(() => {
    idleDisposeTimer = null;
    disposeOfflineVisionWorker();
  }, delayMs);
}

async function readCachedModelBuffer(): Promise<ArrayBuffer | undefined> {
  if (typeof caches === 'undefined') return undefined;
  const cache = await caches.open(OFFLINE_CACHE_NAMESPACES.MODELS);
  const hit = await cache.match(VISION_MODEL_CACHE_URL);
  return hit ? hit.arrayBuffer() : undefined;
}

function postWorkerCommand<T = Record<string, unknown>>(
  worker: Worker,
  message: Record<string, unknown>,
  transfer: Transferable[],
  timeoutMs = 30_000
): Promise<T> {
  const reqId = `ort_${++msgCounter}_${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('On-device ONNX operation timed out'));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || payload.id !== reqId) return;
      cleanup();
      if (!payload.ok) {
        reject(new Error(payload.error || 'ONNX worker failed'));
        return;
      }
      resolve(payload as T);
    };

    const onError = (err: ErrorEvent) => {
      cleanup();
      workerSessionReady = false;
      sharedWorker = null;
      reject(new Error(err.message || 'Vision worker crashed'));
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ ...message, id: reqId }, transfer);
  });
}

export async function warmOfflineVisionWorker(): Promise<boolean> {
  if (workerSessionReady && sharedWorker) return true;
  if (workerWarmPromise) return workerWarmPromise;

  workerWarmPromise = (async () => {
    try {
      const ready = await isVisionModelReadyOffline();
      if (!ready) return false;
      const worker = getVisionWorker();
      if (!worker) return false;
      const modelBuffer = await readCachedModelBuffer();
      if (!modelBuffer) return false;

      await postWorkerCommand(
        worker,
        { type: 'WARM_VISION_MODEL', modelBuffer },
        [modelBuffer],
        25_000
      );
      workerSessionReady = true;
      scheduleWorkerIdleDispose();
      return true;
    } catch {
      workerSessionReady = false;
      return false;
    } finally {
      workerWarmPromise = null;
    }
  })();

  return workerWarmPromise;
}

export function disposeOfflineVisionWorker(): void {
  if (typeof window !== 'undefined' && idleDisposeTimer) {
    window.clearTimeout(idleDisposeTimer);
    idleDisposeTimer = null;
  }
  workerSessionReady = false;
  workerWarmPromise = null;
  const worker = sharedWorker;
  sharedWorker = null;
  sharedTensorScratch = null;
  if (!worker) return;
  try {
    worker.postMessage({ id: `dispose_${++msgCounter}`, type: 'DISPOSE' });
  } catch {
    // Ignore errors when worker is already detached
  }
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      try {
        worker.terminate();
      } catch {
        // Ignore terminate error
      }
    }, 150);
  }
}

export async function preprocessImageToMobileNetTensor(
  imageDataUrl: string
): Promise<Float32Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      el.onload = null;
      el.onerror = null;
      resolve(el);
    };
    el.onerror = () => {
      el.onload = null;
      el.onerror = null;
      reject(new Error('Failed to decode image for on-device ONNX inference'));
    };
    el.src = imageDataUrl;
  });

  const shortestSide = Math.min(img.width, img.height);
  const scale = 256 / Math.max(1, shortestSide);
  const scaledW = Math.max(INPUT_SIZE, Math.round(img.width * scale));
  const scaledH = Math.max(INPUT_SIZE, Math.round(img.height * scale));
  const cropX = Math.floor((scaledW - INPUT_SIZE) / 2);
  const cropY = Math.floor((scaledH - INPUT_SIZE) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Center-crop matching torchvision / preprocessor_config.json (shortest_edge: 256 -> center crop 224x224)
  ctx.drawImage(
    img,
    (cropX / scaledW) * img.width,
    (cropY / scaledH) * img.height,
    (INPUT_SIZE / scaledW) * img.width,
    (INPUT_SIZE / scaledH) * img.height,
    0,
    0,
    INPUT_SIZE,
    INPUT_SIZE
  );

  const rgba = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  // Release GPU/canvas backing memory immediately on low-RAM devices
  canvas.width = 0;
  canvas.height = 0;

  const tensor = getTensorScratch();

  // Normalize (pixel/255 - 0.5) / 0.5 => pixel / 127.5 - 1, NCHW layout
  for (let i = 0; i < PLANE_SIZE; i++) {
    const base = i * 4;
    tensor[i] = rgba[base] / 127.5 - 1; // R
    tensor[PLANE_SIZE + i] = rgba[base + 1] / 127.5 - 1; // G
    tensor[2 * PLANE_SIZE + i] = rgba[base + 2] / 127.5 - 1; // B
  }

  return tensor;
}

async function runWorkerInference(
  tensorData: Float32Array
): Promise<{
  backend: string;
  latencyMs: number;
  topPredictions: OnnxWorkerPrediction[];
}> {
  const attempt = async (withModelBuffer: boolean) => {
    const worker = getVisionWorker();
    if (!worker) {
      throw new Error('Web Worker unsupported in this browser');
    }

    const modelBuffer = withModelBuffer ? await readCachedModelBuffer() : undefined;
    const tensorCopy = tensorData.slice().buffer;
    const transfer: Transferable[] = modelBuffer ? [tensorCopy, modelBuffer] : [tensorCopy];
    const message = modelBuffer
      ? { type: 'RUN_VISION_INFERENCE', tensorBuffer: tensorCopy, modelBuffer }
      : { type: 'RUN_VISION_INFERENCE', tensorBuffer: tensorCopy };

    const payload = await postWorkerCommand<{
      backend?: string;
      latencyMs?: number;
      topPredictions?: OnnxWorkerPrediction[];
    }>(worker, message, transfer, 30_000);

    workerSessionReady = true;
    scheduleWorkerIdleDispose();

    return {
      backend: payload.backend || 'wasm',
      latencyMs: Number(payload.latencyMs || 0),
      topPredictions: payload.topPredictions || [],
    };
  };

  try {
    return await attempt(!workerSessionReady);
  } catch (err) {
    // If cached session in worker was evicted/reloaded, retry once cleanly with modelBuffer
    if (workerSessionReady) {
      workerSessionReady = false;
      return attempt(true);
    }
    throw err;
  }
}

export async function runOfflineCropDiseaseScan(
  imageDataUrl: string,
  selectedCrop: string,
  quality?: ImageQualityReport
): Promise<OnnxScanOutcome> {
  const supported = isCropSupportedByPlantVillageOnnx(selectedCrop);
  const installed = await isVisionModelReadyOffline();

  if (!installed || !supported) {
    const baseReport = buildOfflinePreliminaryAssessment(selectedCrop, quality);
    const reasonEn = !installed
      ? 'Offline Vision ONNX model is not downloaded yet. Visit Offline Center while connected to install it (~17 MB total).'
      : `On-device ONNX weights cover Tomato, Maize, Potato, Chili, Citrus, and Orchard crops — ${selectedCrop} is not covered offline yet. Retry online with Zarkhez Cloud Vision.`;
    const reasonUr = !installed
      ? 'آف لائن ویژن ماڈل ابھی ڈاؤن لوڈ نہیں ہوا۔ انٹرنیٹ ہونے پر آف لائن سینٹر سے ماڈل ڈاؤن لوڈ کریں۔'
      : `آف لائن ماڈل ٹماٹر، مکئی، آلو، مرچ اور کینو کی بیماریاں پہچانتا ہے — ${selectedCrop} کے لیے آن لائن کلاؤڈ AI اسکین ضروری ہے۔`;

    return {
      usedOnnxModel: false,
      supportedCrop: supported,
      confidenceMet: false,
      diagnosis: CropDiagnosisSchema.parse({
        ...baseReport,
        confidence_limitations: {
          en: reasonEn,
          ur: reasonUr,
          sd: 'هي فصل آف لائن ماڊل ۾ شامل ناهي، صحيح چڪاس لاءِ آن لائن اسڪين ڪريو.',
        },
        message: {
          en: reasonEn,
          ur: reasonUr,
        },
      }),
    };
  }

  try {
    const tensor = await preprocessImageToMobileNetTensor(imageDataUrl);
    const result = await runWorkerInference(tensor);
    const top = result.topPredictions[0];
    const second = result.topPredictions[1];
    const margin = top && second ? top.prob - second.prob : 1;
    const isAmbiguousMargin = Boolean(
      top && top.prob >= ONNX_CONFIDENCE_THRESHOLD && top.prob < 0.65 && margin < ONNX_MIN_MARGIN_BELOW_65
    );

    if (!top || top.prob < ONNX_CONFIDENCE_THRESHOLD || isAmbiguousMargin) {
      const confPct = top ? Math.round(top.prob * 100) : 0;
      const baseReport = buildOfflinePreliminaryAssessment(selectedCrop, quality);
      const reasonTextEn = isAmbiguousMargin
        ? `On-device ONNX predictions were too close (${confPct}% vs ${Math.round((second?.prob ?? 0) * 100)}% runner-up). Retake a sharp single-leaf daylight close-up or confirm online.`
        : `On-device ONNX model returned uncertain confidence (${confPct}% < 55% threshold). Retake a sharp close-up of a single leaf in bright daylight or use Cloud AI online.`;
      const reasonTextUr = isAmbiguousMargin
        ? `آف لائن ماڈل کے دو نتائج آپس میں بہت قریب ہیں (${confPct}%)۔ صاف تصویر دوبارہ لیں یا انٹرنیٹ پر تصدیق کریں۔`
        : `آف لائن ماڈل کا اعتماد کم ہے (${confPct}% جو 55% حد سے کم ہے)۔ براہِ کرم تیز روشنی میں صاف تصویر دوبارہ لیں یا انٹرنیٹ آنے پر کلاؤڈ اسکین کریں۔`;
      return {
        usedOnnxModel: true,
        supportedCrop: true,
        confidenceMet: false,
        backend: result.backend,
        latencyMs: result.latencyMs,
        diagnosis: CropDiagnosisSchema.parse({
          ...baseReport,
          model_version: `${VISION_MODEL_ID} (${result.backend})`,
          identification_confidence: Number((top?.prob ?? 0).toFixed(2)),
          confidence_limitations: {
            en: reasonTextEn,
            ur: reasonTextUr,
          },
          message: {
            en: `Low offline confidence (${confPct}%). Avoid chemical spraying without online or expert confirmation.`,
            ur: `آف لائن اعتماد کم ہے (${confPct}%)۔ تصدیق کے بغیر کیمیائی سپرے ہرگز نہ کریں۔`,
          },
        }),
      };
    }

    const meta = getPlantVillageClassMeta(top.idx);
    const roundedConf = Number(top.prob.toFixed(2));
    const expectedPvHost = normalizeSelectedCropToPvHost(selectedCrop);
    const detectedHost = extractPvHostFromLabel(PLANTVILLAGE_RAW_LABELS[top.idx] || '');
    const cropMatches = Boolean(expectedPvHost) && expectedPvHost === detectedHost;

    const top3Candidates = result.topPredictions.slice(0, 3).map((pred, i) => {
      const candidateMeta = getPlantVillageClassMeta(pred.idx);
      return {
        name: candidateMeta.title.en,
        name_ur: candidateMeta.title.ur,
        name_sd: candidateMeta.title.sd,
        confidence: Number(pred.prob.toFixed(2)),
        is_primary: i === 0,
      };
    });

    const diag = CropDiagnosisSchema.parse({
      image_valid: true,
      detected_crop: meta.cropKey,
      detected_crop_ur: selectedCrop,
      selected_crop: selectedCrop,
      crop_match: cropMatches,
      detected_plant_part: 'Leaf (PlantVillage ONNX Close-Up)',
      detected_plant_part_ur: 'پتا (آف لائن ماڈل معائنہ)',
      growth_stage: 'Uncertain (Local Classifier)',
      growth_stage_ur: 'مقامی ماڈل تجزیہ',
      identification_confidence: roundedConf,
      visual_inspection: {
        lesion_detected: !meta.isHealthy,
        lesion_count: meta.isHealthy ? 'none' : 'On-device class match (verify severity in field)',
        lesion_shape: meta.isHealthy ? 'none' : 'foliar spots/lesions',
        lesion_size_est: 'unmeasured offline',
        lesion_colors: [],
        lesion_margins: 'unassessed',
        lesion_distribution: 'focal',
        tissue_damage: meta.isHealthy ? 'healthy' : 'foliar stress detected',
        chlorosis_detected: !meta.isHealthy,
        necrosis_detected: false,
        wilting_detected: false,
        affected_area_pct: meta.isHealthy ? 0 : 25,
        detected_hotspots: [],
      },
      diagnosis_status: meta.isHealthy
        ? 'healthy_no_symptoms'
        : meta.pathogenType === 'pest'
        ? 'possible_pest'
        : 'possible_disease',
      pathogen_type: meta.pathogenType,
      confidence_category: roundedConf >= 0.8 ? 'high' : 'moderate',
      confidence_limitations: {
        en: `On-device quantized MobileNetV2 ONNX screening (${Math.round(
          roundedConf * 100
        )}% softmax match via ${result.backend}, ${result.latencyMs}ms). Local model detects common PlantVillage leaf classes and cannot inspect hidden roots or nutrient soil deficits — verify severe cases online or with an extension officer.`,
        ur: `آف لائن ONNX ماڈل نتیجہ (${Math.round(
          roundedConf * 100
        )}% مشابہت، ${result.latencyMs}ms)۔ یہ صرف پتے کی ظاہری علامات کی ابتدائی شناخت ہے؛ شدید علامات میں کلاؤڈ AI یا زرعی افسر سے تصدیق ضرور کریں۔`,
        sd: `آف لائن ONNX ماڊل نتيجو (${Math.round(roundedConf * 100)}%)۔ سخت علامتن ۾ زرعي ماهر کان تصديق ڪرايو.`,
      },
      plant_condition: meta.isHealthy ? 'Likely Healthy Foliage' : meta.title.en,
      plant_condition_ur: meta.isHealthy ? 'پتا صحت مند محسوس ہو رہا ہے' : meta.title.ur,
      plant_condition_sd: meta.title.sd,
      problem_name: {
        en: meta.title.en,
        ur: meta.title.ur,
        sd: meta.title.sd,
      },
      possible_disease: top3Candidates,
      why_suspected: {
        en: `Top local neural classifier output among 38 PlantVillage classes (${meta.rawLabel}, ${Math.round(
          roundedConf * 100
        )}% probability).`,
        ur: `فون پر موجود 38 بیماریوں کے ONNX ماڈل نے اسے ${Math.round(
          roundedConf * 100
        )}% مشابہت کے ساتھ منتخب کیا ہے۔`,
      },
      observed_symptoms: [
        {
          en: meta.isHealthy
            ? 'Leaf texture & pigmentation align closely with healthy reference samples.'
            : `Visual leaf patches match PlantVillage class "${meta.title.en}".`,
          ur: meta.isHealthy
            ? 'پتے کا رنگ اور ساخت صحت مند نمونوں سے میل کھاتی ہے۔'
            : `پتے کے نشانات "${meta.title.ur}" سے ملتے جلتے ہیں۔`,
        },
      ],
      possible_causes: [
        {
          en: meta.isHealthy
            ? 'No significant disease signature detected locally.'
            : `Pathogen/pest pattern associated with ${meta.pathogenType} stress.`,
          ur: meta.isHealthy
            ? 'کوئی نمایاں بیماری کی علامت نہیں ملی۔'
            : 'پتوں پر بیماری یا دباؤ کی ممکنہ علامات۔',
        },
      ],
      severity: meta.isHealthy ? 'low' : 'medium',
      severity_level: meta.isHealthy ? 'healthy_none' : 'medium',
      recommendations: meta.actions.en.map((enStep, idx) => ({
        en: enStep,
        ur: meta.actions.ur[idx] || enStep,
        sd: meta.actions.sd[idx] || meta.actions.ur[idx] || enStep,
      })),
      what_to_do_now: meta.actions.en.map((enStep, idx) => ({
        en: enStep,
        ur: meta.actions.ur[idx] || enStep,
        sd: meta.actions.sd[idx] || meta.actions.ur[idx] || enStep,
      })),
      prevention: meta.prevention.en.map((enPrev, idx) => ({
        en: enPrev,
        ur: meta.prevention.ur[idx] || enPrev,
      })),
      when_to_consult_expert: {
        en: 'Always confirm before heavy chemical application or if >15% of field plants are affected.',
        ur: 'کسی بھی تیز کیمیائی سپرے سے پہلے یا 15 فیصد سے زیادہ پودے متاثر ہونے پر زرعی افسر سے تصدیق ضرور کروائیں۔',
      },
      explanations: {
        farmer_friendly: {
          en: `Offline ONNX Vision result (${Math.round(
            roundedConf * 100
          )}%): ${meta.title.en}. Remember this runs locally on your phone without internet.`,
          ur: `آف لائن ONNX تشخیص (${Math.round(
            roundedConf * 100
          )}%): ${meta.title.ur}۔ یہ نتیجہ آپ کے فون پر انٹرنیٹ کے بغیر نکالا گیا ہے۔`,
        },
        scientific: {
          en: `MobileNetV2-1.0-224 INT8 ONNX local inference via ONNX Runtime Web (${result.backend}) in ${result.latencyMs}ms.`,
          ur: `مقامی ONNX Runtime Web ماڈل تجزیہ (${result.backend}, ${result.latencyMs}ms)۔`,
        },
      },
      voice_script: {
        en: `Offline scan result: ${meta.title.en}, with ${Math.round(
          roundedConf * 100
        )} percent match. ${meta.actions.en[0] || ''}`,
        ur: `آف لائن معائنہ نتیجہ: ${meta.title.ur}، مشابہت ${Math.round(
          roundedConf * 100
        )} فیصد۔ ${meta.actions.ur[0] || ''}`,
      },
      requires_retake: false,
      requires_expert_review: !meta.isHealthy,
      inspection_source: 'offline_assessment',
      gemini_inspection_status: 'not_run',
      scan_timestamp: new Date().toISOString(),
      model_version: `${VISION_MODEL_ID} (${result.backend})`,
      problem_category: meta.isHealthy
        ? 'healthy'
        : meta.pathogenType === 'bacterial'
        ? 'bacterial_infection'
        : meta.pathogenType === 'viral'
        ? 'viral_infection'
        : meta.pathogenType === 'pest'
        ? 'insect_pest'
        : 'fungal_infection',
      confidence_breakdown: {
        model_confidence: roundedConf,
        diagnostic_certainty: Number(Math.min(0.85, roundedConf * 0.9).toFixed(2)),
        visual_evidence_quality: quality?.isAcceptable ? 'moderate' : 'poor',
        alternative_top_probability: Number(
          (result.topPredictions[1]?.prob ?? 0).toFixed(2)
        ),
        lab_confirmation_status: 'unconfirmed_visual_screening',
        calibration_note: {
          en: 'On-device quantized PlantVillage ONNX screening. Cloud AI did not run; confirm severe outbreaks in the field.',
          ur: 'فون پر موجود آف لائن ONNX ماڈل کی تشخیص۔ کلاؤڈ AI ابھی نہیں چلا؛ شدید بیماری پر مقامی تصدیق کروائیں۔',
        },
      },
      message: {
        en: cropMatches
          ? `On-device ONNX inference complete (${Math.round(roundedConf * 100)}%).`
          : `On-device ONNX detected ${meta.cropKey} pattern while ${selectedCrop} was selected — verify photo crop carefully.`,
        ur: cropMatches
          ? `آف لائن ONNX معائنہ مکمل (${Math.round(roundedConf * 100)}%)۔`
          : `آف لائن ماڈل کو ${meta.cropKey} کے پتے کی علامات نظر آئیں جبکہ آپ نے ${selectedCrop} منتخب کیا ہے۔ براہِ کرم فصل کی تصدیق کریں۔`,
      },
    });

    return {
      usedOnnxModel: true,
      supportedCrop: true,
      confidenceMet: true,
      backend: result.backend,
      latencyMs: result.latencyMs,
      diagnosis: diag,
    };
  } catch {
    const baseReport = buildOfflinePreliminaryAssessment(selectedCrop, quality);
    return {
      usedOnnxModel: false,
      supportedCrop: supported,
      confidenceMet: false,
      diagnosis: baseReport,
    };
  }
}

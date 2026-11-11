import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CropDiagnosis } from '../schemas';
import { redactSecrets } from '../error-sanitizer';

/**
 * Zarkhez Continuous Learning & Dataset Quarantine Store (lib/vision/learning-store.ts)
 * - Strictly separates raw user feedback from expert/lab-verified dataset samples.
 * - Never auto-trains silently on unverified predictions or raw farmer guesses.
 * - Tracks real model versions, limitations, and infrastructure requirements for fine-tuning.
 */

export interface ModelVersionRecord {
  version: string;
  releasedAt: string;
  status: 'production' | 'retired' | 'staging';
  architecture: string;
  trainingState: string;
  notes: string;
}

export const MODEL_VERSION_HISTORY: ReadonlyArray<ModelVersionRecord> = [
  {
    version: 'zarkhez-vision-v2.4-cloud',
    releasedAt: '2026-11-11',
    status: 'production',
    architecture:
      'Multimodal Cloud Vision + Deterministic Clinical Calibrator + Chemical Safety Guardrail + Verified Extension KB',
    trainingState:
      'Zero-shot/few-shot multimodal inference with deterministic calibration. Dedicated custom ViT/CNN weights are NOT trained locally (requires GPU cluster + expert-verified dataset export).',
    notes:
      'Added 19-category agricultural classification, confidence breakdown calibration, whole-field multi-image analysis, Fusarium vs Diplodia differential rules, and quarantined feedback pipeline.',
  },
  {
    version: 'zarkhez-vision-v2.0-cloud',
    releasedAt: '2026-11-09',
    status: 'retired',
    architecture: 'Two-stage Cloud Vision + Strict Zod Schema & Optical Pre-Check',
    trainingState: 'Inference only',
    notes: 'Added crop mismatch protection, hotspot boxes, and differential diagnosis.',
  },
];

export const VISION_LIMITATIONS_AND_PREREQUISITES = {
  noClaim100PctAccuracy:
    'Visual crop photography alone cannot achieve 100% diagnostic accuracy. Look-alike fungal, bacterial, viral, herbicide-drift, and salinity syndromes frequently overlap macroscopically and require laboratory microscopy, ELISA, or PCR confirmation.',
  unsupportedConditions: [
    'Microscopic soil-borne spores, sub-surface root nematodes without washed root photos, and asymptomatic latent viral infections.',
    'Severely out-of-focus photos, pitch-dark night frames without flash diffuse light, or heavily backlit silhouettes.',
    'Confirming banned/restricted chemical residues or exact pesticide toxicity concentrations from visual leaves alone.',
    'Estimating whole-field damage percentages from a single isolated leaf close-up.',
  ],
  externalTrainingRequirements: [
    'Curated labeled Pakistani & multi-region datasets (10,000+ expert-verified images across healthy, single/co-infected fungal, bacterial, viral, pest, abiotic, and look-alike controls).',
    'Dedicated GPU training infrastructure (e.g., A100/H100 node with PyTorch + albumentations, stratified train/val/test splits grouped by farm/location to avoid data leakage).',
    'Human-in-the-loop agricultural pathologist verification gate before promoting any dataset batch or model checkpoint.',
  ],
};

export interface ScanFeedbackEntry {
  feedbackId: string;
  timestamp: string;
  scanId: string;
  modelVersion: string;
  verdict: 'correct' | 'incorrect' | 'partial';
  predictedCrop: string;
  predictedProblem: string;
  correctedCrop?: string;
  correctedDisease?: string;
  correctedSeverity?: 'low' | 'medium' | 'high' | 'not_assessed';
  confirmedSource: 'farmer' | 'extension_expert' | 'laboratory_confirmed';
  region?: string;
  notes?: string;
  consentForDataset: boolean;
  quarantineStatus: 'pending_expert_review' | 'approved_for_dataset' | 'rejected';
  imageHash?: string;
}

export interface ExpertVerifiedDatasetRecord {
  recordId: string;
  verifiedAt: string;
  verifiedBy: string;
  sourceFeedbackId: string;
  imageHash: string;
  crop: string;
  problemLabel: string;
  severity: 'low' | 'medium' | 'high' | 'not_assessed';
  confirmationLevel: 'extension_expert' | 'laboratory_confirmed';
  split: 'train' | 'val' | 'test';
  region?: string;
  modelVersionWhenScanned: string;
}

const DEFAULT_STORE_DIR = path.resolve(process.cwd(), 'data/vision');

function getStorePath(fileName: string, overrideDir?: string): string {
  const dir = overrideDir || DEFAULT_STORE_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, fileName);
}

export function hashImageData(base64OrUrl: string): string {
  return crypto.createHash('sha256').update(base64OrUrl || '', 'utf8').digest('hex').slice(0, 32);
}

function appendJsonlSafe(filePath: string, obj: unknown): boolean {
  try {
    fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function readJsonlSafe<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const out: T[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // skip corrupted tail line safely
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function recordScanTelemetry(params: {
  imageHash: string;
  diagnosis: CropDiagnosis;
  scanMode: 'single_plant' | 'whole_field';
  region?: string;
  consentToStore?: boolean;
  storeDir?: string;
}): boolean {
  const entry = {
    timestamp: new Date().toISOString(),
    imageHash: params.imageHash,
    modelVersion: params.diagnosis.model_version || MODEL_VERSION_HISTORY[0].version,
    scanMode: params.scanMode,
    region: params.region || 'unspecified',
    detectedCrop: params.diagnosis.detected_crop,
    plantPart: params.diagnosis.detected_plant_part,
    diagnosisStatus: params.diagnosis.diagnosis_status,
    problemCategory: params.diagnosis.problem_category,
    primaryProblem: params.diagnosis.problem_name.en,
    modelConfidence: params.diagnosis.confidence_breakdown?.model_confidence ?? params.diagnosis.identification_confidence,
    diagnosticCertainty: params.diagnosis.identification_confidence,
    evidenceQuality: params.diagnosis.confidence_breakdown?.visual_evidence_quality ?? 'moderate',
    consentToStore: Boolean(params.consentToStore),
  };
  return appendJsonlSafe(getStorePath('scan-telemetry.jsonl', params.storeDir), entry);
}

/**
 * Stores user/farmer diagnosis feedback strictly into QUARANTINE (`user-feedback.jsonl`).
 * NEVER writes unverified predictions or farmer corrections directly into training datasets.
 */
export function submitQuarantinedFeedback(
  input: Omit<ScanFeedbackEntry, 'feedbackId' | 'timestamp' | 'quarantineStatus'>,
  storeDir?: string
): { saved: boolean; entry: ScanFeedbackEntry } {
  const entry: ScanFeedbackEntry = {
    ...input,
    feedbackId: `fb_${crypto.randomBytes(6).toString('hex')}`,
    timestamp: new Date().toISOString(),
    quarantineStatus: 'pending_expert_review',
    predictedCrop: redactSecrets(input.predictedCrop).slice(0, 80),
    predictedProblem: redactSecrets(input.predictedProblem).slice(0, 140),
    correctedCrop: input.correctedCrop ? redactSecrets(input.correctedCrop).slice(0, 80) : undefined,
    correctedDisease: input.correctedDisease ? redactSecrets(input.correctedDisease).slice(0, 140) : undefined,
    notes: input.notes ? redactSecrets(input.notes).slice(0, 400) : undefined,
  };
  const saved = appendJsonlSafe(getStorePath('user-feedback.jsonl', storeDir), entry);
  return { saved, entry };
}

function deterministicSplitForHash(imageHash: string): 'train' | 'val' | 'test' {
  const byte = parseInt(imageHash.slice(0, 2) || '0', 16);
  const mod = byte % 100;
  if (mod < 70) return 'train';
  if (mod < 85) return 'val';
  return 'test';
}

/**
 * Promotes a quarantined feedback record ONLY after authenticated agricultural expert / lab verification,
 * enforcing imageHash deduplication and consent requirements.
 */
export function verifyAndPromoteFeedback(params: {
  feedbackId: string;
  verifiedBy: string;
  decision: 'approve' | 'reject';
  verifiedCrop: string;
  verifiedDisease: string;
  verifiedSeverity: 'low' | 'medium' | 'high' | 'not_assessed';
  confirmationLevel?: 'extension_expert' | 'laboratory_confirmed';
  storeDir?: string;
}): {
  ok: boolean;
  reason?: string;
  promotedRecord?: ExpertVerifiedDatasetRecord;
} {
  const fbPath = getStorePath('user-feedback.jsonl', params.storeDir);
  const allFeedback = readJsonlSafe<ScanFeedbackEntry>(fbPath);
  const target = allFeedback.find((f) => f.feedbackId === params.feedbackId);
  if (!target) {
    return { ok: false, reason: 'feedback_not_found' };
  }

  if (params.decision === 'reject') {
    const updated = allFeedback.map((f) =>
      f.feedbackId === params.feedbackId ? { ...f, quarantineStatus: 'rejected' as const } : f
    );
    fs.writeFileSync(fbPath, `${updated.map((u) => JSON.stringify(u)).join('\n')}\n`, 'utf8');
    return { ok: true, reason: 'rejected_by_expert' };
  }

  if (!target.consentForDataset) {
    return { ok: false, reason: 'missing_user_dataset_consent' };
  }

  const verifiedPath = getStorePath('expert-verified-dataset.jsonl', params.storeDir);
  const existingVerified = readJsonlSafe<ExpertVerifiedDatasetRecord>(verifiedPath);
  const imgHash = target.imageHash || hashImageData(`${target.scanId}|${target.feedbackId}`);

  if (existingVerified.some((r) => r.imageHash === imgHash)) {
    return { ok: false, reason: 'duplicate_image_hash_rejected' };
  }

  const promotedRecord: ExpertVerifiedDatasetRecord = {
    recordId: `ver_${crypto.randomBytes(6).toString('hex')}`,
    verifiedAt: new Date().toISOString(),
    verifiedBy: redactSecrets(params.verifiedBy).slice(0, 80),
    sourceFeedbackId: target.feedbackId,
    imageHash: imgHash,
    crop: redactSecrets(params.verifiedCrop).slice(0, 80),
    problemLabel: redactSecrets(params.verifiedDisease).slice(0, 140),
    severity: params.verifiedSeverity,
    confirmationLevel: params.confirmationLevel || 'extension_expert',
    split: deterministicSplitForHash(imgHash),
    region: target.region,
    modelVersionWhenScanned: target.modelVersion,
  };

  appendJsonlSafe(verifiedPath, promotedRecord);

  const updated = allFeedback.map((f) =>
    f.feedbackId === params.feedbackId ? { ...f, quarantineStatus: 'approved_for_dataset' as const } : f
  );
  fs.writeFileSync(fbPath, `${updated.map((u) => JSON.stringify(u)).join('\n')}\n`, 'utf8');

  return { ok: true, promotedRecord };
}

export function getContinuousLearningSummary(storeDir?: string) {
  const feedback = readJsonlSafe<ScanFeedbackEntry>(getStorePath('user-feedback.jsonl', storeDir));
  const verified = readJsonlSafe<ExpertVerifiedDatasetRecord>(
    getStorePath('expert-verified-dataset.jsonl', storeDir)
  );
  const telemetry = readJsonlSafe<Record<string, unknown>>(
    getStorePath('scan-telemetry.jsonl', storeDir)
  );

  return {
    currentModelVersion: MODEL_VERSION_HISTORY[0].version,
    modelHistory: MODEL_VERSION_HISTORY,
    totalTelemetryScans: telemetry.length,
    pendingExpertReview: feedback.filter((f) => f.quarantineStatus === 'pending_expert_review').slice(-25),
    quarantinedCount: feedback.filter((f) => f.quarantineStatus === 'pending_expert_review').length,
    verifiedDatasetCount: verified.length,
    splitCounts: {
      train: verified.filter((v) => v.split === 'train').length,
      val: verified.filter((v) => v.split === 'val').length,
      test: verified.filter((v) => v.split === 'test').length,
    },
    limitations: VISION_LIMITATIONS_AND_PREREQUISITES,
  };
}

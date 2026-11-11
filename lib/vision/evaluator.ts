import { normalizeAndValidateDiagnosis } from '../diagnosis-normalizer';
import type { ImageQualityReport } from '../image-quality';
import type { CropDiagnosis } from '../schemas';

export interface EvaluationFixtureCase {
  id: string;
  scenario:
    | 'healthy'
    | 'diseased'
    | 'multi_disease'
    | 'pest'
    | 'nutrient_deficiency'
    | 'abiotic_stress'
    | 'mixed_infection'
    | 'poor_quality'
    | 'unidentified_plant'
    | 'non_agricultural'
    | 'multi_part'
    | 'low_light'
    | 'regional';
  region: string;
  selectedCrop: string;
  scanMode: 'single_plant' | 'whole_field';
  imagesCount?: number;
  clientQuality?: ImageQualityReport;
  expectedCropMatch: boolean;
  expectedHealthy: boolean;
  expectedNonPlant: boolean;
  expectsUnsafeChemBlocked?: boolean;
  maxExpectedCertainty?: number;
  rawModelPayload: Record<string, unknown>;
}

export interface VisionEvaluationReport {
  totalCases: number;
  cropIdentificationAccuracy: number;
  diseasePrecision: number;
  diseaseRecall: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  calibrationComplianceRate: number;
  differentialCoverageRate: number;
  chemicalSafetyPassRate: number;
  regionBreakdown: Record<string, { cases: number; passedSafetyAndCalibration: number }>;
  scenarioResults: Array<{
    id: string;
    scenario: string;
    region: string;
    ok: boolean;
    calibratedCertainty: number;
    evidenceQuality: string;
    safetyBlockedCount: number;
  }>;
  documentedLimitations: string[];
}

export function runVisionPipelineEvaluation(
  fixtures: EvaluationFixtureCase[]
): VisionEvaluationReport {
  let cropCorrect = 0;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let calibrationOk = 0;
  let diffCases = 0;
  let diffCovered = 0;
  let safetyTotal = 0;
  let safetyPassed = 0;

  const regionBreakdown: Record<string, { cases: number; passedSafetyAndCalibration: number }> = {};
  const scenarioResults: VisionEvaluationReport['scenarioResults'] = [];

  for (const fx of fixtures) {
    const res = normalizeAndValidateDiagnosis(fx.rawModelPayload, {
      selectedCrop: fx.selectedCrop,
      inspectionSource: 'gemini_vision',
      geminiStatus: 'completed',
      clientQuality: fx.clientQuality,
      scanMode: fx.scanMode,
      imagesCount: fx.imagesCount ?? 1,
      region: fx.region,
    });

    if (!regionBreakdown[fx.region]) {
      regionBreakdown[fx.region] = { cases: 0, passedSafetyAndCalibration: 0 };
    }
    regionBreakdown[fx.region].cases++;

    if (!res.ok) {
      scenarioResults.push({
        id: fx.id,
        scenario: fx.scenario,
        region: fx.region,
        ok: false,
        calibratedCertainty: 0,
        evidenceQuality: 'insufficient',
        safetyBlockedCount: 0,
      });
      continue;
    }

    const d: CropDiagnosis = res.data;

    // 1. Crop & invalid-image accuracy
    const cropOk = fx.expectedNonPlant
      ? d.image_valid === false && d.diagnosis_status === 'invalid_image'
      : d.crop_match === fx.expectedCropMatch;
    if (cropOk) cropCorrect++;

    // 2. Diseased vs Healthy confusion matrix (excluding invalid non-plant images)
    if (!fx.expectedNonPlant) {
      const predictedDiseased = d.diagnosis_status !== 'healthy_no_symptoms' && d.diagnosis_status !== 'crop_mismatch';
      const actuallyDiseased = !fx.expectedHealthy;

      if (actuallyDiseased && predictedDiseased) tp++;
      else if (!actuallyDiseased && !predictedDiseased) tn++;
      else if (!actuallyDiseased && predictedDiseased) fp++;
      else if (actuallyDiseased && !predictedDiseased) fn++;
    }

    // 3. Confidence calibration check
    const maxCap = fx.maxExpectedCertainty ?? 0.94;
    const cert = d.confidence_breakdown?.diagnostic_certainty ?? d.identification_confidence;
    const calPass =
      cert <= maxCap &&
      d.confidence_breakdown?.lab_confirmation_status === 'unconfirmed_visual_screening';
    if (calPass) calibrationOk++;

    // 4. Differential coverage for non-healthy, valid scans
    if (!fx.expectedHealthy && !fx.expectedNonPlant && fx.expectedCropMatch) {
      diffCases++;
      if ((d.differential_diagnoses?.length || 0) > 0) diffCovered++;
    }

    // 5. Prohibited chemical safety check
    let safetyOk = true;
    const blockedCount = d.safety_guardrail_notes?.length || 0;
    if (fx.expectsUnsafeChemBlocked) {
      safetyTotal++;
      const stillHasProhibited = d.treatment_pillars?.chemical_management?.some((c) =>
        /monocrotophos|endosulfan|carbofuran|ddt/i.test(c.active_ingredient)
      );
      safetyOk = blockedCount > 0 && !stillHasProhibited;
      if (safetyOk) safetyPassed++;
    }

    if (calPass && safetyOk && cropOk) {
      regionBreakdown[fx.region].passedSafetyAndCalibration++;
    }

    scenarioResults.push({
      id: fx.id,
      scenario: fx.scenario,
      region: fx.region,
      ok: cropOk && calPass && safetyOk,
      calibratedCertainty: cert,
      evidenceQuality: d.confidence_breakdown?.visual_evidence_quality || 'moderate',
      safetyBlockedCount: blockedCount,
    });
  }

  const total = Math.max(1, fixtures.length);
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
  const fnr = fn + tp > 0 ? fn / (fn + tp) : 0;

  return {
    totalCases: fixtures.length,
    cropIdentificationAccuracy: Number((cropCorrect / total).toFixed(3)),
    diseasePrecision: Number(precision.toFixed(3)),
    diseaseRecall: Number(recall.toFixed(3)),
    falsePositiveRate: Number(fpr.toFixed(3)),
    falseNegativeRate: Number(fnr.toFixed(3)),
    calibrationComplianceRate: Number((calibrationOk / total).toFixed(3)),
    differentialCoverageRate: diffCases > 0 ? Number((diffCovered / diffCases).toFixed(3)) : 1,
    chemicalSafetyPassRate: safetyTotal > 0 ? Number((safetyPassed / safetyTotal).toFixed(3)) : 1,
    regionBreakdown,
    scenarioResults,
    documentedLimitations: [
      'Visual AI precision/recall cannot reach 100% — microscopic spores, latent viruses, and overlapping herbicide vs viral symptoms require laboratory testing.',
      'Benchmark above validates deterministic clinical calibration, safety blocking, false-negative lesion invariant, and schema integrity across curated multi-region test scenarios — NOT accuracy of an externally trained PyTorch ViT model.',
      'True empirical field accuracy across Pakistani provinces requires annotated farmer-confirmed & lab-confirmed field photographs evaluated after human-in-the-loop expert labeling.',
    ],
  };
}

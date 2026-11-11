import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  EvaluationFixtureCase,
  runVisionPipelineEvaluation,
} from '../lib/vision/evaluator';
import { buildStructuredAgronomyReportText } from '../lib/vision/report-formatter';
import { normalizeAndValidateDiagnosis } from '../lib/diagnosis-normalizer';
import {
  getContinuousLearningSummary,
  submitQuarantinedFeedback,
  verifyAndPromoteFeedback,
} from '../lib/vision/learning-store';
import { GET as expertReviewGet, POST as expertReviewPost } from '../app/api/scan/expert-review/route';

let passed = 0;
let failed = 0;

function testCase(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  PASS: ${name}`);
    })
    .catch((err) => {
      failed++;
      console.error(`  FAIL: ${name}\n`, err);
    });
}

function makeBasePayload(overrides: Record<string, unknown>) {
  return {
    image_valid: true,
    detected_crop: 'Wheat',
    detected_crop_ur: 'گندم',
    selected_crop: 'wheat',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    growth_stage: 'Tillering',
    growth_stage_ur: 'شگوفے',
    identification_confidence: 0.89,
    scientific_name: 'Puccinia striiformis',
    pathogen_type: 'fungal',
    problem_category: 'fungal_infection',
    diagnosis_status: 'possible_disease',
    plant_condition: 'Infected',
    plant_condition_ur: 'متاثرہ',
    problem_name: { en: 'Wheat Yellow Rust', ur: 'گندم کی زرد کنگی' },
    observed_symptoms: [{ en: 'Yellow powdery stripes', ur: 'پتوں پر زرد دھبے' }],
    why_suspected: { en: 'Linear uredinia stripes', ur: 'سیدھی زرد لکیریں' },
    severity: 'medium',
    requires_retake: false,
    requires_expert_review: true,
    message: { en: 'Yellow rust observed', ur: 'زرد کنگی کی علامات' },
    differential_diagnoses: [
      {
        name: 'Wheat Leaf Rust',
        scientific_name: 'Puccinia triticina',
        similarities: { en: 'Orange-yellow pustules', ur: 'نارنجی دھبے' },
        differences: { en: 'Random scatter instead of linear stripes', ur: 'بے ترتیب پھیلاؤ' },
        likelihood: 'less_likely',
        field_distinction_tip: { en: 'Check stripe alignment', ur: 'لکیروں کی ترتیب دیکھیں' },
      },
    ],
    treatment_pillars: {
      immediate_actions: [{ en: 'Scout 20 plants across edges', ur: 'کھیت میں بیس پودے چیک کریں' }],
      short_term_management: [{ en: 'Avoid excess urea', ur: 'اضافی یوریا روکیں' }],
      cultural_management: [{ en: 'Clear grasses on bunds', ur: 'وٹوں سے گھاس صاف کریں' }],
      biological_management: [],
      long_term_prevention: [{ en: 'Sow rust-tolerant cultivars', ur: 'مزاحم اقسام بوئیں' }],
      chemical_management: [],
    },
    disease_development_conditions: { en: 'Cool moist 12-20C nights', ur: 'ٹھنڈی نم راتیں' },
    yield_impact: { en: 'Up to 30-50% yield loss if flag leaf is rusted early', ur: 'پیداوار میں کمی کا خطرہ' },
    quality_risk: { en: 'Shriveled low-weight grains', ur: 'دانے کمزور رہ سکتے ہیں' },
    additional_testing_required: { en: 'Confirm spore morphology under extension microscope', ur: 'ماہر معائنہ' },
    ...overrides,
  };
}

async function runTests() {
  console.log('\n=== Zarkhez Cloud Vision Evaluation & Continuous Learning Suite ===\n');

  const fixtures: EvaluationFixtureCase[] = [
    {
      id: 'eval_healthy_wheat',
      scenario: 'healthy',
      region: 'central_punjab',
      selectedCrop: 'wheat',
      scanMode: 'single_plant',
      expectedCropMatch: true,
      expectedHealthy: true,
      expectedNonPlant: false,
      maxExpectedCertainty: 0.94,
      rawModelPayload: makeBasePayload({
        identification_confidence: 0.99,
        diagnosis_status: 'healthy_no_symptoms',
        pathogen_type: 'healthy',
        problem_category: 'healthy',
        severity: 'low',
        scientific_name: '',
        problem_name: { en: 'Healthy Wheat Leaf', ur: 'تندرست گندم' },
        observed_symptoms: [],
        differential_diagnoses: [],
      }),
    },
    {
      id: 'eval_maize_cob_differential',
      scenario: 'multi_part',
      region: 'kp_valleys',
      selectedCrop: 'auto',
      scanMode: 'single_plant',
      expectedCropMatch: true,
      expectedHealthy: false,
      expectedNonPlant: false,
      rawModelPayload: makeBasePayload({
        detected_crop: 'Maize',
        detected_crop_ur: 'مکئی',
        detected_plant_part: 'Corn Cob',
        detected_plant_part_ur: 'بھٹہ',
        problem_name: { en: 'Maize Diplodia Ear Rot', ur: 'مکئی ڈپلوڈیا سڑاؤ' },
        scientific_name: 'Stenocarpella maydis',
        differential_diagnoses: [
          {
            name: 'Fusarium Ear Rot',
            scientific_name: 'Fusarium verticillioides',
            similarities: { en: 'Dark/moldy kernels', ur: 'خراب دانے' },
            differences: { en: 'Fusarium starburst streaks scatter across random kernels vs Diplodia starting at cob base', ur: 'پھیلاؤ میں فرق' },
            likelihood: 'less_likely',
            field_distinction_tip: { en: 'Inspect cob base mycelium density', ur: 'بھٹے کی جڑ پر پھپھوندی دیکھیں' },
          },
        ],
      }),
    },
    {
      id: 'eval_mixed_coinfection',
      scenario: 'mixed_infection',
      region: 'central_punjab',
      selectedCrop: 'rice',
      scanMode: 'whole_field',
      imagesCount: 3,
      expectedCropMatch: true,
      expectedHealthy: false,
      expectedNonPlant: false,
      rawModelPayload: makeBasePayload({
        detected_crop: 'Rice',
        detected_crop_ur: 'دھان',
        problem_name: { en: 'Rice Blast with Secondary Brown Spot', ur: 'دھان کا بلاسٹ اور براؤن سپاٹ' },
        possible_co_infections: [{ en: 'Early Bipolaris brown spot lesions along margins', ur: 'کناروں پر براؤن سپاٹ کے آثار' }],
      }),
    },
    {
      id: 'eval_pest_whitefly',
      scenario: 'pest',
      region: 'south_punjab',
      selectedCrop: 'cotton',
      scanMode: 'single_plant',
      expectedCropMatch: true,
      expectedHealthy: false,
      expectedNonPlant: false,
      expectsUnsafeChemBlocked: true,
      rawModelPayload: makeBasePayload({
        detected_crop: 'Cotton',
        detected_crop_ur: 'کپاس',
        pathogen_type: 'pest',
        problem_category: 'insect_pest',
        diagnosis_status: 'possible_pest',
        problem_name: { en: 'Cotton Whitefly & Sooty Mold', ur: 'کپاس کی سفید مکھی' },
        treatment_pillars: {
          immediate_actions: [{ en: 'Install yellow sticky traps', ur: 'پیلے چپکنے والے کارڈ لگائیں' }],
          chemical_management: [
            {
              active_ingredient: 'Monocrotophos',
              purpose: { en: 'Banned test payload', ur: 'پابندی شدہ دوا' },
              safety_precautions: { en: 'Unsafe test', ur: 'غیر محفوظ' },
            },
            {
              active_ingredient: 'Pyriproxyfen',
              purpose: { en: 'Nymph insect growth regulator', ur: 'بچوں کی روک تھام' },
              safety_precautions: { en: 'Follow registered label PHI', ur: 'لیبل کے مطابق' },
            },
          ],
        },
      }),
    },
    {
      id: 'eval_nutrient_deficiency',
      scenario: 'nutrient_deficiency',
      region: 'sindh_delta',
      selectedCrop: 'rice',
      scanMode: 'single_plant',
      expectedCropMatch: true,
      expectedHealthy: false,
      expectedNonPlant: false,
      rawModelPayload: makeBasePayload({
        detected_crop: 'Rice',
        detected_crop_ur: 'دھان',
        pathogen_type: 'nutrient_deficiency',
        problem_category: 'nutrient_deficiency',
        diagnosis_status: 'possible_nutrient_deficiency',
        problem_name: { en: 'Rice Zinc (Khaira) Deficiency', ur: 'دھان میں زنک کی کمی' },
      }),
    },
    {
      id: 'eval_abiotic_herbicide_drift',
      scenario: 'abiotic_stress',
      region: 'south_punjab',
      selectedCrop: 'cotton',
      scanMode: 'single_plant',
      expectedCropMatch: true,
      expectedHealthy: false,
      expectedNonPlant: false,
      rawModelPayload: makeBasePayload({
        detected_crop: 'Cotton',
        detected_crop_ur: 'کپاس',
        pathogen_type: 'environmental_stress',
        problem_category: 'chemical_herbicide_injury',
        diagnosis_status: 'environmental_stress',
        scientific_name: '',
        problem_name: { en: 'Suspected 2,4-D Herbicide Drift Injury', ur: 'جڑی بوٹی مار دوا کا اثر' },
      }),
    },
    {
      id: 'eval_poor_blur_quality',
      scenario: 'poor_quality',
      region: 'potohar_rainfed',
      selectedCrop: 'pulses',
      scanMode: 'single_plant',
      expectedCropMatch: true,
      expectedHealthy: false,
      expectedNonPlant: false,
      maxExpectedCertainty: 0.56,
      clientQuality: {
        isBlurry: true,
        isDark: false,
        isOverexposed: false,
        isTooSmall: false,
        blurScore: 12,
        brightnessScore: 110,
        subjectRatio: 0.4,
        overallScore: 0.4,
        isAcceptable: false,
      },
      rawModelPayload: makeBasePayload({
        detected_crop: 'Chickpea',
        detected_crop_ur: 'چنا',
        identification_confidence: 0.97,
        problem_name: { en: 'Ascochyta Blight', ur: 'چنے کا جھلساؤ' },
      }),
    },
    {
      id: 'eval_low_light_balochistan',
      scenario: 'low_light',
      region: 'balochistan_arid',
      selectedCrop: 'apple',
      scanMode: 'single_plant',
      expectedCropMatch: true,
      expectedHealthy: false,
      expectedNonPlant: false,
      maxExpectedCertainty: 0.64,
      clientQuality: {
        isBlurry: false,
        isDark: true,
        isOverexposed: false,
        isTooSmall: false,
        blurScore: 120,
        brightnessScore: 28,
        subjectRatio: 0.45,
        overallScore: 0.5,
        isAcceptable: false,
      },
      rawModelPayload: makeBasePayload({
        detected_crop: 'Apple',
        detected_crop_ur: 'سیب',
        identification_confidence: 0.95,
        problem_name: { en: 'Apple Fire Blight', ur: 'سیب کا فائر بلائٹ' },
      }),
    },
    {
      id: 'eval_unidentified_plant',
      scenario: 'unidentified_plant',
      region: 'potohar_rainfed',
      selectedCrop: 'auto',
      scanMode: 'single_plant',
      expectedCropMatch: true,
      expectedHealthy: false,
      expectedNonPlant: false,
      maxExpectedCertainty: 0.62,
      rawModelPayload: makeBasePayload({
        detected_crop: 'Unidentified Plant',
        detected_crop_ur: 'غیر شناختہ پودا',
        crop_match: true,
        diagnosis_status: 'uncertain',
        identification_confidence: 0.88,
        problem_name: { en: 'Unidentified Species Marginal Scorch', ur: 'غیر شناختہ پودے کے کناروں کا جھلساؤ' },
      }),
    },
    {
      id: 'eval_non_agricultural_photo',
      scenario: 'non_agricultural',
      region: 'central_punjab',
      selectedCrop: 'wheat',
      scanMode: 'single_plant',
      expectedCropMatch: false,
      expectedHealthy: false,
      expectedNonPlant: true,
      rawModelPayload: {
        image_valid: false,
        diagnosis_status: 'invalid_image',
        identification_confidence: 0.91,
      },
    },
  ];

  await testCase('1. Multi-region 10-scenario evaluation measures precision, recall, calibration, and safety', () => {
    const report = runVisionPipelineEvaluation(fixtures);
    assert.equal(report.totalCases, 10);
    assert.equal(report.cropIdentificationAccuracy, 1);
    assert.equal(report.diseasePrecision, 1);
    assert.equal(report.diseaseRecall, 1);
    assert.equal(report.falsePositiveRate, 0);
    assert.equal(report.falseNegativeRate, 0);
    assert.equal(report.calibrationComplianceRate, 1);
    assert.equal(report.chemicalSafetyPassRate, 1);
    assert.ok(report.regionBreakdown.south_punjab.passedSafetyAndCalibration === 2);
    assert.ok(report.documentedLimitations.some((l) => l.includes('cannot reach 100%')));
  });

  await testCase('2. Single-plant vs Whole-Field enforcement & 25-section structured report builder', () => {
    const res = normalizeAndValidateDiagnosis(
      makeBasePayload({
        identification_confidence: 0.98,
        severity_scope: {
          leaf_affected_pct: 15,
          scope_note: {
            en: 'Single leaf only',
            ur: 'صرف ایک پتا',
          },
        },
      }),
      { selectedCrop: 'wheat', scanMode: 'single_plant', imagesCount: 1 }
    );
    assert.ok(res.ok);
    assert.equal(res.data.field_assessment?.mode, 'single_plant');
    assert.equal(res.data.confidence_breakdown?.model_confidence, 0.98);
    assert.ok((res.data.confidence_breakdown?.diagnostic_certainty || 0) <= 0.94);
    assert.equal(res.data.confidence_breakdown?.lab_confirmation_status, 'unconfirmed_visual_screening');
    assert.ok(res.data.scientific_references && res.data.scientific_references.length > 0);

    const textEn = buildStructuredAgronomyReportText(res.data, 'en');
    assert.ok(textEn.includes('1. Crop Identification'));
    assert.ok(textEn.includes('16. Differential Diagnosis'));
    assert.ok(textEn.includes('25. Additional Testing Required'));
    assert.ok(textEn.includes('cannot guarantee 100% accuracy'));
  });

  await testCase('3. Quarantined feedback queue isolates raw feedback until authenticated expert verification', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zrk-vision-learn-'));
    try {
      const sub = submitQuarantinedFeedback(
        {
          scanId: 'scan_test_1',
          modelVersion: 'zarkhez-vision-v2.4-cloud',
          verdict: 'incorrect',
          predictedCrop: 'Maize',
          predictedProblem: 'Fusarium Ear Rot',
          correctedCrop: 'Maize',
          correctedDisease: 'Diplodia Ear Rot',
          correctedSeverity: 'high',
          confirmedSource: 'farmer',
          region: 'kp_valleys',
          consentForDataset: true,
          imageHash: 'abc123def4567890abc123def4567890',
        },
        tmpDir
      );
      assert.ok(sub.saved);
      assert.equal(sub.entry.quarantineStatus, 'pending_expert_review');

      let summary = getContinuousLearningSummary(tmpDir);
      assert.equal(summary.quarantinedCount, 1);
      assert.equal(summary.verifiedDatasetCount, 0, 'Raw feedback must NEVER enter dataset directly');

      const promoted = verifyAndPromoteFeedback({
        feedbackId: sub.entry.feedbackId,
        verifiedBy: 'dr.tariq@parc.gov.pk',
        decision: 'approve',
        verifiedCrop: 'Maize',
        verifiedDisease: 'Diplodia Ear Rot',
        verifiedSeverity: 'high',
        confirmationLevel: 'laboratory_confirmed',
        storeDir: tmpDir,
      });
      assert.ok(promoted.ok && promoted.promotedRecord);
      assert.equal(promoted.promotedRecord.confirmationLevel, 'laboratory_confirmed');

      const dupAttempt = verifyAndPromoteFeedback({
        feedbackId: sub.entry.feedbackId,
        verifiedBy: 'dr.tariq@parc.gov.pk',
        decision: 'approve',
        verifiedCrop: 'Maize',
        verifiedDisease: 'Diplodia Ear Rot',
        verifiedSeverity: 'high',
        storeDir: tmpDir,
      });
      assert.equal(dupAttempt.ok, false);
      assert.equal(dupAttempt.reason, 'duplicate_image_hash_rejected');

      summary = getContinuousLearningSummary(tmpDir);
      assert.equal(summary.quarantinedCount, 0);
      assert.equal(summary.verifiedDatasetCount, 1);

      // Verify expert review API enforces strict admin auth
      const unauthGet = await expertReviewGet(new NextRequest('http://localhost/api/scan/expert-review'));
      assert.equal(unauthGet.status, 401);
      const unauthPost = await expertReviewPost(
        new NextRequest('http://localhost/api/scan/expert-review', {
          method: 'POST',
          body: JSON.stringify({}),
        })
      );
      assert.equal(unauthPost.status, 401);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  console.log(`\nVision Evaluation Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Vision evaluation suite failed cleanly:', err);
  process.exit(1);
});

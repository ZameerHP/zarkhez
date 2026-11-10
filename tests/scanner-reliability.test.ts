import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { extractAndParseJson } from '../lib/json-extractor';
import { normalizeAndValidateDiagnosis } from '../lib/diagnosis-normalizer';
import {
  analyzeCropImageWithGemini,
  GeminiVisionError,
  getFallbackCropDiagnosis,
  validateScanImagePayload,
} from '../lib/gemini';
import { buildOfflinePreliminaryAssessment } from '../lib/offline-assessment';
import { CropDiagnosisSchema, getLocalizedText } from '../lib/schemas';
import { POST as analyzeRoutePost } from '../app/api/scan/analyze/route';
import { saveScanRecord } from '../lib/supabase/client';
import { speakText } from '../lib/voice';

let passed = 0;
let failed = 0;

const SAMPLE_IMAGE_B64 =
  'data:image/jpeg;base64,' + 'A'.repeat(256);

function makeValidGeminiPayload(overrides: Record<string, unknown> = {}) {
  return {
    image_valid: true,
    detected_crop: 'Potato',
    detected_crop_ur: 'آلو',
    detected_crop_roman_ur: 'Aloo',
    detected_crop_sd: 'آلو',
    selected_crop: 'potato',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    detected_plant_part_roman_ur: 'Patta',
    detected_plant_part_sd: 'پن',
    growth_stage: 'Vegetative',
    growth_stage_ur: 'بڑھوتری کا مرحلہ',
    identification_confidence: 0.91,
    scientific_name: 'Phytophthora infestans',
    pathogen_type: 'fungal',
    confidence_category: 'high',
    visual_inspection: {
      lesion_detected: true,
      lesion_count: '5 dark spots',
      lesion_shape: 'elongated_irregular',
      lesion_colors: ['dark_brown', 'chlorotic_halo'],
      lesion_margins: 'greasy water-soaked',
      lesion_distribution: 'leaf margins',
      tissue_damage: 'necrotic patches',
      chlorosis_detected: true,
      necrosis_detected: true,
      wilting_detected: false,
      affected_area_pct: 15,
      detected_hotspots: [{ x: 20, y: 30, w: 25, h: 20, label: 'Blight patch' }],
    },
    diagnosis_status: 'possible_disease',
    plant_condition: 'Greasy dark lesions observed on potato leaf margins.',
    plant_condition_ur: 'آلو کے پتے کے کناروں پر گہرے بھورے جھلساؤ کے دھبے دیکھے گئے۔',
    problem_name: {
      en: 'Suspected Potato Late Blight',
      ur: 'آلو کا پچھیتا جھلساؤ',
      roman_ur: 'Aloo ka Pacheta Jhulsao',
      sd: 'آلو جو پڇاڙيءَ وارو سڙڻ',
    },
    possible_disease: [
      { name: 'Late Blight', name_ur: 'پچھیتا جھلساؤ', confidence: 0.91, is_primary: true },
    ],
    observed_symptoms: [
      { en: 'Dark irregular water-soaked patches', ur: 'پتے پر گہرے پانی بھرے دھبے' },
    ],
    possible_causes: [
      { en: 'Humid weather favoring oomycete infection', ur: 'زیادہ نمی میں پھپھوندی نما جراثیم کا حملہ' },
    ],
    severity: 'high',
    recommendations: [
      { en: 'Avoid overhead irrigation in evenings.', ur: 'شام کے وقت اوپر سے پانی لگانے سے پرہیز کریں۔' },
    ],
    prevention: [
      { en: 'Use certified disease-free seed tubers.', ur: 'صحت مند تصدیق شدہ بیج کاشت کریں۔' },
    ],
    requires_retake: false,
    requires_expert_review: true,
    message: {
      en: 'Suspected potato late blight symptoms observed on foliage.',
      ur: 'آلو کے پتے پر پچھیتے جھلساؤ کی علامات دیکھی گئی ہیں۔',
    },
    ...overrides,
  };
}

function geminiHttpSuccess(bodyText: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: bodyText }] }, finishReason: 'STOP' }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

async function testCase(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${name}`, err);
  }
}

async function run() {
  console.log('\n🛡️ Running Zarkhez Production Reliability & Integration Test Suite...\n');

  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'AIzaSyTestMockKeyForIntegrationVerification12345';
  process.env.GEMINI_MODEL_FAST = 'gemini-flash-lite-latest';

  try {
    // 1. Valid Gemini diagnosis end-to-end (service + API route)
    await testCase('1. Valid Gemini diagnosis validates cleanly via service & /api/scan/analyze', async () => {
      globalThis.fetch = async () =>
        geminiHttpSuccess(JSON.stringify(makeValidGeminiPayload()));

      const req = new NextRequest('http://localhost/api/scan/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
        body: JSON.stringify({
          image: SAMPLE_IMAGE_B64,
          selectedCrop: 'potato',
          confirmMismatchOverride: false,
        }),
      });

      const res = await analyzeRoutePost(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.problem_name.en, 'Suspected Potato Late Blight');
      assert.equal(data.severity, 'high');
      assert.equal(data.inspection_source, 'gemini_vision');
      assert.equal(data.gemini_inspection_status, 'completed');
      assert.ok(data.scan_timestamp);
      assert.equal(data.plant_name.ur, 'آلو');
    });

    // 2. Missing problem_name (NEVER fabricated for disease assessment!)
    await testCase('2. Missing problem_name is rejected strictly with structured field path', () => {
      const payload = makeValidGeminiPayload();
      delete (payload as Record<string, unknown>).problem_name;

      const norm = normalizeAndValidateDiagnosis(payload, { selectedCrop: 'potato' });
      assert.equal(norm.ok, false);
      if (!norm.ok) {
        assert.equal(norm.code, 'ZOD_VALIDATION_FAILED');
        assert.ok(norm.fieldErrors.some((f) => f.path === 'problem_name'));
      }
    });

    // 3. Missing severity
    await testCase('3. Missing severity is rejected strictly with structured field path', () => {
      const payload = makeValidGeminiPayload();
      delete (payload as Record<string, unknown>).severity;

      const norm = normalizeAndValidateDiagnosis(payload, { selectedCrop: 'potato' });
      assert.equal(norm.ok, false);
      if (!norm.ok) {
        assert.ok(norm.fieldErrors.some((f) => f.path === 'severity'));
      }
    });

    // 4. Missing boolean fields & rejecting invalid string boolean coercion
    await testCase('4. Missing boolean fields AND string booleans are strictly rejected', () => {
      const payloadMissing = makeValidGeminiPayload();
      delete (payloadMissing as Record<string, unknown>).requires_retake;
      delete (payloadMissing as Record<string, unknown>).requires_expert_review;

      const norm1 = normalizeAndValidateDiagnosis(payloadMissing, { selectedCrop: 'potato' });
      assert.equal(norm1.ok, false);
      if (!norm1.ok) {
        assert.ok(norm1.fieldErrors.some((f) => f.path === 'requires_retake'));
        assert.ok(norm1.fieldErrors.some((f) => f.path === 'requires_expert_review'));
      }

      // Invalid boolean coercion check ("true" / "yes" strings MUST NOT be coerced!)
      const payloadStringBool = makeValidGeminiPayload({
        requires_retake: 'true',
        requires_expert_review: 'yes',
      });
      const norm2 = normalizeAndValidateDiagnosis(payloadStringBool, { selectedCrop: 'potato' });
      assert.equal(norm2.ok, false);
      if (!norm2.ok) {
        assert.ok(norm2.fieldErrors.some((f) => f.path === 'requires_retake'));
        assert.ok(norm2.fieldErrors.some((f) => f.path === 'requires_expert_review'));
      }
    });

    // 5. Missing message
    await testCase('5. Missing message is rejected strictly with structured field path', () => {
      const payload = makeValidGeminiPayload();
      delete (payload as Record<string, unknown>).message;

      const norm = normalizeAndValidateDiagnosis(payload, { selectedCrop: 'potato' });
      assert.equal(norm.ok, false);
      if (!norm.ok) {
        assert.ok(norm.fieldErrors.some((f) => f.path === 'message'));
      }
    });

    // 6. Invalid severity & valid enum normalization
    await testCase('6. Invalid severity fails validation while valid severity synonyms normalize safely', () => {
      const bogus = makeValidGeminiPayload({ severity: 'catastrophic_disaster' });
      const badNorm = normalizeAndValidateDiagnosis(bogus, { selectedCrop: 'potato' });
      assert.equal(badNorm.ok, false);
      if (!badNorm.ok) {
        assert.ok(badNorm.fieldErrors.some((f) => f.path === 'severity'));
      }

      const moderateVariant = makeValidGeminiPayload({ severity: 'Moderate' });
      const goodNorm = normalizeAndValidateDiagnosis(moderateVariant, { selectedCrop: 'potato' });
      assert.equal(goodNorm.ok, true);
      if (goodNorm.ok) {
        assert.equal(goodNorm.data.severity, 'medium');
      }
    });

    // 7. Invalid JSON (recoverable premature brace bug vs unrecoverable syntax garbage)
    await testCase('7. JSON extractor repairs premature Gemini closing brace AND rejects unrecoverable garbage', () => {
      const brokenWithPrematureBrace = `{
        "image_valid": true,
        "plant_condition": "Healthy tubers",
        "plant_condition_ur": "صحت مند آلو",
        "sd": "صحت مند آلو"
      }
        "problem_name": { "en": "Healthy", "ur": "تندرست" },
        "severity": "low",
        "requires_retake": false,
        "requires_expert_review": false,
        "message": { "en": "Healthy crop.", "ur": "فصل صحت مند ہے۔" }
      }`;
      const fixed = extractAndParseJson(brokenWithPrematureBrace);
      assert.equal(fixed.ok, true);
      if (fixed.ok) {
        assert.equal(fixed.repaired, true);
        assert.ok(fixed.repairNotes.includes('repaired_premature_closing_brace'));
        assert.equal((fixed.data as Record<string, unknown>).severity, 'low');
      }

      const totallyBroken = extractAndParseJson('{{{{ definitely not json at all');
      assert.equal(totallyBroken.ok, false);
      if (!totallyBroken.ok) {
        assert.equal(totallyBroken.code, 'INVALID_JSON');
      }
    });

    // 8. Markdown-wrapped JSON with commentary & trailing commas
    await testCase('8. Extracts JSON wrapped in markdown fences with surrounding text & trailing commas', () => {
      const wrapped = `Here is the plant pathology report:
      \`\`\`json
      ${JSON.stringify(makeValidGeminiPayload()).replace(/\}$/, ',}')}
      \`\`\`
      Let me know if you need more help!`;

      const parsed = extractAndParseJson(wrapped);
      assert.equal(parsed.ok, true);
      if (parsed.ok) {
        const norm = normalizeAndValidateDiagnosis(parsed.data, { selectedCrop: 'potato' });
        assert.equal(norm.ok, true);
      }
    });

    // 9. Empty Gemini response
    await testCase('9. Empty Gemini response is caught and returned as structured error on API route', async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '   ' }] } }] }), {
          status: 200,
        });

      const req = new NextRequest('http://localhost/api/scan/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
        body: JSON.stringify({ image: SAMPLE_IMAGE_B64, selectedCrop: 'wheat' }),
      });
      const res = await analyzeRoutePost(req);
      assert.ok(res.status >= 500);
      const errBody = await res.json();
      assert.equal(errBody.error, 'structured_scan_error');
      assert.equal(errBody.code, 'EMPTY_RESPONSE');
      assert.equal(errBody.retryable, true);
    });

    // 10. Null / undefined response
    await testCase('10. Null and undefined inputs fail safely without uncaught exception', () => {
      const pNull = extractAndParseJson(null);
      assert.equal(pNull.ok, false);
      const nNull = normalizeAndValidateDiagnosis(null, { selectedCrop: 'wheat' });
      assert.equal(nNull.ok, false);
      const nEmpty = normalizeAndValidateDiagnosis({}, { selectedCrop: 'wheat' });
      assert.equal(nEmpty.ok, false);
    });

    // 11. Gemini API timeout
    await testCase('11. Gemini API TimeoutError classifies as retryable network_or_timeout', async () => {
      globalThis.fetch = async () => {
        const err = new Error('The operation timed out');
        err.name = 'TimeoutError';
        throw err;
      };

      await assert.rejects(
        () => analyzeCropImageWithGemini(SAMPLE_IMAGE_B64, 'wheat'),
        (e: unknown) => {
          assert.ok(e instanceof GeminiVisionError);
          assert.equal(e.errorCategory, 'network_or_timeout');
          assert.equal(e.code, 'API_TIMEOUT');
          assert.equal(e.retryable, true);
          return true;
        }
      );
    });

    // 12. Network disconnection
    await testCase('12. Network disconnection classifies cleanly as NETWORK_ERROR', async () => {
      globalThis.fetch = async () => {
        throw new TypeError('fetch failed: ECONNREFUSED');
      };

      await assert.rejects(
        () => analyzeCropImageWithGemini(SAMPLE_IMAGE_B64, 'rice'),
        (e: unknown) => {
          assert.ok(e instanceof GeminiVisionError);
          assert.equal(e.errorCategory, 'network_or_timeout');
          assert.equal(e.code, 'NETWORK_ERROR');
          assert.equal(e.retryable, true);
          return true;
        }
      );
    });

    // 13. Rate limiting (temporary 429 vs quota exhausted 429)
    await testCase('13. Rate limit vs Quota Exhaustion classification on 429', async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: { message: 'Per-minute rate limit exceeded' } }), { status: 429 });

      await assert.rejects(
        () => analyzeCropImageWithGemini(SAMPLE_IMAGE_B64, 'wheat'),
        (e: unknown) => {
          assert.ok(e instanceof GeminiVisionError);
          assert.equal(e.errorCategory, 'rate_limited');
          assert.equal(e.retryable, true);
          return true;
        }
      );

      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: { message: 'You exceeded your current quota, check billing' } }), {
          status: 429,
        });

      let calls = 0;
      const quotaFetch = globalThis.fetch;
      globalThis.fetch = async (...args) => {
        calls++;
        return quotaFetch(...args);
      };

      await assert.rejects(
        () => analyzeCropImageWithGemini(SAMPLE_IMAGE_B64, 'wheat'),
        (e: unknown) => {
          assert.ok(e instanceof GeminiVisionError);
          assert.equal(e.errorCategory, 'quota_exhausted');
          assert.equal(e.code, 'QUOTA_EXHAUSTED');
          assert.equal(e.retryable, false);
          return true;
        }
      );
      assert.equal(calls, 1, 'Quota exhausted must stop immediately without wasting model retries');
    });

    // 14. Invalid / empty / corrupt image input
    await testCase('14. Empty & corrupt images rejected before any Gemini API call', async () => {
      let apiCalled = false;
      globalThis.fetch = async () => {
        apiCalled = true;
        return geminiHttpSuccess('{}');
      };

      assert.throws(
        () => validateScanImagePayload(''),
        (e: unknown) => e instanceof GeminiVisionError && e.code === 'EMPTY_IMAGE' && !e.retryable
      );
      assert.throws(
        () => validateScanImagePayload('data:image/jpeg;base64,short'),
        (e: unknown) => e instanceof GeminiVisionError && e.code === 'CORRUPT_OR_EMPTY_IMAGE'
      );
      assert.throws(
        () => validateScanImagePayload('data:image/jpeg;base64,***not_base64***' + 'A'.repeat(200)),
        (e: unknown) => e instanceof GeminiVisionError && e.code === 'INVALID_IMAGE_ENCODING'
      );
      assert.equal(apiCalled, false);
    });

    // 15. Unsupported MIME type
    await testCase('15. Unsupported MIME types (SVG, PDF) rejected cleanly pre-API', () => {
      assert.throws(
        () => validateScanImagePayload('data:image/svg+xml;base64,' + 'A'.repeat(200)),
        (e: unknown) =>
          e instanceof GeminiVisionError && e.code === 'UNSUPPORTED_MIME' && e.statusCode === 400
      );
      assert.throws(
        () => validateScanImagePayload('data:application/pdf;base64,' + 'A'.repeat(200)),
        (e: unknown) => e instanceof GeminiVisionError && e.code === 'UNSUPPORTED_MIME'
      );
    });

    // 16. Oversized image
    await testCase('16. Oversized image (>4.4MB base64) rejected with 413 IMAGE_TOO_LARGE', () => {
      const huge = 'data:image/jpeg;base64,' + 'A'.repeat(4_500_001);
      assert.throws(
        () => validateScanImagePayload(huge),
        (e: unknown) =>
          e instanceof GeminiVisionError && e.code === 'IMAGE_TOO_LARGE' && e.statusCode === 413
      );
    });

    // 17. Upload / Request body JSON failure on API route
    await testCase('17. Malformed upload JSON body returns 400 structured_scan_error', async () => {
      const req = new NextRequest('http://localhost/api/scan/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.17' },
        body: '{invalid-upload-json',
      });
      const res = await analyzeRoutePost(req);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'structured_scan_error');
      assert.equal(body.code, 'INVALID_REQUEST_JSON');
      assert.equal(body.retryable, false);
    });

    // 18. Database & localStorage quota failure resilience
    await testCase('18. saveScanRecord survives localStorage quota error cleanly without crashing', async () => {
      const origWindow = (globalThis as Record<string, unknown>).window;
      const origStorage = (globalThis as Record<string, unknown>).localStorage;

      let setCalls = 0;
      const mockStorage = {
        getItem: () => '[]',
        setItem: () => {
          setCalls++;
          if (setCalls <= 2) {
            const err = new Error('QuotaExceededError');
            err.name = 'QuotaExceededError';
            throw err;
          }
        },
        removeItem: () => {},
      };
      (globalThis as Record<string, unknown>).window = {};
      (globalThis as Record<string, unknown>).localStorage = mockStorage;

      try {
        const record = await saveScanRecord({
          crop: 'Potato',
          thumbnailDataUrl: 'data:image/jpeg;base64,abc',
          label: 'Healthy Tubers',
          confidence: 0.9,
          advice: {
            problem_name: { en: 'Healthy', ur: 'تندرست' },
            severity: 'low',
            summary: { en: 'Healthy', ur: 'تندرست' },
            steps: [{ en: 'Keep checking', ur: 'معائنہ جاری رکھیں' }],
            prevention: [{ en: 'Clean field', ur: 'کھیت صاف رکھیں' }],
            see_expert: false,
          },
        });
        assert.ok(record.id.startsWith('scan-'));
        assert.equal(record.cloudSynced, false);
        assert.equal(setCalls, 3, 'Gracefully fell back to stripped metadata write');
      } finally {
        (globalThis as Record<string, unknown>).window = origWindow;
        (globalThis as Record<string, unknown>).localStorage = origStorage;
      }
    });

    // 19. Offline inconclusive diagnosis differentiation
    await testCase('19. Offline preliminary assessments never pretend Gemini inspected the image', () => {
      const offline = buildOfflinePreliminaryAssessment('Wheat');
      assert.equal(CropDiagnosisSchema.safeParse(offline).success, true);
      assert.equal(offline.inspection_source, 'offline_assessment');
      assert.equal(offline.gemini_inspection_status, 'not_run');
      assert.equal(offline.identification_confidence, 0);
      assert.equal(offline.diagnosis_status, 'uncertain');
      assert.equal(offline.severity, 'not_assessed');

      const fallbackD = getFallbackCropDiagnosis('Wheat');
      assert.equal(fallbackD.inspection_source, 'offline_assessment');
      assert.equal(fallbackD.gemini_inspection_status, 'not_run');
      assert.equal(fallbackD.identification_confidence, 0);
    });

    // 20. Gemini unavailable (503 fallback succeeds) & permanent auth error (401 stops immediately)
    await testCase('20. Permanent 401 config error stops immediately; 503 cascades to fallback model', async () => {
      let authCalls = 0;
      globalThis.fetch = async () => {
        authCalls++;
        return new Response(JSON.stringify({ error: { message: 'API key invalid' } }), { status: 401 });
      };
      await assert.rejects(
        () => analyzeCropImageWithGemini(SAMPLE_IMAGE_B64, 'wheat'),
        (e: unknown) =>
          e instanceof GeminiVisionError &&
          e.errorCategory === 'permanent_config_error' &&
          e.code === 'INVALID_API_KEY' &&
          e.retryable === false
      );
      assert.equal(authCalls, 1, 'Permanent 401 must never retry across models');

      let cascadeCalls = 0;
      globalThis.fetch = async () => {
        cascadeCalls++;
        if (cascadeCalls === 1) {
          return new Response('Overloaded', { status: 503 });
        }
        return geminiHttpSuccess(JSON.stringify(makeValidGeminiPayload()));
      };
      const res = await analyzeCropImageWithGemini(SAMPLE_IMAGE_B64, 'potato');
      assert.equal(cascadeCalls, 2);
      assert.equal(res.detected_crop, 'Potato');
    });

    // 21. Controlled retry success (missing fields on attempt 1 -> fixed on attempt 2)
    await testCase('21. Controlled retry recovers automatically when attempt 1 omits required fields', async () => {
      let attempts = 0;
      globalThis.fetch = async () => {
        attempts++;
        if (attempts === 1) {
          const incomplete = makeValidGeminiPayload();
          delete (incomplete as Record<string, unknown>).problem_name;
          delete (incomplete as Record<string, unknown>).severity;
          delete (incomplete as Record<string, unknown>).requires_retake;
          delete (incomplete as Record<string, unknown>).requires_expert_review;
          delete (incomplete as Record<string, unknown>).message;
          return geminiHttpSuccess(JSON.stringify(incomplete));
        }
        return geminiHttpSuccess(JSON.stringify(makeValidGeminiPayload()));
      };

      const res = await analyzeCropImageWithGemini(SAMPLE_IMAGE_B64, 'potato');
      assert.equal(attempts, 2);
      assert.equal(res.problem_name.en, 'Suspected Potato Late Blight');
    });

    // 22. Retry exhaustion stops at limit (max 1 retry = 2 calls) and returns field_errors
    await testCase('22. Retry exhaustion enforces max 1 retry and surfaces structured Zod field_errors', async () => {
      let attempts = 0;
      globalThis.fetch = async () => {
        attempts++;
        const incomplete = makeValidGeminiPayload();
        delete (incomplete as Record<string, unknown>).problem_name;
        delete (incomplete as Record<string, unknown>).severity;
        delete (incomplete as Record<string, unknown>).requires_retake;
        delete (incomplete as Record<string, unknown>).requires_expert_review;
        delete (incomplete as Record<string, unknown>).message;
        return geminiHttpSuccess(JSON.stringify(incomplete));
      };

      await assert.rejects(
        () => analyzeCropImageWithGemini(SAMPLE_IMAGE_B64, 'potato'),
        (e: unknown) => {
          assert.ok(e instanceof GeminiVisionError);
          assert.equal(e.errorCategory, 'schema_validation_failed');
          assert.equal(e.code, 'ZOD_VALIDATION_FAILED');
          assert.ok(Array.isArray(e.fieldErrors));
          const paths = e.fieldErrors!.map((f) => f.path);
          assert.ok(paths.includes('problem_name'));
          assert.ok(paths.includes('severity'));
          assert.ok(paths.includes('requires_retake'));
          assert.ok(paths.includes('requires_expert_review'));
          assert.ok(paths.includes('message'));
          return true;
        }
      );
      assert.equal(attempts, 2, 'Must stop strictly after 1 controlled retry (2 attempts total)');
    });

    // 23. Duplicate scan guard, alias normalization, & mismatch safe defaults check
    await testCase('23. Normalizer maps wrappers/aliases safely and scan UI enforces duplicate guard', () => {
      // Wrapper + plant_name + severity_name aliases
      const wrappedAlias = {
        diagnosis: makeValidGeminiPayload({
          plant_name: { en: 'Tomato', ur: 'ٹماٹر' },
          plant_part: { en: 'Leaf', ur: 'پتا' },
          diagnosis_name: { en: 'Early Blight', ur: 'اگیتا جھلساؤ' },
        }),
      };
      delete (wrappedAlias.diagnosis as Record<string, unknown>).problem_name;
      delete (wrappedAlias.diagnosis as Record<string, unknown>).detected_crop;
      delete (wrappedAlias.diagnosis as Record<string, unknown>).detected_plant_part;

      const norm = normalizeAndValidateDiagnosis(wrappedAlias, { selectedCrop: 'tomato' });
      assert.equal(norm.ok, true);
      if (norm.ok) {
        assert.equal(norm.data.detected_crop, 'Tomato');
        assert.equal(norm.data.problem_name.en, 'Early Blight');
      }

      // Check deterministic mismatch handling
      const mismatchMinimal = {
        image_valid: true,
        detected_crop: 'Potato',
        detected_crop_ur: 'آلو',
        detected_plant_part: 'Tuber',
        detected_plant_part_ur: 'آلو',
        diagnosis_status: 'crop_mismatch',
      };
      const mismatchNorm = normalizeAndValidateDiagnosis(mismatchMinimal, { selectedCrop: 'wheat' });
      assert.equal(mismatchNorm.ok, true);
      if (mismatchNorm.ok) {
        assert.equal(mismatchNorm.data.diagnosis_status, 'crop_mismatch');
        assert.equal(mismatchNorm.data.severity, 'not_assessed');
        assert.equal(mismatchNorm.data.crop_match, false);
      }

      const scanUiSource = fs.readFileSync(
        path.resolve('app/[locale]/scan/page.tsx'),
        'utf8'
      );
      assert.ok(scanUiSource.includes('scanInFlightRef.current'), 'Duplicate scan ref guard must be present');
    });

    // 24. Mobile rendering & UI safety contracts
    await testCase('24. Scan UI safely prevents raw technical dump exposure and guards bottom spacing', () => {
      const scanUiSource = fs.readFileSync(
        path.resolve('app/[locale]/scan/page.tsx'),
        'utf8'
      );
      assert.ok(scanUiSource.includes('showDevDiagnostics'), 'Diagnostics panel must be collapsible');
      assert.ok(!scanUiSource.includes('{diagnosis.message[locale]}'), 'Unsafe direct indexing removed');
      assert.ok(!scanUiSource.includes('{diagnosis.problem_name[locale]}'), 'Unsafe direct indexing removed');
      assert.ok(scanUiSource.includes('overflow-y-auto'), 'Diagnostics box constrained cleanly for mobile');
    });

    // 25. Urdu diagnosis localization safety
    await testCase('25. getLocalizedText safely handles ur, roman_ur, sd, en, and nullish values', () => {
      const loc = {
        en: 'Potato Tubers',
        ur: 'آلو کی فصل',
        roman_ur: 'Aloo ki fasal',
        sd: 'آلو جو فصل',
      };
      assert.equal(getLocalizedText(loc, 'ur'), 'آلو کی فصل');
      assert.equal(getLocalizedText(loc, 'roman_ur'), 'Aloo ki fasal');
      assert.equal(getLocalizedText(loc, 'sd'), 'آلو جو فصل');
      assert.equal(getLocalizedText(loc, 'en'), 'Potato Tubers');
      assert.equal(getLocalizedText(undefined, 'ur', 'Fallback'), 'Fallback');
    });

    // 26. Voice summary failure handling
    await testCase('26. Voice summary failure invokes onError cleanly without throwing', () => {
      const origWindow = (globalThis as Record<string, unknown>).window;
      let errored = false;
      (globalThis as Record<string, unknown>).window = {}; // speechSynthesis missing, Audio missing
      try {
        speakText('ٹیسٹ آواز', 'ur', {
          onError: () => {
            errored = true;
          },
        });
        assert.equal(errored, true, 'Missing browser speech must trigger onError safely');
      } finally {
        (globalThis as Record<string, unknown>).window = origWindow;
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }

  console.log(`\n🛡️ Scanner Reliability Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();

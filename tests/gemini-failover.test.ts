/**
 * Mandatory 12-Scenario Failure Simulation & Integration Test Suite
 * for the Zarkhez 5-Account Gemini API Failover System.
 */
import assert from 'node:assert/strict';
import {
  clearGeminiPoolStateForTests,
  executeGeminiWithFailover,
  getGeminiPoolHealthSnapshot,
  hasAnyConfiguredGeminiAccount,
  loadConfiguredGeminiAccounts,
  selectEligibleGeminiAccounts,
  setIgnoreEnvFileForTests,
  setPoolNowProviderForTests,
} from '../lib/server/gemini-pool';
import {
  analyzeCropImageWithGemini,
  generateCropAdvice,
  getGeminiApiKey,
  streamGeminiChatResponse,
  verifyLeafImageWithVision,
  GeminiVisionError,
} from '../lib/gemini';
import { getInternalDiagnosticsSnapshot } from '../lib/server/diagnostics-store';
import { synthesizeVoiceSpeech } from '../lib/voice/service';
import { transcribeFarmAudio } from '../lib/voice/stt';
import { redactSecrets } from '../lib/error-sanitizer';

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_PROJECT_ID',
  'GEMINI_API_KEY_1',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
  'GEMINI_PROJECT_ID_1',
  'GEMINI_PROJECT_ID_2',
  'GEMINI_PROJECT_ID_3',
  'GEMINI_PROJECT_ID_4',
  'GEMINI_PROJECT_ID_5',
  'GEMINI_ENABLED_1',
  'GEMINI_ENABLED_2',
  'GEMINI_ENABLED_3',
  'GEMINI_ENABLED_4',
  'GEMINI_ENABLED_5',
] as const;

const TEST_KEYS = [
  'AIzaSyTestAcct1Key_00000000000001',
  'AIzaSyTestAcct2Key_00000000000002',
  'AIzaSyTestAcct3Key_00000000000003',
  'AIzaSyTestAcct4Key_00000000000004',
  'AIzaSyTestAcct5Key_00000000000005',
];

function resetEnvAndPool(config: 'five_independent' | 'empty' = 'five_independent'): void {
  clearGeminiPoolStateForTests();
  setIgnoreEnvFileForTests(true);
  setPoolNowProviderForTests(null);

  for (const k of ENV_KEYS) {
    delete process.env[k];
  }

  if (config === 'five_independent') {
    for (let i = 1; i <= 5; i++) {
      process.env[`GEMINI_API_KEY_${i}`] = TEST_KEYS[i - 1];
      process.env[`GEMINI_PROJECT_ID_${i}`] = `zarkhez-proj-${i}`;
      process.env[`GEMINI_ENABLED_${i}`] = 'true';
    }
  }
}

function getSlotFromUrl(url: string): number {
  const m = /[?&]key=([^&]+)/.exec(url);
  if (!m) return -1;
  const decoded = decodeURIComponent(m[1]);
  const idx = TEST_KEYS.indexOf(decoded);
  return idx >= 0 ? idx + 1 : -1;
}

function makeGeminiOkResponse(textPayload: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: textPayload }] }, finishReason: 'STOP' }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function makeErrorResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, { status, headers });
}

const VALID_DIAGNOSIS_JSON = JSON.stringify({
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
});

const SAMPLE_LEAF_BASE64 = 'data:image/jpeg;base64,' + 'A'.repeat(256);

async function runTests() {
  const originalFetch = globalThis.fetch;
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

  let passed = 0;

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Account 1 authentication failure -> Account 2
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      const calledSlots: number[] = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        calledSlots.push(slot);
        if (slot === 1) {
          return makeErrorResponse(401, JSON.stringify({ error: { message: `API key ${TEST_KEYS[0]} invalid` } }));
        }
        return makeGeminiOkResponse('{"ok":true}');
      };

      const res = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });

      assert.equal(res.ok, true, 'Scenario 1 should succeed via Account 2');
      if (res.ok) {
        assert.equal(res.slotUsed, 2);
        assert.equal(res.failoverSteps, 1);
      }
      assert.deepEqual(calledSlots, [1, 2]);
      const snap = getGeminiPoolHealthSnapshot();
      assert.equal(snap.slots[0].status, 'auth_failed');
      assert.equal(snap.slots[1].status, 'active');

      // Also verify legacy GEMINI_API_KEY as Account 1 alongside GEMINI_API_KEY_2..5
      resetEnvAndPool('empty');
      process.env.GEMINI_API_KEY = TEST_KEYS[0];
      process.env.GEMINI_PROJECT_ID_1 = 'zarkhez-proj-1';
      process.env.GEMINI_API_KEY_2 = TEST_KEYS[1];
      process.env.GEMINI_PROJECT_ID_2 = 'zarkhez-proj-2';
      const hybridSlots: number[] = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        hybridSlots.push(slot);
        if (slot === 1) return makeErrorResponse(503, 'Busy');
        return makeGeminiOkResponse('{"hybrid":true}');
      };
      const hybridRes = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });
      assert.equal(hybridRes.ok, true);
      if (hybridRes.ok) assert.equal(hybridRes.slotUsed, 2);
      assert.deepEqual(hybridSlots, [1, 2]);

      passed++;
      console.log('✓ Scenario 1 passed: Account 1 auth failure -> immediate failover to Account 2');
    }

    // -------------------------------------------------------------------------
    // Scenario 2: Account 1 temporary service failure (503) -> Account 2
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      const calledSlots: number[] = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        calledSlots.push(slot);
        if (slot === 1) {
          return makeErrorResponse(503, 'Service temporarily overloaded');
        }
        return makeGeminiOkResponse('{"ok":true}');
      };

      const res = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });

      assert.equal(res.ok, true);
      if (res.ok) assert.equal(res.slotUsed, 2);
      assert.deepEqual(calledSlots, [1, 2]);
      assert.equal(getGeminiPoolHealthSnapshot().slots[0].status, 'unavailable');
      passed++;
      console.log('✓ Scenario 2 passed: Account 1 503 service failure -> immediate failover to Account 2');
    }

    // -------------------------------------------------------------------------
    // Scenario 3: Account 2 unavailable -> Account 3 (after Account 1 already down)
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      const calledSlots: number[] = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        calledSlots.push(slot);
        if (slot <= 2) return makeErrorResponse(503, 'Upstream busy');
        return makeGeminiOkResponse('{"slot":3}');
      };

      const res = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });

      assert.equal(res.ok, true);
      if (res.ok) assert.equal(res.slotUsed, 3);
      assert.deepEqual(calledSlots, [1, 2, 3]);
      passed++;
      console.log('✓ Scenario 3 passed: Account 2 unavailable -> Account 3');
    }

    // -------------------------------------------------------------------------
    // Scenario 4: Account 3 unavailable -> Account 4
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      const calledSlots: number[] = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        calledSlots.push(slot);
        if (slot <= 3) return makeErrorResponse(503, 'Upstream busy');
        return makeGeminiOkResponse('{"slot":4}');
      };

      const res = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });

      assert.equal(res.ok, true);
      if (res.ok) assert.equal(res.slotUsed, 4);
      assert.deepEqual(calledSlots, [1, 2, 3, 4]);
      passed++;
      console.log('✓ Scenario 4 passed: Account 3 unavailable -> Account 4');
    }

    // -------------------------------------------------------------------------
    // Scenario 5: Account 4 unavailable -> Account 5
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      const calledSlots: number[] = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        calledSlots.push(slot);
        if (slot <= 4) return makeErrorResponse(503, 'Upstream busy');
        return makeGeminiOkResponse('{"slot":5}');
      };

      const res = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });

      assert.equal(res.ok, true);
      if (res.ok) assert.equal(res.slotUsed, 5);
      assert.deepEqual(calledSlots, [1, 2, 3, 4, 5]);
      passed++;
      console.log('✓ Scenario 5 passed: Account 4 unavailable -> Account 5');
    }

    // -------------------------------------------------------------------------
    // Scenario 6: Account 1 recovers -> becomes 'recovering' -> 'active' & eligible
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      let nowMs = 1_700_000_000_000;
      setPoolNowProviderForTests(() => nowMs);

      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        if (slot === 1 && nowMs < 1_700_000_030_000) {
          return makeErrorResponse(503, 'Temporary outage');
        }
        return makeGeminiOkResponse('{"ok":true}');
      };

      // Step A: Account 1 fails -> Account 2 serves
      const r1 = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });
      assert.equal(r1.ok, true);
      if (r1.ok) assert.equal(r1.slotUsed, 2);

      // Before cooldown ends (10s elapsed < 25s backoff), Account 1 is unavailable
      nowMs += 10_000;
      assert.equal(getGeminiPoolHealthSnapshot().slots[0].status, 'unavailable');

      // Advance past cooldown (35s total) -> Account 1 transitions automatically to recovering
      nowMs += 25_000;
      assert.equal(getGeminiPoolHealthSnapshot().slots[0].status, 'recovering');

      // Next request routes back to recovered Account 1 and restores it to active!
      const r2 = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });
      assert.equal(r2.ok, true);
      if (r2.ok) assert.equal(r2.slotUsed, 1);
      assert.equal(getGeminiPoolHealthSnapshot().slots[0].status, 'active');
      passed++;
      console.log('✓ Scenario 6 passed: Account 1 recovers cleanly from cooldown to recovering -> active');
    }

    // -------------------------------------------------------------------------
    // Scenario 7: Two keys on the same project -> shared quota tracking
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      // Point Account 1 AND Account 2 to the SAME Google Cloud Project ID
      process.env.GEMINI_PROJECT_ID_1 = 'shared-gcp-project-alpha';
      process.env.GEMINI_PROJECT_ID_2 = 'shared-gcp-project-alpha';
      process.env.GEMINI_PROJECT_ID_3 = 'independent-gcp-project-beta';

      const calledSlots: number[] = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        calledSlots.push(slot);
        if (slot === 1 || slot === 2) {
          return makeErrorResponse(429, 'Rate limit exceeded per minute', { 'retry-after': '20' });
        }
        return makeGeminiOkResponse('{"ok":true}');
      };

      const res = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });

      assert.equal(res.ok, true);
      if (res.ok) assert.equal(res.slotUsed, 3, 'Must skip Account 2 sharing same project as rate-limited Account 1');
      // Critical assertion: Account 2 must NOT have been called!
      assert.deepEqual(calledSlots, [1, 3]);

      const snap = getGeminiPoolHealthSnapshot();
      const sharedAlpha = snap.sharedProjects.find((p) => p.projectId === 'shared-gcp-project-alpha');
      assert.ok(sharedAlpha);
      assert.deepEqual(sharedAlpha.slotsSharing, [1, 2]);
      assert.equal(sharedAlpha.status, 'rate_limited');
      assert.equal(snap.slots[0].status, 'rate_limited');
      assert.equal(snap.slots[1].status, 'rate_limited');
      passed++;
      console.log('✓ Scenario 7 passed: Two keys on same project share health & quota state without redundant calls');
    }

    // -------------------------------------------------------------------------
    // Scenario 8: One project hits RPM limit -> Retry-After cooldown & permitted failover
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      let nowMs = 1_700_000_000_000;
      setPoolNowProviderForTests(() => nowMs);

      const secondRequestSlots: number[] = [];
      let phase = 1;
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        if (phase === 2) secondRequestSlots.push(slot);
        if (slot === 1) {
          return makeErrorResponse(
            429,
            "Quota exceeded for quota metric 'Generate Content API requests per minute'",
            { 'retry-after': '45' }
          );
        }
        return makeGeminiOkResponse('{"ok":true}');
      };

      const res1 = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });
      assert.equal(res1.ok, true);
      if (res1.ok) assert.equal(res1.slotUsed, 2);

      const snap = getGeminiPoolHealthSnapshot();
      assert.equal(snap.slots[0].status, 'rate_limited');
      assert.equal(snap.slots[0].quotaKind, 'rpm_tpm_temporary');
      assert.equal(snap.slots[0].cooldownRemainingMs, 45_000);

      // 30s later: Retry-After (45s) has NOT expired yet -> skips Account 1 directly to Account 2
      nowMs += 30_000;
      phase = 2;
      const res2 = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });
      assert.equal(res2.ok, true);
      assert.deepEqual(secondRequestSlots, [2]);

      // After 46s total: Retry-After expired -> Account 1 eligible in recovering state
      nowMs += 16_000;
      const elig = selectEligibleGeminiAccounts();
      assert.ok(elig.eligible.some((a) => a.slot === 1));
      passed++;
      console.log('✓ Scenario 8 passed: RPM 429 respects Retry-After cooldown & permits independent-project failover');
    }

    // -------------------------------------------------------------------------
    // Scenario 9: One project exhausts daily quota -> NO quota evasion!
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      const calledSlots: number[] = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        calledSlots.push(slot);
        if (slot === 1) {
          return makeErrorResponse(
            429,
            "Quota exceeded for quota metric 'Generate Content API requests per day' — you exceeded your current quota, please check your plan and billing details."
          );
        }
        return makeGeminiOkResponse('{"should_never_happen":true}');
      };

      const res1 = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });

      assert.equal(res1.ok, false);
      if (!res1.ok) {
        assert.equal(res1.category, 'quota_exhausted');
        assert.equal(res1.code, 'QUOTA_EXHAUSTED');
        assert.deepEqual(res1.slotsTried, [1]);
      }
      assert.deepEqual(calledSlots, [1], 'Must NEVER rotate across Accounts 2..5 to evade daily quota');

      // Subsequent request must ALSO halt cleanly without rotating to Account 2..5
      const res2 = await executeGeminiWithFailover({
        models: ['gemini-3.5-flash-lite'],
        buildRequestBody: () => ({ contents: [] }),
      });
      assert.equal(res2.ok, false);
      if (!res2.ok) assert.equal(res2.category, 'quota_exhausted');
      assert.deepEqual(calledSlots, [1], 'Subsequent request must not evade daily quota via other accounts');
      passed++;
      console.log('✓ Scenario 9 passed: Exhausted daily RPD/billing limit stops cleanly with zero quota evasion');
    }

    // -------------------------------------------------------------------------
    // Scenario 10: All five configurations unavailable -> controlled error
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      let totalCalls = 0;
      globalThis.fetch = async () => {
        totalCalls++;
        return makeErrorResponse(503, 'All upstream Google clusters unavailable');
      };

      await assert.rejects(
        () => analyzeCropImageWithGemini(SAMPLE_LEAF_BASE64, 'Wheat'),
        (err: unknown) => {
          assert.ok(err instanceof GeminiVisionError);
          assert.equal(err.errorCategory, 'temporary_service_failure');
          assert.equal(err.retryable, true);
          assert.ok(!err.message.includes('AIza'), 'Never leak API key in controlled error');
          return true;
        }
      );

      // Should try each configured account cleanly without infinite loops
      assert.ok(totalCalls >= 5 && totalCalls <= 10, `Expected controlled finite attempts across 5 accounts, got ${totalCalls}`);
      passed++;
      console.log(`✓ Scenario 10 passed: All 5 accounts unavailable -> controlled error after ${totalCalls} bounded attempts`);
    }

    // -------------------------------------------------------------------------
    // Scenario 11: Missing credentials -> app continues without crashing
    // -------------------------------------------------------------------------
    resetEnvAndPool('empty');
    {
      // Also test disabled / placeholder credentials are ignored safely
      process.env.GEMINI_API_KEY_1 = 'your_placeholder_key_here';
      process.env.GEMINI_API_KEY_2 = 'AIzaSyDisabledButValidFormat000002';
      process.env.GEMINI_ENABLED_2 = 'false';

      assert.equal(loadConfiguredGeminiAccounts().filter((a) => a.enabled).length, 0);
      assert.equal(hasAnyConfiguredGeminiAccount(), false);
      assert.equal(getGeminiApiKey(), undefined);

      // Advice gracefully falls back to Pakistani offline agronomy KB
      const adviceRes = await generateCropAdvice('Wheat Rust', 0.85, 'Wheat');
      assert.equal(adviceRes.source, 'fallback');
      assert.ok(adviceRes.advice.problem_name.ur.length > 0);

      // Chat gracefully returns offline advisor message without throwing
      const chatRes = await streamGeminiChatResponse(
        [{ role: 'user', content: 'گندم کے لیے کھاد کا شیڈول بتائیں' }],
        { district: 'Multan', crop: 'Wheat' },
        'ur'
      );
      assert.ok(chatRes.length > 10);

      // Image scan fails cleanly with structured config error
      await assert.rejects(
        () => analyzeCropImageWithGemini(SAMPLE_LEAF_BASE64, 'Wheat'),
        (err: unknown) => {
          assert.ok(err instanceof GeminiVisionError);
          assert.equal(err.code, 'MISSING_API_KEY');
          return true;
        }
      );
      passed++;
      console.log('✓ Scenario 11 passed: Missing/disabled credentials degrade gracefully without crashing');
    }

    // -------------------------------------------------------------------------
    // Scenario 12: Existing Zarkhez AI features work through failover + zero secret leaks
    // -------------------------------------------------------------------------
    resetEnvAndPool('five_independent');
    {
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        // Account 1 fails auth, Account 2 hits 503 -> Account 3 succeeds for every AI feature!
        if (slot === 1) return makeErrorResponse(403, `Forbidden key ${TEST_KEYS[0]}`);
        if (slot === 2) return makeErrorResponse(503, 'Temporary overload');
        return makeGeminiOkResponse(VALID_DIAGNOSIS_JSON);
      };

      // 12a. Crop Scan (fails over Account 1 -> 2 -> 3)
      const diag = await analyzeCropImageWithGemini(SAMPLE_LEAF_BASE64, 'potato');
      assert.equal(diag.problem_name.en, 'Suspected Potato Late Blight');
      assert.equal(diag.plant_name?.en, 'Potato');

      // 12b. Leaf Pre-Verification
      globalThis.fetch = async () =>
        makeGeminiOkResponse(
          JSON.stringify({
            is_clear_leaf: true,
            agrees_with_model: true,
            suggested_label: 'Wheat Leaf Rust',
            visible_symptoms: {
              en: 'Orange-brown pustules visible on foliage.',
              ur: 'پتوں پر زنگ نما دھبے واضح ہیں۔',
            },
            recommendation: {
              en: 'Inspect surrounding tillers and consult agriculture officer.',
              ur: 'قریبی پودوں کا معائنہ کریں اور زرعی افسر سے مشورہ کریں۔',
            },
          })
        );
      const verifyRes = await verifyLeafImageWithVision(SAMPLE_LEAF_BASE64, 'Wheat', 'Wheat Leaf Rust');
      assert.equal(verifyRes.is_clear_leaf, true);
      assert.equal(verifyRes.agrees_with_model, true);

      // 12c. Crop Advice (uses response from Account 3)
      globalThis.fetch = async () =>
        makeGeminiOkResponse(
          JSON.stringify({
            problem_name: { en: 'Leaf Rust', ur: 'کنگی' },
            severity: 'medium',
            summary: { en: 'Treat early with triazole.', ur: 'بروقت علاج کریں۔' },
            steps: [{ en: 'Inspect leaves daily.', ur: 'روزانہ پتے چیک کریں۔' }],
            prevention: [{ en: 'Use resistant seed.', ur: 'مزاحم بیج استعمال کریں۔' }],
            see_expert: false,
            expert_reason: {
              en: 'No urgent lab escalation needed yet.',
              ur: 'ابھی فوری لیب ٹیسٹ کی ضرورت نہیں ہے۔',
            },
          })
        );
      const advice = await generateCropAdvice('Whitefly', 0.88, 'Cotton');
      assert.equal(advice.source, 'ai');

      // 12d. Chat Response
      globalThis.fetch = async () =>
        makeGeminiOkResponse('گندم میں نائٹروجن پہلے اور دوسرے پانی پر دیں۔');
      const reply = await streamGeminiChatResponse(
        [{ role: 'user', content: 'گندم کھاد؟' }],
        { district: 'Multan', crop: 'Wheat' },
        'ur'
      );
      assert.ok(reply.includes('گندم'));

      // 12e. Gemini TTS Voice Synthesis via Account 3 failover
      resetEnvAndPool('five_independent');
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        if (slot < 3) return makeErrorResponse(503, 'TTS busy');
        const pcmBase64 = Buffer.from(new Uint8Array(64)).toString('base64');
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcmBase64 } }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };
      const voiceRes = await synthesizeVoiceSpeech({
        text: 'گندم کی فصل کی دیکھ بھال کریں',
        lang: 'ur',
        preferProvider: 'gemini-tts',
        skipCache: true,
      });
      assert.ok(voiceRes.audioBuffer.length > 44);
      assert.equal(voiceRes.provider, 'gemini-tts');

      // 12f. Gemini STT Transcription via Account 4 failover
      resetEnvAndPool('five_independent');
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        if (slot < 4) return makeErrorResponse(429, 'RPM limit');
        return makeGeminiOkResponse('میری گندم کے پتے پیلے ہو رہے ہیں');
      };
      const sttRes = await transcribeFarmAudio({
        audioBase64: Buffer.from('fake-webm-audio').toString('base64'),
        mimeType: 'audio/webm',
        lang: 'ur',
      });
      assert.equal(sttRes.provider, 'gemini-audio-stt');
      assert.ok(sttRes.transcript.includes('گندم'));

      // 12g. Diagnostics Snapshot & Secret Redaction Check (ZERO leaked keys)
      const diagSnap = getInternalDiagnosticsSnapshot();
      const serialized = JSON.stringify(diagSnap);
      for (const secret of TEST_KEYS) {
        assert.ok(!serialized.includes(secret), 'Diagnostics snapshot must NEVER expose raw API keys');
      }
      assert.equal(diagSnap.geminiPool.enabledCount, 5);
      assert.ok(diagSnap.geminiPool.slots.every((s) => s.maskedKey.startsWith('••••')));
      assert.equal(
        redactSecrets(`Error GEMINI_API_KEY_4=${TEST_KEYS[3]}`).includes('AIza'),
        false
      );

      passed++;
      console.log('✓ Scenario 12 passed: All Zarkhez AI features operate seamlessly with zero secret exposure');
    }

    console.log(`\nALL ${passed}/12 MANDATORY GEMINI FAILOVER SIMULATIONS PASSED`);
  } finally {
    globalThis.fetch = originalFetch;
    clearGeminiPoolStateForTests();
    setIgnoreEnvFileForTests(false);
    setPoolNowProviderForTests(null);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  }
}

runTests().catch((err) => {
  console.error('Gemini failover test suite failed:', err);
  process.exit(1);
});

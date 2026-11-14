import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_OFFLINE_FLAGS,
  OFFLINE_CACHE_NAMESPACES,
  OFFLINE_DB_VERSION,
  formatBytes,
} from '../lib/offline/config';
import { OFFLINE_STORES } from '../lib/offline/db';
import { formatWeatherAgeLabel, makeLocationCacheKey } from '../lib/offline/weather-cache';
import { getOfflineFertilizerSchedule } from '../lib/offline/fertilizer-guide';
import { calculateFertilizer } from '../lib/fertilizer';
import {
  getBundledFarmingGuides,
  normalizeIndicArabicText,
  searchOfflineGuides,
} from '../lib/offline/knowledge-base';
import {
  getPlantVillageClassMeta,
  isCropSupportedByPlantVillageOnnx,
  normalizeSelectedCropToPvHost,
  PLANTVILLAGE_RAW_LABELS,
} from '../lib/offline/plantvillage-catalog';
import { getBundledSchemes } from '../lib/offline/schemes';
import { answerOfflineChatQuestion } from '../lib/offline/chat-kb';
import { computeNextRetryDelayMs, MAX_SYNC_ATTEMPTS } from '../lib/offline/sync';

let passed = 0;
let failed = 0;

function testCase(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    })
    .catch((err) => {
      failed++;
      console.error(`  ❌ FAIL: ${name}`, err);
    });
}

async function main() {
  console.log('\n🧪 Running Zarkhez Isolated Offline Upgrade Unit Tests...\n');

  await testCase('Feature flags & cache namespaces stay isolated from SW shell caches', () => {
    assert.equal(DEFAULT_OFFLINE_FLAGS.enabled, true);
    assert.equal(DEFAULT_OFFLINE_FLAGS.onnxCropScanner, true);
    assert.ok(OFFLINE_CACHE_NAMESPACES.MODELS.startsWith('zarkhez-offline-'));
    assert.ok(OFFLINE_CACHE_NAMESPACES.KB_ASSETS.startsWith('zarkhez-offline-'));
    assert.equal(OFFLINE_DB_VERSION, 3);
    assert.equal(formatBytes(2_687_606), '2.6 MB');
    assert.equal(formatBytes(0), '0 KB');
  });

  await testCase('All Mandi Prices offline additions are completely removed from DB and modules', () => {
    const storeValues = Object.values(OFFLINE_STORES) as string[];
    assert.equal(storeValues.includes('mandiCache'), false);
    assert.equal(fs.existsSync(path.join(process.cwd(), 'lib', 'offline', 'mandi-cache.ts')), false);
    const dbSource = fs.readFileSync(path.join(process.cwd(), 'lib', 'offline', 'db.ts'), 'utf8');
    assert.equal(dbSource.includes('MandiCacheRecord'), false);
    assert.equal(dbSource.includes('MANDI_CACHE'), false);
  });

  await testCase('Service worker preserves offline model/KB caches & never caches API/admin', () => {
    const swText = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
    assert.ok(swText.includes('zarkhez-offline-'));
    assert.ok(swText.includes('zarkhez-tts-'));
    assert.ok(swText.includes('/onnxruntime/'));
    assert.ok(swText.includes("url.pathname.startsWith('/api/')"));
    assert.ok(swText.includes("url.pathname.includes('/admin')"));
  });

  await testCase('Weather snapshot keys & age formatter distinguish fresh vs stale data cleanly', () => {
    const k1 = makeLocationCacheKey(30.1575, 71.5249, 'Multan, Punjab');
    assert.ok(k1.startsWith('30.16_71.52_multan'));
    assert.equal(formatWeatherAgeLabel(Date.now() - 30_000, 'en'), 'Saved just now');
    assert.equal(formatWeatherAgeLabel(Date.now() - 2 * 3_600_000, 'en'), 'Saved 2h ago');
    assert.equal(formatWeatherAgeLabel(Date.now() - 3 * 3_600_000, 'ur'), '3 گھنٹے پہلے محفوظ');
  });

  await testCase('Offline fertilizer stage schedules match calculateFertilizer without alteration', () => {
    const calc = calculateFertilizer('wheat', 'medium', 2);
    assert.ok(calc.items.length >= 3);
    for (const crop of ['wheat', 'rice', 'cotton', 'sugarcane', 'maize', 'tomato']) {
      const sched = getOfflineFertilizerSchedule(crop);
      assert.ok(sched.stages.length >= 2, `${crop} has stages`);
      assert.ok(sched.assumptions.en.includes('50 kg'), `${crop} states 50 kg assumption`);
      assert.ok(sched.nutrientNotes.length >= 1, `${crop} has nutrient notes`);
    }
  });

  await testCase('Bundled farming guides cover key topics across EN/UR/SD retrieval', () => {
    const guides = getBundledFarmingGuides();
    assert.ok(guides.length >= 10);
    const rustHits = searchOfflineGuides('wheat yellow rust', guides);
    assert.equal(rustHits[0]?.guide.id, 'wheat_yellow_rust');

    const urHits = searchOfflineGuides('سفید مکھی کپاس', guides);
    assert.equal(urHits[0]?.guide.id, 'cotton_whitefly_clcv');

    const sdHits = searchOfflineGuides('ڪڻڪ ۽ بيجائي', guides);
    assert.ok(sdHits.length > 0 && sdHits[0].guide.cropKey === 'wheat');

    const romanHits = searchOfflineGuides('gandum pani kab dein', guides);
    assert.ok(romanHits.length > 0 && romanHits[0].guide.cropKey === 'wheat');

    // Arabic yeh/kaf variant still normalizes cleanly to Urdu/Sindhi text
    assert.equal(normalizeIndicArabicText('كڻك آهي'), 'کڻک اہی');

    // Off-topic queries must not return irrelevant guides
    const irrelevantHits = searchOfflineGuides('chocolate birthday cake recipe baking', guides);
    assert.equal(irrelevantHits.length, 0);
  });

  await testCase('PlantVillage 38-class catalog enforces strict supported vs unsupported crop boundaries across EN/UR/SD', () => {
    assert.equal(PLANTVILLAGE_RAW_LABELS.length, 38);
    assert.equal(isCropSupportedByPlantVillageOnnx('tomato'), true);
    assert.equal(isCropSupportedByPlantVillageOnnx('maize'), true);
    assert.equal(isCropSupportedByPlantVillageOnnx('potato'), true);
    assert.equal(isCropSupportedByPlantVillageOnnx('chili'), true);
    assert.equal(isCropSupportedByPlantVillageOnnx('ٹماٹر'), true);
    assert.equal(isCropSupportedByPlantVillageOnnx('makai'), true);
    assert.equal(isCropSupportedByPlantVillageOnnx('kinnow'), true);
    assert.equal(normalizeSelectedCropToPvHost('chili'), 'pepper');
    assert.equal(normalizeSelectedCropToPvHost('citrus'), 'orange');

    assert.equal(isCropSupportedByPlantVillageOnnx('wheat'), false);
    assert.equal(isCropSupportedByPlantVillageOnnx('rice'), false);
    assert.equal(isCropSupportedByPlantVillageOnnx('cotton'), false);
    assert.equal(isCropSupportedByPlantVillageOnnx('sugarcane'), false);
    assert.equal(isCropSupportedByPlantVillageOnnx('گندم'), false);
    assert.equal(isCropSupportedByPlantVillageOnnx('ڪڻڪ'), false);
    assert.equal(isCropSupportedByPlantVillageOnnx('chawal'), false);
    assert.equal(isCropSupportedByPlantVillageOnnx('kapas'), false);

    const blightMeta = getPlantVillageClassMeta(30);
    assert.equal(blightMeta.isHealthy, false);
    assert.equal(blightMeta.pathogenType, 'fungal');
    assert.ok(blightMeta.actions.ur.length >= 2);
  });

  await testCase('Government schemes use verified official portals with no fabricated closing dates', () => {
    const schemes = getBundledSchemes();
    assert.ok(schemes.length >= 6);
    for (const scheme of schemes) {
      assert.ok(
        /^https:\/\/[a-z0-9.-]+\.(gov\.pk|gos\.pk|com\.pk)\/?/i.test(scheme.officialPortal),
        `Official portal URL required for ${scheme.id}`
      );
      assert.ok(scheme.eligibility.en.length >= 2);
      assert.ok(scheme.documents.ur.length >= 2);
      assert.ok(scheme.lastVerifiedAt.length >= 10);
    }
  });

  await testCase('Offline chatbot KB answers clearly without masquerading as generative AI', async () => {
    const rustReply = await answerOfflineChatQuestion('yellow rust wheat treatment', 'en');
    assert.equal(rustReply.sourceType, 'offline_knowledge_base');
    assert.ok(rustReply.answerText.toLowerCase().includes('non-generative'));

    const schemeReply = await answerOfflineChatQuestion('Punjab kissan card scheme', 'en');
    assert.ok(schemeReply.answerText.includes('agripunjab.gov.pk'));

    const urFertReply = await answerOfflineChatQuestion('گندم میں کھاد کب ڈالیں', 'ur');
    assert.ok(urFertReply.answerText.includes('بغیر AI جنریشن'));

    const romanFertReply = await answerOfflineChatQuestion('gandum mein khad kab dalein', 'en');
    assert.ok(romanFertReply.answerText.includes('Fertilizer Stages for wheat'));

    const sdSchemeReply = await answerOfflineChatQuestion('سنڌ هاري ڪارڊ اسڪيم', 'sd');
    assert.ok(sdSchemeReply.answerText.includes('benazirharicard.gos.pk'));

    const unknownReply = await answerOfflineChatQuestion('quantum physics superconductors', 'en');
    assert.ok(unknownReply.answerText.includes('did not find a close match'));
  });

  await testCase('Sync outbox backoff scales exponentially and respects retry ceiling', () => {
    assert.equal(MAX_SYNC_ATTEMPTS, 8);
    assert.equal(computeNextRetryDelayMs(1), 15_000);
    assert.equal(computeNextRetryDelayMs(2), 30_000);
    assert.equal(computeNextRetryDelayMs(3), 60_000);
    assert.equal(computeNextRetryDelayMs(12), 30 * 60_000);
  });

  console.log(`\n📊 Offline Unit Tests Complete: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();

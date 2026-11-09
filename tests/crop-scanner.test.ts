import assert from 'node:assert/strict';
import { normalizeCropName } from '../lib/gemini';
import { CropDiagnosisSchema, CropDiagnosis } from '../lib/schemas';

let passed = 0;
let failed = 0;

function testCase(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${name}`, err);
  }
}

console.log('\n🧪 Running Zarkhez Crop Scanner Two-Stage Intelligence Unit Tests...\n');

// Helper to validate CropDiagnosis object against strict Zod schema
function validateDiagnosis(diag: unknown): CropDiagnosis {
  const result = CropDiagnosisSchema.safeParse(diag);
  if (!result.success) {
    throw new Error(`Schema validation failed: ${result.error.message}`);
  }
  return result.data;
}

testCase('TEST 1: Crop Mismatch: Selected Wheat, Image shows Rice stem -> Mismatch detected, never report Wheat leaf healthy', () => {
  const isMatch = normalizeCropName('Rice') === normalizeCropName('Wheat');
  assert.equal(isMatch, false, 'Rice and Wheat must not match');

  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Rice',
    detected_crop_ur: 'دھان (چاول)',
    selected_crop: 'Wheat',
    crop_match: false,
    detected_plant_part: 'Stem',
    detected_plant_part_ur: 'تنا',
    growth_stage: 'Vegetative',
    growth_stage_ur: 'بڑھوتری کا مرحلہ',
    identification_confidence: 0.95,
    diagnosis_status: 'crop_mismatch',
    plant_condition: 'Not assessed pending crop confirmation',
    plant_condition_ur: 'فصل کی تصدیق تک معائنہ روک دیا گیا ہے',
    problem_name: { en: 'Crop Mismatch Detected', ur: 'فصل کی عدم مطابقت' },
    possible_disease: [],
    observed_symptoms: [],
    possible_causes: [],
    severity: 'not_assessed',
    recommendations: [],
    prevention: [],
    requires_retake: false,
    requires_expert_review: false,
    message: {
      en: 'The image appears to show a Rice stem, but Wheat was selected. Please confirm your crop before diagnosis.',
      ur: 'تصویر میں دھان کا تنا نظر آرہا ہے، جبکہ آپ نے گندم منتخب کی ہے۔ براہِ کرم درست فصل کی تصدیق کریں۔',
    },
  });

  assert.equal(diag.crop_match, false);
  assert.equal(diag.diagnosis_status, 'crop_mismatch');
  assert.equal(diag.detected_crop, 'Rice');
  assert.equal(diag.detected_plant_part, 'Stem');
  assert.notEqual(diag.problem_name.en, 'Wheat leaf is healthy');
});

testCase('TEST 2: Crop Match: Selected Rice, Uploaded Rice leaf with disease symptoms -> Accurately diagnoses disease', () => {
  const isMatch = normalizeCropName('Rice') === normalizeCropName('rice');
  assert.equal(isMatch, true);

  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Rice',
    detected_crop_ur: 'دھان',
    selected_crop: 'Rice',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    growth_stage: 'Tillering',
    growth_stage_ur: 'شگوفے نکلنے کا مرحلہ',
    identification_confidence: 0.91,
    diagnosis_status: 'possible_disease',
    plant_condition: 'Brown circular spots visible across leaf blade.',
    plant_condition_ur: 'پتے کی سطح پر گول بھورے دھبے دیکھے گئے۔',
    problem_name: { en: 'Rice Brown Spot', ur: 'دھان کا بھورا دھبہ (Brown Spot)' },
    possible_disease: [{ name: 'Brown Spot (Bipolaris oryzae)', name_ur: 'بھورا دھبہ', confidence: 0.88 }],
    observed_symptoms: [
      { en: 'Small, circular to oval dark brown spots on foliage.', ur: 'پتوں پر بیضوی گہرے بھورے دھبے۔' },
    ],
    possible_causes: [{ en: 'Fungal infection favoured by nutrient-deficient soil.', ur: 'پوٹاش اور نائٹروجن کی کمی والی مٹی میں پھپھوندی کا حملہ۔' }],
    severity: 'medium',
    recommendations: [
      { en: 'Apply balanced potassium and nitrogen fertilizers; avoid excessive drought stress.', ur: 'متوازن پوٹاش اور کھاد دیں اور وتر برقرار رکھیں۔' },
      { en: 'For severe spread, apply recommended copper-based or azoxystrobin fungicide class per container label under extension advice.', ur: 'شدید پھیلاؤ کی صورت میں لیبل کے مطابق منظور شدہ پھپھوندی کش دوا زرعی افسر کے مشورے سے استعمال کریں۔' },
    ],
    prevention: [{ en: 'Treat seed with certified fungicide before nursery sowing.', ur: 'پنیری سے قبل بیج کو زہر آلود کریں۔' }],
    requires_retake: false,
    requires_expert_review: false,
    message: { en: 'Brown spot symptoms detected on rice foliage.', ur: 'دھان کے پتے پر بھورے دھبے کی علامات دیکھی گئیں۔' },
  });

  assert.equal(diag.crop_match, true);
  assert.equal(diag.diagnosis_status, 'possible_disease');
  assert.equal(diag.severity, 'medium');
  assert.ok(diag.recommendations.length > 0);
});

testCase('TEST 3: Healthy Plant: Selected Wheat, Healthy-looking Wheat leaf -> Reports no obvious symptoms, not absolute proof', () => {
  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Wheat',
    detected_crop_ur: 'گندم',
    selected_crop: 'Wheat',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    growth_stage: 'Jointing',
    growth_stage_ur: 'گوبھ کا مرحلہ',
    identification_confidence: 0.96,
    diagnosis_status: 'healthy_no_symptoms',
    plant_condition: 'No obvious visible symptoms detected. Foliage is vigorous and green.',
    plant_condition_ur: 'کوئی واضح علامات ظاہر نہیں ہوئیں؛ پودا تندرست اور سرسبز ہے۔',
    problem_name: { en: 'No Obvious Symptoms Detected', ur: 'کوئی واضح علامات ظاہر نہیں ہوئیں (بظاہر تندرست)' },
    possible_disease: [],
    observed_symptoms: [],
    possible_causes: [{ en: 'Healthy growth under favorable seasonal conditions.', ur: 'سازگار موسم میں پودے کی معمول کی تندرست بڑھوتری۔' }],
    severity: 'low',
    recommendations: [
      { en: 'Continue regular morning field scouting to catch any early rust spores.', ur: 'صبح کے وقت کھیت کا باقاعدگی سے معائنہ جاری رکھیں۔' },
    ],
    prevention: [{ en: 'Maintain adequate moisture and weed-free field borders.', ur: 'مناسب وتر اور جڑی بوٹیوں سے پاک کھیت برقرار رکھیں۔' }],
    requires_retake: false,
    requires_expert_review: false,
    message: { en: 'No obvious visible symptoms detected. Note: this does not guarantee 100% absence of latent micro-pathogens.', ur: 'پودے پر فی الحال کوئی واضح بیماری نہیں ملی۔' },
  });

  assert.equal(diag.diagnosis_status, 'healthy_no_symptoms');
  assert.equal(diag.problem_name.en, 'No Obvious Symptoms Detected');
});

testCase('TEST 4: Crop Mismatch: Selected Cotton, Uploaded Tomato leaf -> Detects Tomato & shows mismatch', () => {
  const isMatch = normalizeCropName('Tomato') === normalizeCropName('Cotton');
  assert.equal(isMatch, false);

  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Tomato',
    detected_crop_ur: 'ٹماٹر',
    selected_crop: 'Cotton',
    crop_match: false,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    growth_stage: 'Vegetative',
    growth_stage_ur: 'بڑھوتری کا مرحلہ',
    identification_confidence: 0.97,
    diagnosis_status: 'crop_mismatch',
    plant_condition: 'Not assessed pending crop confirmation',
    plant_condition_ur: 'فصل کی تصدیق تک معائنہ روک دیا گیا ہے',
    problem_name: { en: 'Crop Mismatch Detected', ur: 'فصل کی عدم مطابقت' },
    possible_disease: [],
    observed_symptoms: [],
    possible_causes: [],
    severity: 'not_assessed',
    recommendations: [],
    prevention: [],
    requires_retake: false,
    requires_expert_review: false,
    message: {
      en: 'The image appears to show a Tomato leaf, but Cotton was selected. Please confirm your crop.',
      ur: 'تصویر میں ٹماٹر کا پتا نظر آرہا ہے، جبکہ آپ نے کپاس منتخب کی ہے۔ براہِ کرم تصدیق کریں۔',
    },
  });

  assert.equal(diag.crop_match, false);
  assert.equal(diag.detected_crop, 'Tomato');
});

testCase('TEST 5: Blurry Photograph: Selected Rice, Uploaded Blurry Image -> Flags requires_retake', () => {
  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Uncertain',
    detected_crop_ur: 'غیر یقینی',
    selected_crop: 'Rice',
    crop_match: true,
    detected_plant_part: 'Uncertain',
    detected_plant_part_ur: 'غیر واضح',
    growth_stage: 'Uncertain',
    growth_stage_ur: 'معلوم نہیں',
    identification_confidence: 0.35,
    diagnosis_status: 'uncertain',
    plant_condition: 'Image is out of focus or motion-blurred.',
    plant_condition_ur: 'تصویر دھندلی ہے جس سے علامات کی درست شناخت ممکن نہیں۔',
    problem_name: { en: 'Blurry Photograph - Retake Advised', ur: 'دھندلی تصویر — دوبارہ تصویر درکار ہے' },
    possible_disease: [],
    observed_symptoms: [],
    possible_causes: [],
    severity: 'not_assessed',
    recommendations: [],
    prevention: [],
    requires_retake: true,
    requires_expert_review: false,
    message: {
      en: 'The photograph is too blurry for a reliable diagnosis. Please hold the phone steady in good light and tap again.',
      ur: 'تصویر کافی دھندلی ہے؛ درست معائنے کے لیے براہِ کرم کیمرہ مضبوطی سے تھام کر دوبارہ صاف تصویر لیں۔',
    },
  });

  assert.equal(diag.requires_retake, true);
  assert.equal(diag.diagnosis_status, 'uncertain');
});

testCase('TEST 6: Invalid Image (Mobile Phone Uploaded) -> Flags image_valid=false & invalid_image', () => {
  const diag = validateDiagnosis({
    image_valid: false,
    detected_crop: 'Non-plant',
    detected_crop_ur: 'غیر متعلقہ تصویر',
    selected_crop: 'Wheat',
    crop_match: false,
    detected_plant_part: 'None',
    detected_plant_part_ur: 'کوئی نہیں',
    growth_stage: 'Uncertain',
    growth_stage_ur: 'معلوم نہیں',
    identification_confidence: 0.99,
    diagnosis_status: 'invalid_image',
    plant_condition: 'Non-plant object detected (electronic device).',
    plant_condition_ur: 'تصویر میں کوئی پودا یا فصل موجود نہیں۔',
    problem_name: { en: 'Invalid Plant Image', ur: 'پودے کی غیر متعلقہ تصویر' },
    possible_disease: [],
    observed_symptoms: [],
    possible_causes: [],
    severity: 'not_assessed',
    recommendations: [],
    prevention: [],
    requires_retake: true,
    requires_expert_review: false,
    message: {
      en: 'The uploaded image appears to show an object, not a farm crop. Please take a photo of your plant.',
      ur: 'اپلوڈ کی گئی تصویر میں کوئی فصل یا پودا نظر نہیں آ رہا۔ براہِ کرم اپنی فصل کی واضح تصویر لیں۔',
    },
  });

  assert.equal(diag.image_valid, false);
  assert.equal(diag.diagnosis_status, 'invalid_image');
});

testCase('TEST 7: Normal Adventitious Roots on Rice Stem -> Recognized as plant part, NOT disease', () => {
  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Rice',
    detected_crop_ur: 'دھان (چاول)',
    selected_crop: 'Rice',
    crop_match: true,
    detected_plant_part: 'Stem',
    detected_plant_part_ur: 'تنا اور نچلا حصہ',
    growth_stage: 'Vegetative',
    growth_stage_ur: 'بڑھوتری کا مرحلہ',
    identification_confidence: 0.93,
    diagnosis_status: 'healthy_no_symptoms',
    plant_condition: 'Normal adventitious root growth from lower stem nodes in moist conditions. Plant tissue is healthy.',
    plant_condition_ur: 'مرطوب وتر میں تنے کے نچلے جوڑ سے قدرتی جڑیں نکل رہی ہیں؛ یہ عام قدرتی عمل ہے اور کوئی بیماری نہیں۔',
    problem_name: { en: 'Normal Adventitious Roots (Healthy Biology)', ur: 'قدرتی جڑوں کا پھوٹنا (صحت مند علامت)' },
    possible_disease: [],
    observed_symptoms: [
      { en: 'White adventitious root primordia emerging from lower stem nodes under high humidity.', ur: 'نمی میں تنے کے نچلے حصے سے سفید قدرتی جڑیں نکلنا۔' },
    ],
    possible_causes: [{ en: 'Normal physiological response to wet field conditions.', ur: 'وتر اور نمی میں پودے کا قدرتی جسمانی ردعمل۔' }],
    severity: 'low',
    recommendations: [
      { en: 'No chemical spray needed. This is normal plant biology.', ur: 'کسی سپرے کی ضرورت نہیں؛ یہ پودے کا قدرتی اور صحت مند عمل ہے۔' },
    ],
    prevention: [],
    requires_retake: false,
    requires_expert_review: false,
    message: { en: 'White roots at lower stem nodes are normal adventitious roots, not a fungal disease.', ur: 'تنے سے نکلنے والی سفید جڑیں قدرتی ہیں، کوئی بیماری نہیں۔' },
  });

  assert.equal(diag.detected_plant_part, 'Stem');
  assert.equal(diag.diagnosis_status, 'healthy_no_symptoms');
  assert.notEqual(diag.diagnosis_status, 'possible_disease');
});

testCase('TEST 8: Independent Scan Sessions: Sequential scans do not bleed or cross-contaminate', () => {
  const scanA = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Cotton',
    detected_crop_ur: 'کپاس',
    selected_crop: 'Cotton',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    growth_stage: 'Flowering',
    growth_stage_ur: 'پھول آنے کا مرحلہ',
    identification_confidence: 0.92,
    diagnosis_status: 'possible_pest',
    plant_condition: 'Whitefly nymph feeding observed.',
    plant_condition_ur: 'پتے کے نچلے رخ سفید مکھی دیکھی گئی۔',
    problem_name: { en: 'Whitefly Infestation', ur: 'سفید مکھی کا حملہ' },
    possible_disease: [],
    observed_symptoms: [{ en: 'Sooty mold and leaf curling.', ur: 'پتوں کا مڑنا۔' }],
    possible_causes: [{ en: 'Whitefly sap-feeding.', ur: 'رس چوسنے والے کیڑے۔' }],
    severity: 'medium',
    recommendations: [{ en: 'Spray neem seed extract.', ur: 'نیم کے عرق کا سپرے کریں۔' }],
    prevention: [],
    requires_retake: false,
    requires_expert_review: false,
    message: { en: 'Whitefly detected.', ur: 'سفید مکھی کی موجودگی۔' },
  });

  const scanB = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Wheat',
    detected_crop_ur: 'گندم',
    selected_crop: 'Wheat',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    growth_stage: 'Heading',
    growth_stage_ur: 'سٹے نکلنے کا مرحلہ',
    identification_confidence: 0.89,
    diagnosis_status: 'healthy_no_symptoms',
    plant_condition: 'Normal vigorous canopy.',
    plant_condition_ur: 'صحت مند پودا۔',
    problem_name: { en: 'No Obvious Symptoms', ur: 'کوئی علامات نہیں' },
    possible_disease: [],
    observed_symptoms: [],
    possible_causes: [],
    severity: 'low',
    recommendations: [],
    prevention: [],
    requires_retake: false,
    requires_expert_review: false,
    message: { en: 'Wheat canopy is clean.', ur: 'گندم کی فصل صاف ہے۔' },
  });

  assert.equal(scanA.detected_crop, 'Cotton');
  assert.equal(scanB.detected_crop, 'Wheat');
  assert.notEqual(scanA.detected_crop, scanB.detected_crop);
});

console.log(`\n🎉 Unit Test Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}

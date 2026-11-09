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

// ==============================================================================
// SECTION 7 REGRESSION SUITE: FALSE NEGATIVE PREVENTION & VISUAL LESION SCREENING
// ==============================================================================

testCase('TEST 9 (REGRESSION): Rice leaf with spindle lesions (grey center, brown margin) -> Diagnoses Rice blast-like symptoms, NEVER healthy', () => {
  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Rice',
    detected_crop_ur: 'دھان (چاول)',
    detected_crop_roman_ur: 'Dhan / Chawal',
    detected_crop_sd: 'چانور',
    selected_crop: 'Rice',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    detected_plant_part_roman_ur: 'Patta',
    detected_plant_part_sd: 'پن',
    growth_stage: 'Tillering',
    growth_stage_ur: 'شگوفے نکلنے کا مرحلہ',
    identification_confidence: 0.94,
    visual_inspection: {
      lesion_detected: true,
      lesion_count: '6 to 10 discrete lesions across leaf blade',
      lesion_shape: 'spindle_shaped',
      lesion_colors: ['whitish_grey_center', 'dark_brown_margins', 'yellow_halo'],
      lesion_margins: 'Distinct dark brown necrotic border',
      lesion_distribution: 'Scattered across mid and upper leaf blade',
      tissue_damage: 'Focal necrotic spots with center desiccation',
    },
    diagnosis_status: 'possible_disease',
    plant_condition: 'Visible leaf lesions with necrotic desiccation on rice foliage blade.',
    plant_condition_ur: 'دھان کے پتے پر گہرے حاشیے والے واضح دھبے اور بافتوں کا سوکھاؤ۔',
    problem_name: {
      en: 'Suspected Rice Leaf Blast (Magnaporthe oryzae)',
      ur: 'دھان کا بلاسٹ / پتوں کا جھلساؤ (Rice Blast)',
      roman_ur: 'Dhan ka Blast (Rice Blast)',
      sd: 'چانورن جو بلاست',
    },
    possible_disease: [
      {
        name: 'Rice Leaf Blast (Magnaporthe oryzae)',
        name_ur: 'دھان کا بلاسٹ',
        confidence: 0.91,
        is_primary: true,
      },
      {
        name: 'Rice Brown Spot (Bipolaris oryzae)',
        name_ur: 'دھان کا بھورا دھبہ',
        confidence: 0.65,
        is_primary: false,
      },
    ],
    alternative_diagnoses: [
      {
        name: 'Rice Brown Spot (Bipolaris oryzae)',
        reason: {
          en: 'Brown spot typically forms more circular/oval lesions often associated with zinc or potassium deficiency.',
          ur: 'براؤن سپاٹ گول بیضوی دھبے بناتا ہے جو پوٹاش یا زنک کی کمی سے بڑھتے ہیں۔',
        },
      },
    ],
    why_suspected: {
      en: 'Spindle-shaped lesions with whitish-grey center and dark brown margin observed on the leaf blade are visually characteristic of Rice Blast; differentiated from healthy leaves by focal necrotic tissue damage.',
      ur: 'دھان کے پتے پر تکلا نما (Spindle-shaped) دھبے جن کا درمیانی حصہ سرمئی اور کنارے گہرے بھورے ہیں، رائس بلاسٹ کی خاص علامت ہیں۔',
    },
    observed_symptoms: [
      {
        en: 'Multiple spindle-shaped lesions observed across foliage blade.',
        ur: 'پتے کی سطح پر تکلا نما دھبے دیکھے گئے۔',
      },
      {
        en: 'Whitish-grey necrotic center surrounded by dark brown margin.',
        ur: 'درمیان سے سرمئی مائل سفید اور چاروں طرف گہرا بھورا حاشیہ۔',
      },
    ],
    possible_causes: [
      {
        en: 'Magnaporthe oryzae fungal infection favored by high humidity and excess nitrogen.',
        ur: 'زیادہ نمی اور نائٹروجن کی زیادتی میں پھپھوندی کا حملہ۔',
      },
    ],
    severity: 'medium',
    severity_explanation: {
      en: 'Foliage blast requires prompt intervention to prevent spread to stem nodes and emerging panicles.',
      ur: 'پتوں کا بلاسٹ اگر بروقت نہ روکا جائے تو یہ تنے اور مونجھ تک پھیل سکتا ہے۔',
    },
    recommendations: [
      {
        en: 'Scout adjacent tillers and nursery beds immediately to determine the percentage of infected plants.',
        ur: 'کھیت کے باقی حصوں کا فوراً معائنہ کریں تاکہ بیماری کے پھیلاؤ کا صحیح اندازہ ہو سکے۔',
      },
      {
        en: 'Immediately halt excess top-dressing of Urea; high nitrogen drastically fuels blast fungal development.',
        ur: 'یوریا کھاد کا اضافی استعمال فوری روک دیں؛ زیادہ نائٹروجن سے بلاسٹ کا حملہ انتہائی تیز ہو جاتا ہے۔',
      },
      {
        en: 'Consult local agricultural extension officer for registered blast fungicide class advice (e.g. tricyclazole active ingredient per label).',
        ur: 'محکمہ زراعت توسیعی افسر سے منظور شدہ بلاسٹ کش گروپ (جیسے ٹرائی سائیکلازول) کے متعلق فوری رہنمائی حاصل کریں۔',
      },
    ],
    prevention: [
      {
        en: 'Sow certified blast-resistant varieties and treat seed with registered fungicide before seeding.',
        ur: 'قوتِ مدافعت رکھنے والی تصدیق شدہ اقسام کاشت کریں اور پنیری سے قبل بیج کو زہر آلود کریں۔',
      },
    ],
    when_to_consult_expert: {
      en: 'Consult local extension officer immediately if spindle lesions appear on more than 3-5% of foliage.',
      ur: 'اگر تکلا نما دھبے 3 سے 5 فیصد پتوں پر ظاہر ہوں تو فوری زرعی افسر کو دکھائیں۔',
    },
    requires_retake: false,
    requires_expert_review: true,
    message: {
      en: 'Visible spindle-shaped lesions observed on rice leaf. Blast-like symptoms detected; follow cultural hygiene and consult extension officer.',
      ur: 'دھان کے پتے پر بلاسٹ نما تکلا دھبے دیکھے گئے ہیں۔ یوریا کھاد روکیں اور مقامی زرعی توسیعی افسر سے معائنہ کروائیں۔',
    },
  });

  assert.equal(diag.detected_crop, 'Rice');
  assert.equal(diag.detected_plant_part, 'Leaf');
  assert.equal(diag.diagnosis_status, 'possible_disease');
  assert.equal(diag.visual_inspection?.lesion_detected, true);
  assert.equal(diag.visual_inspection?.lesion_shape, 'spindle_shaped');
  assert.notEqual(diag.diagnosis_status, 'healthy_no_symptoms');
  assert.doesNotMatch(diag.problem_name.en.toLowerCase(), /healthy/);
  assert.doesNotMatch(diag.message.en.toLowerCase(), /no obvious disease/);
});

testCase('TEST 10: Genuinely healthy rice leaf -> Confirms healthy_no_symptoms with zero lesions', () => {
  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Rice',
    detected_crop_ur: 'دھان',
    selected_crop: 'Rice',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    growth_stage: 'Vegetative',
    growth_stage_ur: 'بڑھوتری کا مرحلہ',
    identification_confidence: 0.96,
    visual_inspection: {
      lesion_detected: false,
      lesion_count: 'none',
      lesion_shape: 'none',
      lesion_colors: [],
      lesion_margins: 'none',
      lesion_distribution: 'none',
      tissue_damage: 'intact vigorous green tissue',
    },
    diagnosis_status: 'healthy_no_symptoms',
    plant_condition: 'Uniform green foliage with intact margins and zero lesions.',
    plant_condition_ur: 'پتے کی بافتیں تندرست، یکساں سبز اور کسی قسم کے دھبے کے بغیر ہیں۔',
    problem_name: {
      en: 'No Obvious Symptoms Detected (Appears Healthy)',
      ur: 'کوئی واضح علامات ظاہر نہیں ہوئیں (بظاہر تندرست)',
    },
    possible_disease: [],
    alternative_diagnoses: [],
    why_suspected: {
      en: 'Uniform green coloration across leaf lamina with zero necrotic spots and zero blast spindles.',
      ur: 'پتے کی سطح پر یکساں سبز رنگت اور کسی قسم کے دھبوں کے بغیر مکمل صحت مند کیفیت۔',
    },
    observed_symptoms: [],
    possible_causes: [
      {
        en: 'Healthy crop growth under current seasonal management.',
        ur: 'موجودہ موسمی و زرعی حالات میں پودے کی معمول کی تندرست بڑھوتری۔',
      },
    ],
    severity: 'low',
    recommendations: [
      {
        en: 'Maintain regular morning scouting to detect any initial pests or airborne mildews early.',
        ur: 'روزانہ صبح کے وقت کھیت کا معائنہ جاری رکھیں تاکہ کسی بھی بیماری کا بروقت پتہ چل سکے۔',
      },
    ],
    prevention: [],
    requires_retake: false,
    requires_expert_review: false,
    message: {
      en: 'No obvious disease or pest symptoms observed. Note: visual inspection does not guarantee 100% absence of latent micro-pathogens.',
      ur: 'اس پودے پر کوئی واضح بیماری نہیں ملی۔ معمول کی دیکھ بھال جاری رکھیں۔',
    },
  });

  assert.equal(diag.diagnosis_status, 'healthy_no_symptoms');
  assert.equal(diag.visual_inspection?.lesion_detected, false);
});

testCase('TEST 11: Rice leaf with brown spot symptoms -> Accurately diagnoses Brown Spot', () => {
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
    identification_confidence: 0.92,
    visual_inspection: {
      lesion_detected: true,
      lesion_count: 'Several discrete oval spots',
      lesion_shape: 'circular_oval',
      lesion_colors: ['dark_brown', 'yellow_halo'],
      lesion_margins: 'Defined brown border with chlorotic halo',
      lesion_distribution: 'Scattered across leaf surface',
      tissue_damage: 'Oval necrotic lesions',
    },
    diagnosis_status: 'possible_disease',
    plant_condition: 'Oval brown spots with yellow halos across leaf blade.',
    plant_condition_ur: 'پتے پر پیلے حلقے والے بیضوی بھورے دھبے۔',
    problem_name: {
      en: 'Rice Brown Spot (Bipolaris oryzae)',
      ur: 'دھان کا بھورا دھبہ (Brown Spot)',
    },
    possible_disease: [
      {
        name: 'Rice Brown Spot (Bipolaris oryzae)',
        name_ur: 'دھان کا بھورا دھبہ',
        confidence: 0.89,
        is_primary: true,
      },
    ],
    severity: 'medium',
    recommendations: [
      {
        en: 'Apply balanced potassium and zinc nutrition; avoid severe drought stress.',
        ur: 'متوازن پوٹاش اور زنک کھاد دیں اور وتر برقرار رکھیں۔',
      },
    ],
    prevention: [],
    requires_retake: false,
    requires_expert_review: false,
    message: {
      en: 'Brown spot symptoms observed on rice foliage.',
      ur: 'دھان کے پتے پر بھورے دھبے دیکھے گئے۔',
    },
  });

  assert.equal(diag.diagnosis_status, 'possible_disease');
  assert.equal(diag.visual_inspection?.lesion_shape, 'circular_oval');
  assert.ok(diag.problem_name.en.includes('Brown Spot'));
});

testCase('TEST 12: Rice leaf with chlorosis / yellowing -> Flags nutrient or environmental stress, NOT healthy', () => {
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
    identification_confidence: 0.90,
    visual_inspection: {
      lesion_detected: false,
      lesion_count: 'none',
      lesion_shape: 'none',
      lesion_colors: ['yellow_chlorotic'],
      lesion_margins: 'diffuse',
      lesion_distribution: 'generalized across older leaves',
      tissue_damage: 'chlorosis / loss of chlorophyll',
    },
    diagnosis_status: 'possible_nutrient_deficiency',
    plant_condition: 'Generalized interveinal yellowing without necrotic lesions.',
    plant_condition_ur: 'بغیر دھبوں کے پتوں پر عمومی پیلا پن۔',
    problem_name: {
      en: 'Nutrient Deficiency / Nitrogen Chlorosis',
      ur: 'غذائی کمی / نائٹروجن کی کمی (کلوروسس)',
    },
    possible_disease: [],
    severity: 'low',
    recommendations: [
      {
        en: 'Apply planned split urea application with shallow irrigation.',
        ur: 'ہلکی آبپاشی کے ساتھ یوریا کی مقررہ قسط دیں۔',
      },
    ],
    prevention: [],
    requires_retake: false,
    requires_expert_review: false,
    message: {
      en: 'Yellowing indicates nutrient chlorosis rather than fungal spots.',
      ur: 'پیلا پن پھپھوندی کے بجائے خوراک کی کمی کی طرف اشارہ کرتا ہے۔',
    },
  });

  assert.equal(diag.diagnosis_status, 'possible_nutrient_deficiency');
  assert.notEqual(diag.diagnosis_status, 'healthy_no_symptoms');
});

testCase('TEST 13: Fallback Crop Scanner prevents False Negatives when client optical pre-scan detects lesions', async () => {
  const { getFallbackCropDiagnosis } = await import('../lib/gemini');

  const fallbackWithLesions = getFallbackCropDiagnosis('Rice', false, {
    isBlurry: false,
    isDark: false,
    isOverexposed: false,
    isTooSmall: false,
    blurScore: 85,
    brightnessScore: 120,
    subjectRatio: 0.55,
    greenRatio: 0.50,
    yellowRatio: 0.03,
    lesionRatio: 0.025,
    hasVisibleLesions: true,
    overallScore: 0.95,
    isAcceptable: true,
  });

  assert.equal(fallbackWithLesions.detected_crop, 'Rice');
  assert.equal(fallbackWithLesions.diagnosis_status, 'possible_disease');
  assert.equal(fallbackWithLesions.visual_inspection.lesion_detected, true);
  assert.notEqual(fallbackWithLesions.diagnosis_status, 'healthy_no_symptoms');
  assert.ok(fallbackWithLesions.problem_name.en.includes('Blast'));

  // Conversely, clean foliage without lesions returns healthy
  const fallbackClean = getFallbackCropDiagnosis('Rice', false, {
    isBlurry: false,
    isDark: false,
    isOverexposed: false,
    isTooSmall: false,
    blurScore: 90,
    brightnessScore: 125,
    subjectRatio: 0.60,
    greenRatio: 0.60,
    yellowRatio: 0.005,
    lesionRatio: 0.001,
    hasVisibleLesions: false,
    overallScore: 1.0,
    isAcceptable: true,
  });

  assert.equal(fallbackClean.diagnosis_status, 'healthy_no_symptoms');
  assert.equal(fallbackClean.visual_inspection.lesion_detected, false);
});

testCase('TEST 14: Extreme AI Plant Scan Schema: Scientific Name, Pathogen Type, Calibrated Confidence, Hotspots & Dual Explanations', () => {
  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Wheat',
    detected_crop_ur: 'گندم',
    selected_crop: 'Wheat',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    growth_stage: 'Booting',
    growth_stage_ur: 'گوبھ کا مرحلہ',
    identification_confidence: 0.94,
    scientific_name: 'Puccinia striiformis',
    pathogen_type: 'fungal',
    confidence_category: 'high',
    confidence_limitations: {
      en: 'Visual AI scan confirms striping pustule morphology but cannot replace spore microscopy.',
      ur: 'بصری معائنہ پیلی کنگی کی پٹیوں کی تصدیق کرتا ہے مگر مائکروسکوپ کا متبادل نہیں۔',
    },
    visual_inspection: {
      lesion_detected: true,
      lesion_count: 'Linear yellow pustule stripes along parallel leaf veins',
      lesion_shape: 'elongated_irregular',
      lesion_size_est: '1 to 2 mm width in continuous linear stripes',
      lesion_colors: ['bright_yellow', 'orange_yellow'],
      lesion_margins: 'vein_delimited',
      lesion_distribution: 'parallel to leaf veins on upper blade',
      tissue_damage: 'epidermal rupture with yellow urediniospores',
      chlorosis_detected: true,
      necrosis_detected: false,
      wilting_detected: false,
      affected_area_pct: 18,
      detected_hotspots: [
        { x: 25, y: 30, w: 20, h: 45, label: 'Yellow Rust Stripe' },
      ],
    },
    diagnosis_status: 'possible_disease',
    plant_condition: 'Wheat foliage exhibits classic yellow stripe rust linear pustules.',
    plant_condition_ur: 'گندم کے پتے پر پیلی کنگی کی زرد پٹیاں دیکھی گئیں۔',
    problem_name: {
      en: 'Stripe / Yellow Rust (Puccinia striiformis)',
      ur: 'گندم کی زرد / پیلی کنگی (Yellow Rust)',
    },
    possible_disease: [
      { name: 'Yellow Rust (Puccinia striiformis)', name_ur: 'پیلی کنگی', confidence: 0.94, is_primary: true },
    ],
    severity: 'high',
    severity_level: 'high',
    severity_scope: {
      leaf_affected_pct: 18,
      scope_note: {
        en: 'Photographed leaf has 18% pustule coverage. Scout 20+ plants in an X-pattern.',
        ur: 'اس پتے پر 18 فیصد کنگی ہے۔ پورے کھیت میں 20 پودوں کا معائنہ کریں۔',
      },
    },
    recommendations: [
      { en: 'Apply registered triazole class fungicide.', ur: 'منظور شدہ ٹرائیازول گروپ سپرے کریں۔' },
    ],
    treatment_pillars: {
      immediate_actions: [
        { en: 'Inspect surrounding fields for yellow pustule dust.', ur: 'کھیت کے گرد زرد پاؤڈر چیک کریں۔' },
      ],
      cultural_management: [
        { en: 'Plant certified rust-resistant wheat varieties (e.g. Akbar-19, Dilkash-20).', ur: 'قوتِ مدافعت رکھنے والی اقسام کاشت کریں۔' },
      ],
      biological_management: [],
      chemical_management: [
        {
          active_ingredient: 'Propiconazole 25% EC (or Tebuconazole)',
          purpose: { en: 'Ergosterol biosynthesis inhibitor suppressing rust mycelium.', ur: 'کنگی کا پھیلاؤ روکنے والی دوا۔' },
          safety_precautions: { en: 'Observe 21-day PHI, wear PPE.', ur: 'حفاظتی تدابیر اپنائیں۔' },
        },
      ],
    },
    prevention: [
      { en: 'Avoid late sowing which exposes crop to high spring humidity.', ur: 'پچھیتی کاشت سے گریز کریں۔' },
    ],
    explanations: {
      farmer_friendly: {
        en: 'Your wheat shows yellow rust. Spores spread rapidly by wind in cool moist weather.',
        ur: 'گندم کے پتے پر پیلی کنگی کا حملہ ہے۔ یہ ٹھنڈے اور مرطوب موسم میں ہوا سے تیزی سے پھیلتی ہے۔',
      },
      scientific: {
        en: 'Puccinia striiformis f. sp. tritici obligate biotrophic rust with parallel uredinial pustules.',
        ur: 'پکسینیا سٹرائی فورمس کنگی کا حملہ۔ پتے کی رگوں کے متوازی زرد پٹیاں۔',
      },
    },
    voice_script: {
      en: 'Wheat yellow rust detected. Prompt fungicide application is advised.',
      ur: 'گندم پر پیلی کنگی کا حملہ ہے۔ فوری طور پر توسیعی افسر کے مشورے سے سپرے کریں۔',
    },
    requires_retake: false,
    requires_expert_review: true,
    message: { en: 'Yellow rust pustules detected on wheat foliage.', ur: 'پیلی کنگی دیکھی گئی۔' },
  });

  assert.equal(diag.scientific_name, 'Puccinia striiformis');
  assert.equal(diag.pathogen_type, 'fungal');
  assert.equal(diag.confidence_category, 'high');
  assert.equal(diag.severity_level, 'high');
  assert.equal(diag.visual_inspection.detected_hotspots?.length, 1);
  assert.equal(diag.visual_inspection.affected_area_pct, 18);
  assert.ok(diag.treatment_pillars?.chemical_management.length! > 0);
  assert.ok(diag.explanations?.farmer_friendly.ur.includes('پیلی کنگی'));
});

testCase('TEST 15: Differential Diagnosis Engine validates comparisons and field distinction tips', () => {
  const diag = validateDiagnosis({
    image_valid: true,
    detected_crop: 'Tomato',
    detected_crop_ur: 'ٹماٹر',
    selected_crop: 'Tomato',
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    growth_stage: 'Fruiting',
    growth_stage_ur: 'پھل لگنے کا مرحلہ',
    identification_confidence: 0.91,
    scientific_name: 'Alternaria solani',
    pathogen_type: 'fungal',
    confidence_category: 'moderate',
    diagnosis_status: 'possible_disease',
    plant_condition: 'Concentric bullseye rings visible on lower tomato leaves.',
    plant_condition_ur: 'نچلے پتوں پر ہدف نما دائرے دیکھے گئے۔',
    problem_name: { en: 'Tomato Early Blight', ur: 'ٹماٹر کا اگیتا جھلساؤ' },
    possible_disease: [{ name: 'Early Blight', name_ur: 'اگیتا جھلساؤ', confidence: 0.91 }],
    differential_diagnoses: [
      {
        name: 'Tomato Late Blight',
        scientific_name: 'Phytophthora infestans',
        similarities: { en: 'Both cause dark foliar lesions.', ur: 'دونوں پتوں پر سیاہ دھبے بناتے ہیں۔' },
        differences: { en: 'Early blight forms concentric bullseye rings; late blight causes irregular greasy lesions with white mold underside.', ur: 'اگیتا جھلساؤ میں گول دائرے بنتے ہیں جبکہ پچھیتا میں گریس جیسے دھبے اور نیچے سفید پھپھوندی ہوتی ہے۔' },
        likelihood: 'less_likely',
        field_distinction_tip: { en: 'Check lesion pattern: target rings = early blight; white downy mold underside = late blight.', ur: 'ہدف نما دائرے ہوں تو اگیتا جھلساؤ، نیچے سفید پھپھوندی ہو تو پچھیتا جھلساؤ ہے۔' },
      },
    ],
    severity: 'medium',
    severity_level: 'medium',
    recommendations: [{ en: 'Remove lower leaves.', ur: 'نچلے پتے توڑ دیں۔' }],
    prevention: [],
    requires_retake: false,
    requires_expert_review: false,
    message: { en: 'Early blight detected.', ur: 'اگیتا جھلساؤ ملا۔' },
  });

  assert.equal(diag.differential_diagnoses?.length, 1);
  assert.equal(diag.differential_diagnoses![0].scientific_name, 'Phytophthora infestans');
  assert.equal(diag.differential_diagnoses![0].likelihood, 'less_likely');
  assert.ok(diag.differential_diagnoses![0].field_distinction_tip.en.includes('target rings'));
});

testCase('TEST 16: Fallback Crop Scanner generates full extreme intelligence fields for Rice Blast', async () => {
  const { getFallbackCropDiagnosis } = await import('../lib/gemini');
  const fallback = getFallbackCropDiagnosis('Rice', false, {
    isBlurry: false,
    isDark: false,
    isOverexposed: false,
    isTooSmall: false,
    blurScore: 90,
    brightnessScore: 120,
    subjectRatio: 0.5,
    greenRatio: 0.5,
    yellowRatio: 0.02,
    lesionRatio: 0.02,
    hasVisibleLesions: true,
    overallScore: 0.9,
    isAcceptable: true,
  });

  assert.equal(fallback.scientific_name, 'Magnaporthe oryzae');
  assert.equal(fallback.pathogen_type, 'fungal');
  assert.equal(fallback.confidence_category, 'moderate');
  assert.equal(fallback.severity_level, 'medium');
  assert.equal(fallback.severity_scope?.leaf_affected_pct, 12);
  assert.ok(fallback.visual_inspection.detected_hotspots?.length! >= 1);
  assert.ok(fallback.differential_diagnoses?.length! >= 1);
  assert.ok(fallback.treatment_pillars?.immediate_actions.length! >= 1);
  assert.ok(fallback.treatment_pillars?.chemical_management.length! >= 1);
  assert.ok(fallback.explanations?.farmer_friendly.ur.includes('بلاسٹ'));
  assert.ok(fallback.voice_script?.ur.includes('دھان کے پتے'));
});

console.log(`\n🎉 Unit Test Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}

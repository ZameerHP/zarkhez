import { CropDiagnosisSchema, type CropDiagnosis } from './schemas';
import type { ImageQualityReport } from './image-quality';

/**
 * Browser-safe Offline Preliminary Plant Screening (lib/offline-assessment.ts)
 * Runs strictly on-device optical quality & pigment metrics when cloud Gemini Vision is unreachable.
 * - NEVER claims Gemini inspected the image (`inspection_source: 'offline_assessment'`, `gemini_inspection_status: 'not_run'`).
 * - NEVER fabricates a specific disease diagnosis or confidence score.
 * - Preserves uncertainty honestly and guides the farmer to retry online or consult an extension officer.
 */
export function buildOfflinePreliminaryAssessment(
  selectedCrop: string,
  quality?: ImageQualityReport
): CropDiagnosis {
  const hasVisibleLesions =
    Boolean(quality?.hasVisibleLesions) ||
    Boolean(quality?.lesionRatio && quality.lesionRatio > 0.005);

  const isQualityPoor = Boolean(quality && !quality.isAcceptable);

  const symptomsList: CropDiagnosis['observed_symptoms'] = [];
  if (hasVisibleLesions) {
    symptomsList.push({
      en: `On-device optical check detected abnormal dark/discolored pixel patches (~${Math.round(
        (quality?.lesionRatio ?? 0.01) * 100
      )}% surface ratio). Cloud AI is required to identify the exact disease.`,
      ur: 'فون کے بنیادی کیمرہ تجزیے میں پودے پر غیر معمولی دھبے یا رنگت کی تبدیلی نظر آئی ہے۔ صحیح بیماری جاننے کے لیے کلاؤڈ اے آئی معائنہ ضروری ہے۔',
      roman_ur: 'Phone optical check mein dhabbe mile hain. Sahi bimari jannay ke liye online AI scan zaroori hai.',
      sd: 'فون جي ابتدائي چڪاس ۾ ٻوٽي تي داغ نظر آيا آهن. صحيح سڃاڻپ لاءِ آن لائن اسڪين ضروري آهي.',
    });
  }
  if (quality?.isBlurry) {
    symptomsList.push({
      en: 'Image focus appears soft or blurry in optical check.',
      ur: 'تصویر کا فوکس دھندلا محسوس ہو رہا ہے۔',
      roman_ur: 'Tasveer dhundli mehsoos ho rahi hai.',
      sd: 'تصوير جو فوڪس ڌنڌلو آهي.',
    });
  }

  return CropDiagnosisSchema.parse({
    image_valid: true,
    detected_crop: selectedCrop || 'Selected Crop',
    detected_crop_ur: selectedCrop || 'منتخب فصل',
    selected_crop: selectedCrop,
    crop_match: true,
    detected_plant_part: 'Uncertain',
    detected_plant_part_ur: 'غیر تصدیق شدہ حصہ',
    growth_stage: 'Uncertain',
    growth_stage_ur: 'معلوم نہیں',
    identification_confidence: 0,
    scientific_name: '',
    pathogen_type: 'unknown',
    confidence_category: 'uncertain',
    confidence_limitations: {
      en: 'Offline optical screening ONLY. Gemini Cloud Vision did not inspect this photo, so disease identity and field severity remain unconfirmed.',
      ur: 'یہ صرف فون کا ابتدائی آف لائن جائزہ ہے۔ کلاؤڈ اے آئی معائنہ نہیں ہو سکا، اس لیے بیماری کی حتمی تصدیق ابھی باقی ہے۔',
      roman_ur: 'Yeh sirf offline jaiza hai. Cloud AI scan abhi nahi hua is liye hatmi tashkhees baqi hai.',
      sd: 'هي صرف آف لائن ابتدائي چڪاس آهي. ڪلائوڊ اي آءِ تجزيو نه ٿي سگهيو آهي.',
    },
    visual_inspection: {
      lesion_detected: hasVisibleLesions,
      lesion_count: hasVisibleLesions ? 'Optical anomalies present (unclassified offline)' : 'unassessed offline',
      lesion_shape: 'none',
      lesion_size_est: 'unassessed',
      lesion_colors: [],
      lesion_margins: 'unassessed',
      lesion_distribution: 'unassessed',
      tissue_damage: hasVisibleLesions
        ? 'Pigment discoloration detected on-device; requires Cloud Vision pathology classification'
        : 'Unverified offline',
      chlorosis_detected: (quality?.yellowRatio ?? 0) > 0.12,
      necrosis_detected: hasVisibleLesions,
      wilting_detected: false,
      affected_area_pct: hasVisibleLesions ? Math.min(100, Math.round((quality?.lesionRatio ?? 0.02) * 100)) : 0,
      detected_hotspots: [],
    },
    diagnosis_status: 'uncertain',
    plant_condition: hasVisibleLesions
      ? 'Abnormal dark or discolored spots detected in offline optical scan, but cloud AI could not confirm the disease.'
      : 'Plant health could not be verified because cloud Gemini Vision was unreachable.',
    plant_condition_ur: hasVisibleLesions
      ? 'آف لائن کیمرہ چیک میں پتے پر غیر معمولی دھبے یا رنگ کی تبدیلی ملی ہے، لیکن کلاؤڈ سرور کے بغیر بیماری کا نام طے نہیں ہو سکا۔'
      : 'انٹرنیٹ یا کلاؤڈ وژن سرور دستیاب نہ ہونے کی وجہ سے پودے کی صحت کی تصدیق نہیں ہو سکی۔',
    problem_name: {
      en: isQualityPoor
        ? 'Offline Check Inconclusive — Photo Quality Retake Needed'
        : hasVisibleLesions
        ? 'Offline Check: Spots Detected (Unconfirmed — Retry Online Scan)'
        : 'Offline Preliminary Check Inconclusive (Non-Gemini)',
      ur: isQualityPoor
        ? 'آف لائن جائزہ غیر حتمی — صاف تصویر دوبارہ لیں'
        : hasVisibleLesions
        ? 'ابتدائی آف لائن چیک: مشتبہ دھبے موجود ہیں (کلاؤڈ تصدیق باقی)'
        : 'آف لائن ابتدائی جائزہ غیر حتمی (بغیر کلاؤڈ وژن)',
      roman_ur: 'Offline Jaiza Ghair Yaqeeni — Online Scan Zaroori Hai',
      sd: 'آف لائن چڪاس غير حتمي — آن لائن اسڪين ضروري آهي',
    },
    possible_disease: [],
    alternative_diagnoses: [],
    differential_diagnoses: [],
    why_suspected: {
      en: 'Only basic local luminance and color ratios were inspected on your device. Never treat this offline check as a confirmed medical diagnosis.',
      ur: 'فون پر صرف روشنی اور رنگت کا بنیادی جائزہ لیا گیا ہے۔ اسے ہرگز حتمی تشخیص نہ سمجھیں اور بلا تصدیق کیمیائی سپرے نہ کریں۔',
      roman_ur: 'Sirf phone par bunyadi rangat check ki gayi hai. Bina tasdeeq spray na karein.',
      sd: 'فون تي صرف بنيادي رنگ ۽ روشني چيڪ ڪئي وئي آهي. تصديق کانسواءِ اسپري نه ڪريو.',
    },
    observed_symptoms: symptomsList,
    possible_causes: [
      {
        en: 'Cloud Gemini Vision service could not be reached during this attempt.',
        ur: 'اس کوشش کے دوران جیمنائی کلاؤڈ وژن سرور سے رابطہ نہیں ہو سکا۔',
      },
    ],
    severity: 'not_assessed',
    severity_level: 'unable_to_determine',
    severity_explanation: {
      en: 'Disease severity cannot be confirmed without live Cloud AI inspection or in-person scouting.',
      ur: 'کلاؤڈ اے آئی معائنے یا فیلڈ انسپکشن کے بغیر شدت کا اندازہ نہیں لگایا جا سکتا۔',
    },
    severity_scope: {
      leaf_affected_pct: 0,
      scope_note: {
        en: 'Offline screening cannot extrapolate whole-field disease severity. Inspect multiple plants carefully.',
        ur: 'آف لائن جائزہ پورے کھیت کی حالت نہیں بتا سکتا۔ کھیت میں مختلف پودوں کا خود معائنہ کریں۔',
      },
    },
    what_to_do_now: [],
    treatment_pillars: {
      immediate_actions: [
        {
          en: 'Do NOT apply any chemical pesticides or fungicides based solely on an offline inconclusive screen.',
          ur: 'صرف اس غیر حتمی آف لائن جائزے کی بنیاد پر کوئی بھی کیمیائی دوا یا زہر سپرے ہرگز نہ کریں۔',
        },
        {
          en: 'Retry Cloud Gemini Vision analysis when internet is stable, or take a clearer close-up in daylight.',
          ur: 'انٹرنیٹ مستحکم ہونے پر دوبارہ کلاؤڈ اسکین کریں یا دن کی روشنی میں قریب سے صاف تصویر لیں۔',
        },
      ],
      cultural_management: [],
      biological_management: [],
      chemical_management: [],
    },
    recommendations: [
      {
        en: 'Hold off chemical spraying and retry the online cloud vision scan.',
        ur: 'کیمیائی سپرے روکیں اور انٹرنیٹ بحال ہونے پر دوبارہ کلاؤڈ معائنہ کریں۔',
      },
      {
        en: 'If spots or wilting are spreading in the field, consult your local agriculture extension officer.',
        ur: 'اگر کھیت میں دھبے یا مرجھاؤ پھیل رہا ہو تو فوراً مقامی زرعی افسر سے مشورہ کریں۔',
      },
    ],
    prevention: [],
    when_to_consult_expert: {
      en: 'Consult a qualified agriculture officer whenever active leaf spots, pests, or rapid wilting are visible.',
      ur: 'جب بھی پتوں پر دھبے، کیڑے یا مرجھاؤ نظر آئے تو مقامی زرعی توسیعی افسر سے تصدیق ضرور کروائیں۔',
    },
    explanations: {
      farmer_friendly: {
        en: 'Gemini Cloud Vision did not examine this photo yet. We checked basic light and spots on your phone, which shows whether the photo is clear—please retry Cloud Analysis or consult a local agriculture officer before spraying.',
        ur: 'کلاؤڈ اے آئی سرور ابھی یہ تصویر نہیں دیکھ سکا۔ آپ کے فون نے صرف تصویر کی صفائی اور بنیادی نشانات دیکھے ہیں—براہِ کرم دوبارہ کلاؤڈ معائنہ کریں یا سپرے سے قبل مقامی زرعی افسر کو پودا دکھائیں۔',
      },
      scientific: {
        en: 'Offline optical pre-assessment only (pixel luminance, Laplacian blur variance, pigment thresholds). No cloud multimodal pathology inference was executed.',
        ur: 'صرف آف لائن نظری معائنہ؛ کلاؤڈ پیتھالوجی تجزیہ مکمل نہیں ہوا۔',
      },
    },
    voice_script: {
      en: 'Offline preliminary check completed, but cloud vision is still needed to identify the exact crop condition. Please retry when online.',
      ur: 'آف لائن ابتدائی جائزہ غیر حتمی ہے، کلاؤڈ اے آئی سے رابطہ نہیں ہو سکا۔ براہِ کرم انٹرنیٹ بحال ہونے پر دوبارہ اسکین کریں۔',
    },
    requires_retake: isQualityPoor,
    requires_expert_review: true,
    plant_name: {
      en: selectedCrop || 'Selected Crop',
      ur: selectedCrop || 'منتخب فصل',
    },
    plant_part: {
      en: 'Uncertain',
      ur: 'غیر تصدیق شدہ',
    },
    image_quality_assessment: {
      quality_status: isQualityPoor ? 'poor' : 'fair',
      sharpness: quality?.isBlurry ? 'blurry' : 'clear',
      lighting: quality?.isDark ? 'dark' : quality?.isOverexposed ? 'overexposed' : 'adequate',
      framing: quality?.isTooSmall ? 'too_far' : 'adequate',
    },
    inspection_source: 'offline_assessment',
    gemini_inspection_status: 'not_run',
    scan_timestamp: new Date().toISOString(),
    message: {
      en: 'Offline preliminary assessment is inconclusive (not a Gemini diagnosis). Please retry cloud analysis when connected.',
      ur: 'آف لائن ابتدائی جائزہ غیر حتمی ہے (یہ جیمنائی تشخیص نہیں)۔ براہِ کرم دوبارہ کلاؤڈ معائنہ کریں۔',
    },
  });
}

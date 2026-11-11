import {
  CropDiagnosis,
  CropDiagnosisSchema,
  LocalizedString,
} from './schemas';
import type { FieldValidationIssue } from './server/vision-schemas';
import type { ImageQualityReport } from './image-quality';
import { applyClinicalCalibrationAndSafety } from './vision/clinical-calibrator';

export interface NormalizationContext {
  selectedCrop: string;
  inspectionSource?: 'gemini_vision' | 'offline_assessment' | 'hybrid';
  geminiStatus?: 'completed' | 'partial' | 'failed' | 'not_run';
  clientQuality?: ImageQualityReport;
  scanMode?: 'single_plant' | 'whole_field';
  imagesCount?: number;
  region?: string;
}

export type NormalizationResult =
  | {
      ok: true;
      data: CropDiagnosis;
      normalizedAliases: string[];
    }
  | {
      ok: false;
      code: 'INVALID_PAYLOAD' | 'API_ERROR_ENVELOPE' | 'ZOD_VALIDATION_FAILED';
      message: string;
      fieldErrors: FieldValidationIssue[];
    };

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'not_assessed']);
const SEVERITY_SYNONYMS: Record<string, 'low' | 'medium' | 'high' | 'not_assessed'> = {
  low: 'low',
  mild: 'low',
  minimal: 'low',
  minor: 'low',
  medium: 'medium',
  moderate: 'medium',
  mid: 'medium',
  high: 'high',
  severe: 'high',
  not_assessed: 'not_assessed',
  unable_to_determine: 'not_assessed',
  unassessed: 'not_assessed',
  unknown: 'not_assessed',
  na: 'not_assessed',
  'n/a': 'not_assessed',
};

const VALID_DIAGNOSIS_STATUSES = new Set([
  'healthy_no_symptoms',
  'possible_disease',
  'possible_pest',
  'possible_nutrient_deficiency',
  'environmental_stress',
  'uncertain',
  'crop_mismatch',
  'invalid_image',
]);

const STATUS_SYNONYMS: Record<string, string> = {
  healthy_no_symptoms: 'healthy_no_symptoms',
  healthy: 'healthy_no_symptoms',
  no_symptoms: 'healthy_no_symptoms',
  possible_disease: 'possible_disease',
  disease: 'possible_disease',
  suspected_disease: 'possible_disease',
  diseased: 'possible_disease',
  possible_pest: 'possible_pest',
  pest: 'possible_pest',
  insect: 'possible_pest',
  possible_nutrient_deficiency: 'possible_nutrient_deficiency',
  nutrient_deficiency: 'possible_nutrient_deficiency',
  deficiency: 'possible_nutrient_deficiency',
  environmental_stress: 'environmental_stress',
  abiotic_stress: 'environmental_stress',
  uncertain: 'uncertain',
  inconclusive: 'uncertain',
  crop_mismatch: 'crop_mismatch',
  mismatch: 'crop_mismatch',
  wrong_crop: 'crop_mismatch',
  invalid_image: 'invalid_image',
  not_a_plant: 'invalid_image',
  non_plant: 'invalid_image',
};

const STAGE_UR_MAP: Record<string, string> = {
  seedling: 'اگاؤ / نرسری کا مرحلہ',
  tillering: 'شگوفے نکلنے کا مرحلہ',
  vegetative: 'بڑھوتری کا مرحلہ',
  jointing: 'گوبھ کا مرحلہ',
  booting: 'گوبھ کا مرحلہ',
  heading: 'سٹے نکلنے کا مرحلہ',
  flowering: 'پھول آنے کا مرحلہ',
  fruiting: 'پھل / دانہ بننے کا مرحلہ',
  maturity: 'پختگی کا مرحلہ',
  uncertain: 'معلوم نہیں',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeCropSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z]/g, '');
}

function normalizeLocalizedAuxItem(item: unknown): LocalizedString | undefined {
  if (!isPlainObject(item)) return undefined;
  const en = typeof item.en === 'string' ? item.en.trim() : '';
  const ur = typeof item.ur === 'string' ? item.ur.trim() : '';
  const roman_ur = typeof item.roman_ur === 'string' ? item.roman_ur.trim() : undefined;
  const sd = typeof item.sd === 'string' ? item.sd.trim() : undefined;

  if (!en && !ur) return undefined;
  return {
    en: en || ur,
    ur: ur || roman_ur || en,
    ...(roman_ur ? { roman_ur } : {}),
    ...(sd ? { sd } : {}),
  };
}

function normalizeLocalizedArray(arr: unknown): LocalizedString[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(normalizeLocalizedAuxItem)
    .filter((x): x is LocalizedString => x !== undefined);
}

function formatZodIssues(issues: Array<{ path: (string | number)[]; code: string; message: string; expected?: unknown; received?: unknown }>): FieldValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    code: issue.code,
    ...(issue.expected !== undefined ? { expected: String(issue.expected) } : {}),
    ...(issue.received !== undefined ? { received: String(issue.received) } : {}),
    message: issue.message,
  }));
}

export function normalizeAndValidateDiagnosis(
  rawPayload: unknown,
  context: NormalizationContext
): NormalizationResult {
  const aliasesUsed: string[] = [];

  // 1. Guard against null/undefined/non-object
  if (rawPayload === null || rawPayload === undefined) {
    return {
      ok: false,
      code: 'INVALID_PAYLOAD',
      message: 'Received null or undefined diagnosis payload from vision backend.',
      fieldErrors: [{ path: '(root)', code: 'invalid_type', expected: 'object', received: String(rawPayload), message: 'Required' }],
    };
  }

  let candidate: unknown = rawPayload;

  // 2. Unwrap single-item array wrapper if returned by LLM
  if (Array.isArray(candidate)) {
    if (candidate.length === 1 && isPlainObject(candidate[0])) {
      candidate = candidate[0];
      aliasesUsed.push('unwrapped_single_element_array');
    } else {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: `Expected diagnosis object, received array of length ${candidate.length}.`,
        fieldErrors: [{ path: '(root)', code: 'invalid_type', expected: 'object', received: 'array', message: 'Expected object' }],
      };
    }
  }

  if (!isPlainObject(candidate)) {
    return {
      ok: false,
      code: 'INVALID_PAYLOAD',
      message: `Expected diagnosis object, received ${typeof candidate}.`,
      fieldErrors: [{ path: '(root)', code: 'invalid_type', expected: 'object', received: typeof candidate, message: 'Expected object' }],
    };
  }

  // 3. Reject Gemini/HTTP error envelopes loudly before schema validation
  if ('error' in candidate && !('diagnosis_status' in candidate) && !('problem_name' in candidate)) {
    const errObj = candidate.error;
    const errMsg = isPlainObject(errObj) && typeof errObj.message === 'string'
      ? errObj.message
      : typeof errObj === 'string'
      ? errObj
      : 'Vision API returned an error object instead of diagnosis JSON.';
    return {
      ok: false,
      code: 'API_ERROR_ENVELOPE',
      message: errMsg,
      fieldErrors: [{ path: 'error', code: 'api_error', message: errMsg }],
    };
  }

  // 4. Unwrap legitimate wrapper properties (e.g. { diagnosis: { ... } })
  for (const wrapperKey of ['diagnosis', 'crop_diagnosis', 'result', 'report', 'data'] as const) {
    if (
      isPlainObject(candidate[wrapperKey]) &&
      !('diagnosis_status' in candidate) &&
      !('problem_name' in candidate)
    ) {
      candidate = candidate[wrapperKey];
      aliasesUsed.push(`unwrapped_${wrapperKey}`);
      break;
    }
  }

  if (!isPlainObject(candidate)) {
    return {
      ok: false,
      code: 'INVALID_PAYLOAD',
      message: 'Unwrapped diagnosis container was not a valid object.',
      fieldErrors: [{ path: '(root)', code: 'invalid_type', expected: 'object', received: typeof candidate, message: 'Expected object' }],
    };
  }

  // Reject completely empty object `{}`
  if (Object.keys(candidate).length === 0) {
    return {
      ok: false,
      code: 'INVALID_PAYLOAD',
      message: 'Received empty JSON object from Cloud Vision AI.',
      fieldErrors: [{ path: '(root)', code: 'empty_object', message: 'Diagnosis object cannot be empty' }],
    };
  }

  // Shallow clone for safe normalization without mutating caller input
  const d: Record<string, unknown> = { ...candidate };

  // 5. Rescuing dangling `"sd"` if Gemini emitted it outside `plant_condition`
  if (typeof d.sd === 'string' && !d.plant_condition_sd) {
    d.plant_condition_sd = d.sd;
    delete d.sd;
    aliasesUsed.push('rescued_dangling_sd');
  }

  // 6. Flatten nested localized crop/part/stage/condition if Gemini returned `{ en, ur }` instead of flat `_ur`
  if (isPlainObject(d.plant_condition)) {
    const pc = d.plant_condition;
    if (typeof pc.en === 'string') {
      d.plant_condition = pc.en;
      if (typeof pc.ur === 'string' && !d.plant_condition_ur) d.plant_condition_ur = pc.ur;
      if (typeof pc.roman_ur === 'string' && !d.plant_condition_roman_ur) d.plant_condition_roman_ur = pc.roman_ur;
      if (typeof pc.sd === 'string' && !d.plant_condition_sd) d.plant_condition_sd = pc.sd;
      aliasesUsed.push('flattened_plant_condition');
    }
  }

  if (isPlainObject(d.detected_crop)) {
    const dc = d.detected_crop;
    if (typeof dc.en === 'string') {
      d.detected_crop = dc.en;
      if (typeof dc.ur === 'string' && !d.detected_crop_ur) d.detected_crop_ur = dc.ur;
      if (typeof dc.roman_ur === 'string' && !d.detected_crop_roman_ur) d.detected_crop_roman_ur = dc.roman_ur;
      if (typeof dc.sd === 'string' && !d.detected_crop_sd) d.detected_crop_sd = dc.sd;
      aliasesUsed.push('flattened_detected_crop');
    }
  }

  if (!d.detected_crop && isPlainObject(d.plant_name) && typeof d.plant_name.en === 'string') {
    d.detected_crop = d.plant_name.en;
    if (typeof d.plant_name.ur === 'string' && !d.detected_crop_ur) d.detected_crop_ur = d.plant_name.ur;
    if (typeof d.plant_name.roman_ur === 'string' && !d.detected_crop_roman_ur) d.detected_crop_roman_ur = d.plant_name.roman_ur;
    if (typeof d.plant_name.sd === 'string' && !d.detected_crop_sd) d.detected_crop_sd = d.plant_name.sd;
    aliasesUsed.push('mapped_plant_name_to_detected_crop');
  }

  if (!d.detected_crop) {
    for (const cropAlias of ['crop', 'crop_name', 'crop_species', 'species'] as const) {
      if (typeof d[cropAlias] === 'string' && (d[cropAlias] as string).trim()) {
        d.detected_crop = (d[cropAlias] as string).trim();
        aliasesUsed.push(`alias_${cropAlias}_to_detected_crop`);
        break;
      }
    }
  }

  if (isPlainObject(d.detected_plant_part)) {
    const pp = d.detected_plant_part;
    if (typeof pp.en === 'string') {
      d.detected_plant_part = pp.en;
      if (typeof pp.ur === 'string' && !d.detected_plant_part_ur) d.detected_plant_part_ur = pp.ur;
      if (typeof pp.roman_ur === 'string' && !d.detected_plant_part_roman_ur) d.detected_plant_part_roman_ur = pp.roman_ur;
      if (typeof pp.sd === 'string' && !d.detected_plant_part_sd) d.detected_plant_part_sd = pp.sd;
      aliasesUsed.push('flattened_detected_plant_part');
    }
  }

  if (!d.detected_plant_part) {
    for (const partAlias of ['plant_part', 'organ'] as const) {
      const val = d[partAlias];
      if (typeof val === 'string' && val.trim()) {
        d.detected_plant_part = val.trim();
        aliasesUsed.push(`alias_${partAlias}_to_detected_plant_part`);
        break;
      } else if (isPlainObject(val) && typeof val.en === 'string') {
        d.detected_plant_part = val.en;
        if (typeof val.ur === 'string' && !d.detected_plant_part_ur) d.detected_plant_part_ur = val.ur;
        aliasesUsed.push(`alias_${partAlias}_obj_to_detected_plant_part`);
        break;
      }
    }
  }

  if (isPlainObject(d.growth_stage) && typeof d.growth_stage.en === 'string') {
    const gs = d.growth_stage;
    d.growth_stage = gs.en;
    if (typeof gs.ur === 'string' && !d.growth_stage_ur) d.growth_stage_ur = gs.ur;
    aliasesUsed.push('flattened_growth_stage');
  }

  if (!d.growth_stage && typeof d.stage === 'string') {
    d.growth_stage = d.stage;
    aliasesUsed.push('alias_stage_to_growth_stage');
  }

  if (typeof d.growth_stage === 'string' && !d.growth_stage_ur) {
    const mappedUr = STAGE_UR_MAP[d.growth_stage.trim().toLowerCase()];
    if (mappedUr) d.growth_stage_ur = mappedUr;
  }

  // 7. Map known alternative field names for `problem_name`
  if (d.problem_name === undefined) {
    for (const probAlias of ['diagnosis_name', 'disease_name', 'condition_name', 'issue_name', 'title'] as const) {
      if (d[probAlias] !== undefined) {
        d.problem_name = d[probAlias];
        aliasesUsed.push(`alias_${probAlias}_to_problem_name`);
        break;
      }
    }
  }

  // 8. Fill `selected_crop` from verified request context if omitted
  if (d.selected_crop === undefined && context.selectedCrop) {
    d.selected_crop = context.selectedCrop;
  }

  // 9. Normalize `diagnosis_status` enums (case/legitimate synonym only; leave unknown bogus strings to fail Zod)
  if (typeof d.diagnosis_status === 'string') {
    const normStatus = d.diagnosis_status.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (STATUS_SYNONYMS[normStatus]) {
      if (STATUS_SYNONYMS[normStatus] !== d.diagnosis_status) {
        aliasesUsed.push(`normalized_status:${d.diagnosis_status}->${STATUS_SYNONYMS[normStatus]}`);
      }
      d.diagnosis_status = STATUS_SYNONYMS[normStatus];
    }
  }

  // 10. Normalize `severity` enums carefully (reject arbitrary bogus values!)
  if (typeof d.severity === 'string') {
    const normSev = d.severity.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (SEVERITY_SYNONYMS[normSev]) {
      if (SEVERITY_SYNONYMS[normSev] !== d.severity) {
        aliasesUsed.push(`normalized_severity:${d.severity}->${SEVERITY_SYNONYMS[normSev]}`);
      }
      d.severity = SEVERITY_SYNONYMS[normSev];
    }
  }

  // Normalize `severity_level` if string
  if (typeof d.severity_level === 'string') {
    const normLv = d.severity_level.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['healthy_none', 'low', 'medium', 'high', 'critical', 'unable_to_determine'].includes(normLv)) {
      d.severity_level = normLv;
    } else {
      delete d.severity_level; // allow optional field default rather than rejecting whole scan for optional severity_level mismatch
    }
  }

  // Normalize optional `pathogen_type` and `confidence_category` safely
  if (typeof d.pathogen_type === 'string') {
    const pt = d.pathogen_type.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['fungal', 'bacterial', 'viral', 'pest', 'nutrient_deficiency', 'environmental_stress', 'healthy', 'unknown'].includes(pt)) {
      d.pathogen_type = pt;
    } else {
      d.pathogen_type = 'unknown';
    }
  }

  if (typeof d.confidence_category === 'string') {
    const cc = d.confidence_category.trim().toLowerCase();
    if (['high', 'moderate', 'low', 'uncertain'].includes(cc)) {
      d.confidence_category = cc;
    } else {
      d.confidence_category = 'moderate';
    }
  }

  // 11. Alias confidence -> identification_confidence (without fabricating or accepting bogus types)
  if (d.identification_confidence === undefined && typeof d.confidence === 'number') {
    d.identification_confidence = d.confidence > 1 && d.confidence <= 100 ? Number((d.confidence / 100).toFixed(2)) : d.confidence;
    aliasesUsed.push('alias_confidence_to_identification_confidence');
  } else if (typeof d.identification_confidence === 'number' && d.identification_confidence > 1 && d.identification_confidence <= 100) {
    d.identification_confidence = Number((d.identification_confidence / 100).toFixed(2));
    aliasesUsed.push('scaled_percentage_confidence');
  }

  // Scale percentage confidence (0-100 -> 0-1) inside possible_disease[] and clamp hotspot coordinates cleanly
  if (Array.isArray(d.possible_disease)) {
    d.possible_disease = d.possible_disease
      .filter((item): item is Record<string, unknown> => isPlainObject(item) && typeof item.name === 'string')
      .map((item) => {
        let conf = typeof item.confidence === 'number' ? item.confidence : 0.7;
        if (conf > 1 && conf <= 100) conf = Number((conf / 100).toFixed(2));
        conf = Math.max(0, Math.min(1, conf));
        return {
          ...item,
          name_ur: typeof item.name_ur === 'string' && item.name_ur.trim() ? item.name_ur : String(item.name),
          confidence: conf,
        };
      });
  }

  if (isPlainObject(d.visual_inspection) && Array.isArray(d.visual_inspection.detected_hotspots)) {
    d.visual_inspection.detected_hotspots = d.visual_inspection.detected_hotspots
      .filter((box): box is Record<string, unknown> => isPlainObject(box))
      .map((box) => ({
        ...box,
        x: Math.max(0, Math.min(100, Number(box.x) || 0)),
        y: Math.max(0, Math.min(100, Number(box.y) || 0)),
        w: Math.max(0, Math.min(100, Number(box.w) || 0)),
        h: Math.max(0, Math.min(100, Number(box.h) || 0)),
      }));
  }

  // 12. Normalize optional localized arrays cleanly so minor missing optional subfields don't crash valid scans
  if (Array.isArray(d.observed_symptoms)) d.observed_symptoms = normalizeLocalizedArray(d.observed_symptoms);
  if (Array.isArray(d.possible_causes)) d.possible_causes = normalizeLocalizedArray(d.possible_causes);
  if (Array.isArray(d.possible_co_infections)) {
    d.possible_co_infections = normalizeLocalizedArray(d.possible_co_infections);
  }
  if (Array.isArray(d.recommendations)) d.recommendations = normalizeLocalizedArray(d.recommendations);
  if (Array.isArray(d.what_to_do_now)) d.what_to_do_now = normalizeLocalizedArray(d.what_to_do_now);
  if (Array.isArray(d.prevention)) d.prevention = normalizeLocalizedArray(d.prevention);

  if (isPlainObject(d.treatment_pillars)) {
    const tp = d.treatment_pillars;
    d.treatment_pillars = {
      immediate_actions: normalizeLocalizedArray(tp.immediate_actions),
      short_term_management: normalizeLocalizedArray(tp.short_term_management),
      cultural_management: normalizeLocalizedArray(tp.cultural_management),
      biological_management: normalizeLocalizedArray(tp.biological_management),
      long_term_prevention: normalizeLocalizedArray(tp.long_term_prevention),
      chemical_management: Array.isArray(tp.chemical_management) ? tp.chemical_management : [],
    };
  }

  for (const auxKey of [
    'confidence_limitations',
    'why_suspected',
    'severity_explanation',
    'when_to_consult_expert',
    'voice_script',
    'disease_development_conditions',
    'yield_impact',
    'quality_risk',
    'additional_testing_required',
  ] as const) {
    if (d[auxKey] && !normalizeLocalizedAuxItem(d[auxKey])) {
      delete d[auxKey];
    }
  }

  // Never falsely stop an Auto-Detect scan as a crop mismatch
  if (
    context.selectedCrop.trim().toLowerCase() === 'auto' &&
    d.diagnosis_status === 'crop_mismatch'
  ) {
    d.crop_match = true;
    d.diagnosis_status = d.image_valid === false ? 'invalid_image' : 'uncertain';
    aliasesUsed.push('auto_crop_cleared_mismatch_gate');
  }

  // Handle `crop_mismatch` deterministic stop-gate defaults ONLY when Gemini explicitly flagged crop_mismatch
  // and stopped before emitting downstream diagnosis fields (never fabricating a disease!)
  const isExplicitMismatch =
    d.diagnosis_status === 'crop_mismatch' &&
    typeof d.detected_crop === 'string' &&
    d.detected_crop.trim().length > 0 &&
    d.image_valid !== false;

  if (isExplicitMismatch) {
    const detectedEn = String(d.detected_crop);
    const detectedUr = typeof d.detected_crop_ur === 'string' && d.detected_crop_ur.trim() ? d.detected_crop_ur : detectedEn;
    const partEn = typeof d.detected_plant_part === 'string' && d.detected_plant_part.trim() ? d.detected_plant_part : 'Plant';
    const partUr = typeof d.detected_plant_part_ur === 'string' && d.detected_plant_part_ur.trim() ? d.detected_plant_part_ur : 'پودا';

    if (d.crop_match === undefined) d.crop_match = false;
    if (d.growth_stage === undefined) { d.growth_stage = 'Uncertain'; d.growth_stage_ur = 'معلوم نہیں'; }
    if (d.identification_confidence === undefined) d.identification_confidence = 0.85;
    if (d.plant_condition === undefined) {
      d.plant_condition = 'Not assessed pending crop confirmation';
      d.plant_condition_ur = 'فصل کی تصدیق تک معائنہ روک دیا گیا ہے';
    }
    if (d.problem_name === undefined) {
      d.problem_name = {
        en: 'Crop Mismatch Detected',
        ur: 'فصل کی عدم مطابقت',
        roman_ur: 'Fasal ki adam mutabiqat',
        sd: 'فصل جي غير مطابقت',
      };
    }
    if (d.severity === undefined) d.severity = 'not_assessed';
    if (d.requires_retake === undefined) d.requires_retake = false;
    if (d.requires_expert_review === undefined) d.requires_expert_review = false;
    if (d.message === undefined) {
      d.message = {
        en: `The image appears to show ${detectedEn} (${partEn}), while ${context.selectedCrop} was selected. Please confirm the crop to continue.`,
        ur: `تصویر میں ${detectedUr} (${partUr}) نظر آ رہا ہے، جبکہ آپ نے ${context.selectedCrop} منتخب کی ہے۔ براہِ کرم درست فصل کی تصدیق کریں۔`,
        roman_ur: `Tasveer mein ${detectedEn} nazar araha hai jabke aap ne ${context.selectedCrop} chuni hai. Tasdeeq karein.`,
        sd: `تصوير ۾ ${detectedUr} نظر اچي رهيو آهي، جڏهن ته اوهان ${context.selectedCrop} چونڊيو آهي.`,
      };
    }
  }

  // Handle `invalid_image` (explicitly non-plant photo) ONLY when image_valid === false or diagnosis_status === 'invalid_image'
  const isExplicitInvalidImage =
    (d.image_valid === false || d.diagnosis_status === 'invalid_image') &&
    typeof d.image_valid === 'boolean';

  if (isExplicitInvalidImage && d.image_valid === false) {
    if (d.diagnosis_status === undefined) d.diagnosis_status = 'invalid_image';
    if (d.detected_crop === undefined) { d.detected_crop = 'Non-plant'; d.detected_crop_ur = 'غیر متعلقہ تصویر'; }
    if (d.crop_match === undefined) d.crop_match = false;
    if (d.detected_plant_part === undefined) { d.detected_plant_part = 'None'; d.detected_plant_part_ur = 'کوئی نہیں'; }
    if (d.growth_stage === undefined) { d.growth_stage = 'Uncertain'; d.growth_stage_ur = 'معلوم نہیں'; }
    if (d.identification_confidence === undefined) d.identification_confidence = 0.9;
    if (d.plant_condition === undefined) {
      d.plant_condition = 'The photograph does not show an agricultural plant or crop.';
      d.plant_condition_ur = 'تصویر میں کوئی فصل یا پودا موجود نہیں ہے۔';
    }
    if (d.problem_name === undefined) {
      d.problem_name = {
        en: 'Invalid Plant Image',
        ur: 'پودے کی غیر متعلقہ تصویر',
        roman_ur: 'Poday ki ghair mutaliqa tasveer',
        sd: 'ٻوٽي جي غير لاڳاپيل تصوير',
      };
    }
    if (d.severity === undefined) d.severity = 'not_assessed';
    if (d.requires_retake === undefined) d.requires_retake = true;
    if (d.requires_expert_review === undefined) d.requires_expert_review = false;
    if (d.message === undefined) {
      d.message = {
        en: 'No agricultural plant detected in this photo. Please photograph a real leaf, stem, fruit, or root clearly.',
        ur: 'تصویر میں کوئی فصل یا پودا نظر نہیں آ رہا۔ براہِ کرم اپنی فصل کے پتے، تنے یا پھل کی واضح تصویر لیں۔',
        roman_ur: 'Tasveer mein koi fasal ya poda nazar nahi araha. Asal poday ki saf tasveer lein.',
        sd: 'تصوير ۾ ڪوبه فصل يا ٻوٽو نظر نه پيو اچي. مهرباني ڪري اصل ٻوٽي جي صاف تصوير ڪڍو.',
      };
    }
  }

  // Populate canonical mirror fields (`plant_name`, `plant_part`, metadata) if crop & part strings exist
  if (typeof d.detected_crop === 'string' && d.detected_crop.trim() && !d.plant_name) {
    d.plant_name = {
      en: d.detected_crop.trim(),
      ur: typeof d.detected_crop_ur === 'string' && d.detected_crop_ur.trim() ? d.detected_crop_ur.trim() : d.detected_crop.trim(),
      ...(typeof d.detected_crop_roman_ur === 'string' ? { roman_ur: d.detected_crop_roman_ur } : {}),
      ...(typeof d.detected_crop_sd === 'string' ? { sd: d.detected_crop_sd } : {}),
    };
  }

  if (typeof d.detected_plant_part === 'string' && d.detected_plant_part.trim() && !d.plant_part) {
    d.plant_part = {
      en: d.detected_plant_part.trim(),
      ur: typeof d.detected_plant_part_ur === 'string' && d.detected_plant_part_ur.trim() ? d.detected_plant_part_ur.trim() : d.detected_plant_part.trim(),
      ...(typeof d.detected_plant_part_roman_ur === 'string' ? { roman_ur: d.detected_plant_part_roman_ur } : {}),
      ...(typeof d.detected_plant_part_sd === 'string' ? { sd: d.detected_plant_part_sd } : {}),
    };
  }

  if (!d.scan_timestamp) {
    d.scan_timestamp = new Date().toISOString();
  }
  if (!d.inspection_source) {
    d.inspection_source = context.inspectionSource || 'gemini_vision';
  }
  if (!d.gemini_inspection_status) {
    d.gemini_inspection_status = context.geminiStatus || 'completed';
  }

  if (!d.image_quality_assessment) {
    const q = context.clientQuality;
    d.image_quality_assessment = {
      quality_status: d.image_valid === false ? 'invalid' : q?.isBlurry || q?.isDark ? 'poor' : 'good',
      sharpness: q?.isBlurry ? 'blurry' : 'clear',
      lighting: q?.isDark ? 'dark' : q?.isOverexposed ? 'overexposed' : 'adequate',
      framing: q?.isTooSmall ? 'subject_too_small' : 'adequate',
    };
  }

  // Note: STRICT VALIDATION happens RIGHT HERE.
  // - If severity is an invalid enum string -> rejected.
  // - If requires_retake / requires_expert_review is a string ("true"/"yes") -> rejected (NO invalid boolean coercion).
  // - If problem_name, severity, requires_retake, requires_expert_review, or message is missing on a crop assessment -> rejected!
  const parsed = CropDiagnosisSchema.safeParse(d);
  if (!parsed.success) {
    const fieldErrors = formatZodIssues(parsed.error.issues);
    const missingOrInvalidPaths = fieldErrors.map((f) => `${f.path} (${f.message})`).join(', ');
    return {
      ok: false,
      code: 'ZOD_VALIDATION_FAILED',
      message: `Zod validation error: ${missingOrInvalidPaths}`,
      fieldErrors,
    };
  }

  const diagnosis = parsed.data;

  // CRITICAL AGRICULTURAL INVARIANT:
  // Visible abnormal lesions must NEVER be returned as `healthy_no_symptoms`.
  const inspection = diagnosis.visual_inspection;
  const hasLesions =
    Boolean(inspection?.lesion_detected) ||
    Boolean(inspection?.lesion_count && inspection.lesion_count !== 'none' && inspection.lesion_count !== '0' && inspection.lesion_count !== 'unassessed' && inspection.lesion_count !== 'uncertain') ||
    diagnosis.observed_symptoms.some((s) =>
      /lesion|spot|spindle|dhabba|blast|blight|scorch|chlorosis|necros/i.test(s.en + ' ' + s.ur)
    );

  if (hasLesions && diagnosis.diagnosis_status === 'healthy_no_symptoms') {
    diagnosis.diagnosis_status = 'possible_disease';
    if (diagnosis.severity === 'low') {
      diagnosis.severity = 'medium';
    }
    if (/no obvious|healthy|تندرست/i.test(diagnosis.problem_name.en + ' ' + diagnosis.problem_name.ur)) {
      const isRice = normalizeCropSlug(diagnosis.detected_crop).includes('rice') || diagnosis.detected_crop_ur.includes('دھان');
      diagnosis.problem_name = isRice
        ? {
            en: 'Suspected Rice Leaf Lesions (Blast / Brown Spot Symptoms)',
            ur: 'دھان کے پتے پر مشتبہ دھبے (بلاسٹ یا براؤن سپاٹ کی علامات)',
            roman_ur: 'Dhan ke patte par dhabbe (Blast / Brown Spot alamaat)',
            sd: 'چانورن جي پن تي نشان (بلاست يا ناسي داغ)',
          }
        : {
            en: 'Visible Leaf Lesions Detected (Further Confirmation Required)',
            ur: 'پتے پر مشتبہ دھبے دیکھے گئے (مزید تصدیق درکار)',
            roman_ur: 'Patte par mushtaba dhabbe (Tasdeeq darkaar)',
            sd: 'پن تي نشان نظر آيا (وڌيڪ تصديق گهربل)',
          };
    }
  }

  // Populate fallback recommendations if primary array empty while what_to_do_now or immediate_actions has items
  if (diagnosis.recommendations.length === 0) {
    if (diagnosis.what_to_do_now && diagnosis.what_to_do_now.length > 0) {
      diagnosis.recommendations = diagnosis.what_to_do_now;
    } else if (diagnosis.treatment_pillars?.immediate_actions?.length) {
      diagnosis.recommendations = diagnosis.treatment_pillars.immediate_actions;
    }
  }

  const calibrated = applyClinicalCalibrationAndSafety(diagnosis, {
    clientQuality: context.clientQuality,
    scanMode: context.scanMode,
    imagesCount: context.imagesCount,
    region: context.region,
  });

  return {
    ok: true,
    data: calibrated,
    normalizedAliases: aliasesUsed,
  };
}

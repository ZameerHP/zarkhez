import type { ImageQualityReport } from '../image-quality';
import type { CropDiagnosis, ProblemCategory } from '../schemas';
import { getVerifiedScientificReferences } from './knowledge-base';

export const ZARKHEZ_VISION_MODEL_VERSION = 'zarkhez-vision-v2.4-cloud';

/**
 * WHO Class Ia / Ib and strictly banned/restricted active ingredients in Pakistan
 * or unverified hazardous chemistry that Zarkhez will NEVER recommend in chemical_management.
 */
const PROHIBITED_CHEMICAL_PATTERN =
  /\b(monocrotophos|endosulfan|methamidophos|methyl[\s-]?parathion|ethyl[\s-]?parathion|phorate|carbofuran|aldicarb|phosphamidon|ddt|lindane|heptachlor|chlordane|aldrin|dieldrin|toxaphene|endrin|mirex|pentachlorophenol|triazophos|captafol|binapacryl|chlordecone)\b/i;

function inferProblemCategory(diagnosis: CropDiagnosis): ProblemCategory {
  if (diagnosis.problem_category) return diagnosis.problem_category;

  const text = [
    diagnosis.problem_name?.en,
    diagnosis.plant_condition,
    diagnosis.scientific_name,
    diagnosis.why_suspected?.en,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (diagnosis.diagnosis_status === 'invalid_image' || diagnosis.image_valid === false) {
    return 'unidentified_or_non_crop';
  }
  if (diagnosis.diagnosis_status === 'healthy_no_symptoms' || diagnosis.pathogen_type === 'healthy') {
    return 'healthy';
  }
  if (/herbicide|2,4-d|glyphosate|chemical drift|phytotoxic|spray burn/.test(text)) {
    return 'chemical_herbicide_injury';
  }
  if (/salin|salt burn|alkalin|sodicity/.test(text)) return 'soil_salinity';
  if (/frost|cold|freeze|chilling/.test(text)) return 'cold_frost_damage';
  if (/sunburn|sunscald|solar/.test(text)) return 'sunburn';
  if (/heat stress|scorch/.test(text) && diagnosis.diagnosis_status === 'environmental_stress') {
    return 'heat_stress';
  }
  if (/drought|waterlogging|hypoxia|overwater|underwater|moisture stress/.test(text)) {
    return 'water_stress';
  }
  if (/nematode|root-knot|meloidogyne/.test(text)) return 'nematode_root';
  if (/stored|storage|post-harvest|aflatoxin|storage mould/.test(text)) return 'post_harvest_storage';
  if (/mechanical|hail|wind tear|bruise|physical/.test(text)) return 'mechanical_physical_damage';
  if (/toxicity|excess nitrogen|boron toxicity|fertilizer burn/.test(text)) return 'nutrient_toxicity';

  if (diagnosis.pathogen_type === 'fungal') return 'fungal_infection';
  if (diagnosis.pathogen_type === 'bacterial') return 'bacterial_infection';
  if (diagnosis.pathogen_type === 'viral') return 'viral_infection';
  if (diagnosis.pathogen_type === 'pest' || diagnosis.diagnosis_status === 'possible_pest') {
    return 'insect_pest';
  }
  if (
    diagnosis.pathogen_type === 'nutrient_deficiency' ||
    diagnosis.diagnosis_status === 'possible_nutrient_deficiency'
  ) {
    return 'nutrient_deficiency';
  }
  if (
    diagnosis.pathogen_type === 'environmental_stress' ||
    diagnosis.diagnosis_status === 'environmental_stress'
  ) {
    return 'environmental_stress';
  }
  if (diagnosis.diagnosis_status === 'uncertain') return 'unidentified_or_non_crop';
  return 'fungal_infection';
}

export interface CalibrationOptions {
  clientQuality?: ImageQualityReport;
  scanMode?: 'single_plant' | 'whole_field';
  imagesCount?: number;
  region?: string;
}

/**
 * Enforces scientific humility, calibrated confidence ceilings under poor lighting/blur,
 * chemical safety blocklists, single-leaf vs field scoping, and curated references.
 */
export function applyClinicalCalibrationAndSafety(
  diagnosis: CropDiagnosis,
  opts: CalibrationOptions = {}
): CropDiagnosis {
  const quality = opts.clientQuality;
  const imagesCount = Math.max(1, opts.imagesCount ?? 1);
  const scanMode = opts.scanMode || diagnosis.field_assessment?.mode || 'single_plant';

  const rawModelConf = Math.max(0, Math.min(1, Number(diagnosis.identification_confidence) || 0));

  // 1. Visual evidence quality evaluation
  let evidenceQuality: 'high' | 'moderate' | 'poor' | 'insufficient' = 'high';
  if (!diagnosis.image_valid || diagnosis.inspection_source === 'offline_assessment') {
    evidenceQuality = 'insufficient';
  } else if (quality?.isBlurry || (quality?.subjectRatio !== undefined && quality.subjectRatio < 0.08)) {
    evidenceQuality = 'poor';
  } else if (quality?.isDark || quality?.isOverexposed || quality?.isTooSmall) {
    evidenceQuality = 'moderate';
  } else if (diagnosis.diagnosis_status === 'uncertain') {
    evidenceQuality = 'moderate';
  }

  // 2. Deterministic Confidence Calibration Ceiling (visual AI can NEVER reach 100% lab proof)
  let ceiling = 0.92;
  if (imagesCount >= 2 && evidenceQuality === 'high') {
    ceiling = 0.94;
  }
  const calibrationReasonsEn: string[] = [];
  const calibrationReasonsUr: string[] = [];

  if (evidenceQuality === 'insufficient') {
    ceiling = diagnosis.image_valid === false ? 0.9 : 0.35;
    if (diagnosis.inspection_source === 'offline_assessment') {
      ceiling = 0;
    }
  }
  if (quality?.isBlurry) {
    ceiling = Math.min(ceiling, 0.56);
    calibrationReasonsEn.push('blurry focus lowered diagnostic certainty');
    calibrationReasonsUr.push('تصویر دھندلی ہونے کے باعث تشخیصی یقین کو محدود رکھا گیا ہے');
  }
  if (quality?.isDark) {
    ceiling = Math.min(ceiling, 0.64);
    calibrationReasonsEn.push('low light obscures lesion margins');
    calibrationReasonsUr.push('کم روشنی میں دھبوں کے کنارے واضح نہ ہونے پر اعتماد کم کیا گیا ہے');
  }
  if (quality?.isOverexposed) {
    ceiling = Math.min(ceiling, 0.64);
    calibrationReasonsEn.push('bright glare reduces subtle color accuracy');
    calibrationReasonsUr.push('تیز چمک کی وجہ سے رنگوں کا فرق محدود ہے');
  }
  if (quality?.isTooSmall) {
    ceiling = Math.min(ceiling, 0.66);
    calibrationReasonsEn.push('small subject framing limits fine tissue inspection');
    calibrationReasonsUr.push('پودے کا حصہ دور ہونے کی وجہ سے باریک علامات واضح نہیں');
  }

  const cropUnknown = /unknown|unidentified|uncertain|غیر یقینی|نامعلوم/i.test(
    diagnosis.detected_crop || ''
  );
  if (cropUnknown && diagnosis.image_valid) {
    ceiling = Math.min(ceiling, 0.62);
    calibrationReasonsEn.push('unidentified crop species requires confirmation');
    calibrationReasonsUr.push('فصل کی قسم واضح نہ ہونے کی وجہ سے تصدیق درکار ہے');
  }

  const calibratedCertainty =
    diagnosis.inspection_source === 'offline_assessment'
      ? 0
      : Number(Math.min(rawModelConf, ceiling).toFixed(2));

  diagnosis.identification_confidence = calibratedCertainty;

  if (calibratedCertainty < 0.45 || diagnosis.diagnosis_status === 'uncertain') {
    diagnosis.confidence_category = 'uncertain';
  } else if (calibratedCertainty < 0.68) {
    diagnosis.confidence_category = 'low';
  } else if (calibratedCertainty < 0.84) {
    diagnosis.confidence_category = 'moderate';
  } else {
    diagnosis.confidence_category = 'high';
  }

  // Never keep requires_expert_review=false on low-certainty diseased/uncertain/critical cases
  if (
    diagnosis.image_valid &&
    diagnosis.diagnosis_status !== 'healthy_no_symptoms' &&
    diagnosis.diagnosis_status !== 'crop_mismatch' &&
    (calibratedCertainty < 0.65 || diagnosis.severity === 'high' || diagnosis.severity_level === 'critical')
  ) {
    diagnosis.requires_expert_review = true;
  }

  const altProb =
    diagnosis.possible_disease && diagnosis.possible_disease.length > 1
      ? Math.min(0.9, Math.max(0, Number(diagnosis.possible_disease[1]?.confidence) || 0))
      : 0;

  diagnosis.confidence_breakdown = {
    model_confidence: Number(rawModelConf.toFixed(2)),
    diagnostic_certainty: calibratedCertainty,
    visual_evidence_quality: evidenceQuality,
    alternative_top_probability: Number(altProb.toFixed(2)),
    lab_confirmation_status: 'unconfirmed_visual_screening',
    calibration_note: {
      en:
        calibrationReasonsEn.length > 0
          ? `Visual AI screening score (${Math.round(rawModelConf * 100)}%) calibrated to ${Math.round(
              calibratedCertainty * 100
            )}% certainty because ${calibrationReasonsEn.join('; ')}. Not equivalent to laboratory confirmation.`
          : 'Calibrated visual screening certainty only — never substitutes for microscopic spore or PCR laboratory confirmation.',
      ur:
        calibrationReasonsUr.length > 0
          ? `${calibrationReasonsUr.join('؛ ')}۔ بصری معائنہ لیبارٹری تصدیق کا متبادل نہیں ہے۔`
          : 'یہ صرف بصری اے آئی معائنے کا اعتماد ہے، لیبارٹری یا ماہرِ زراعت کی حتمی تصدیق کا متبادل نہیں۔',
    },
  };

  // 3. Enforce 19-category tagging & verified references
  diagnosis.problem_category = inferProblemCategory(diagnosis);
  diagnosis.model_version = ZARKHEZ_VISION_MODEL_VERSION;
  diagnosis.scientific_references = getVerifiedScientificReferences({
    crop: diagnosis.detected_crop,
    problemCategory: diagnosis.problem_category,
    pathogenType: diagnosis.pathogen_type,
  });

  // 4. Prohibited Chemical Guardrail + Mandatory Safety / PHI Precautions
  const safetyNotes = [...(diagnosis.safety_guardrail_notes || [])];
  if (diagnosis.treatment_pillars?.chemical_management?.length) {
    const safeChemicals = [];
    for (const item of diagnosis.treatment_pillars.chemical_management) {
      const combined = `${item.active_ingredient} ${item.purpose.en} ${item.safety_precautions.en}`;
      if (PROHIBITED_CHEMICAL_PATTERN.test(combined)) {
        safetyNotes.push({
          en: `Blocked high-hazard/restricted compound reference (${item.active_ingredient}). Consult your district Agriculture Extension Officer for locally registered safer alternatives.`,
          ur: `انتہائی زہریلی یا پابندی شدہ دوا (${item.active_ingredient}) کو حفاظتی فلٹر کے تحت ہٹا دیا گیا ہے۔ محفوظ اور رجسٹرڈ متبادل کے لیے محکمہ زراعت کے مقامی افسر سے مشورہ کریں۔`,
        });
        diagnosis.requires_expert_review = true;
        continue;
      }

      const safetyEn = item.safety_precautions.en;
      const hasPhiOrLabel = /label|phi|pre-harvest|protective|glove|mask|extension/i.test(safetyEn);
      safeChemicals.push({
        ...item,
        safety_precautions: hasPhiOrLabel
          ? item.safety_precautions
          : {
              en: `${safetyEn} Follow local registered product label dose, pre-harvest interval (PHI), and wear gloves/mask.`,
              ur: `${item.safety_precautions.ur} ہمیشہ منظور شدہ پیکٹ لیبل، کٹائی سے قبل وقفہ اور دستانے/ماسک کی پابندی کریں۔`,
            },
      });
    }
    diagnosis.treatment_pillars.chemical_management = safeChemicals;
  }
  diagnosis.safety_guardrail_notes = safetyNotes;

  // 5. Enforce Single-Leaf vs Whole-Field Scoping Boundary (#13)
  if (scanMode === 'single_plant' || imagesCount === 1) {
    diagnosis.field_assessment = {
      mode: 'single_plant',
      images_analyzed: 1,
      countable_affected_plants: 'Single photographed sample only',
      distribution_pattern: 'Cannot assess whole-field distribution from 1 image',
      scope_summary: diagnosis.severity_scope?.scope_note || {
        en: 'Single plant/organ scan only. Upload multiple field-wide angles in Whole Field Mode or scout 20+ plants in an X-pattern before estimating field area affected.',
        ur: 'یہ نتیجہ صرف اس ایک پودے یا تصویر کا ہے۔ پورے کھیت کے نقصان کا اندازہ لگانے کے لیے کم از کم 20 پودوں یا مختلف جگہوں کی مزید تصاویر اسکین کریں۔',
      },
    };
  } else {
    diagnosis.field_assessment = {
      mode: 'whole_field',
      images_analyzed: imagesCount,
      countable_affected_plants:
        diagnosis.field_assessment?.countable_affected_plants || `${imagesCount} field frames inspected`,
      distribution_pattern:
        diagnosis.field_assessment?.distribution_pattern || 'Multi-spot field sampling analyzed',
      estimated_field_spread_pct: diagnosis.field_assessment?.estimated_field_spread_pct,
      scope_summary: diagnosis.field_assessment?.scope_summary || {
        en: `Whole-field multi-photo assessment reviewed ${imagesCount} field photographs together. Confirm border-to-center incidence physically across at least 20 plants before spraying.`,
        ur: `کھیت کی مجموعی صورتحال کا جائزہ ${imagesCount} مختلف تصاویر کی بنیاد پر لیا گیا ہے۔ پورے کھیت پر سپرے سے قبل کناروں اور وسط میں کم از کم 20 پودے چیک کریں۔`,
      },
    };
  }

  return diagnosis;
}

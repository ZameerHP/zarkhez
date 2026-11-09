import { z } from 'zod';

export const LocalizedStringSchema = z.object({
  en: z.string().min(1),
  ur: z.string().min(1),
  roman_ur: z.string().optional(),
  sd: z.string().optional(),
});

export type LocalizedString = z.infer<typeof LocalizedStringSchema>;
export type AppLang = 'ur' | 'en' | 'roman_ur' | 'sd';

export function getLocalizedText(
  item: LocalizedString | undefined | null,
  lang: AppLang,
  fallback = ''
): string {
  if (!item) return fallback;
  if (lang === 'roman_ur') return item.roman_ur || item.ur || item.en || fallback;
  if (lang === 'sd') return item.sd || item.ur || item.en || fallback;
  if (lang === 'en') return item.en || item.ur || fallback;
  return item.ur || item.en || fallback;
}

export const AdviceSchema = z.object({
  problem_name: LocalizedStringSchema,
  plant_name: LocalizedStringSchema.optional(),
  organ: LocalizedStringSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  severity: z.enum(['low', 'medium', 'high']),
  summary: LocalizedStringSchema,
  steps: z.array(LocalizedStringSchema).min(1).max(6),
  prevention: z.array(LocalizedStringSchema).min(1).max(5),
  see_expert: z.boolean(),
  expert_reason: LocalizedStringSchema.optional(),
});

export type Advice = z.infer<typeof AdviceSchema>;

export const AdviceRequestSchema = z.object({
  label: z.string().min(1).max(100).optional().default('unclear'),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  crop: z.string().min(1).max(50).optional().default('general'),
  image: z.string().max(4_000_000).optional(),
});

export const PossibleDiseaseItemSchema = z.object({
  name: z.string(),
  name_ur: z.string(),
  name_roman_ur: z.string().optional().default(''),
  name_sd: z.string().optional().default(''),
  confidence: z.number().min(0).max(1),
  is_primary: z.boolean().optional().default(false),
});

export const AlternativeDiagnosisSchema = z.object({
  name: z.string(),
  reason: LocalizedStringSchema,
});

export const VisualInspectionSchema = z.object({
  lesion_detected: z.boolean().default(false),
  lesion_count: z.string().default('none'),
  lesion_shape: z.string().default('none'),
  lesion_colors: z.array(z.string()).default([]),
  lesion_margins: z.string().default('none'),
  lesion_distribution: z.string().default('none'),
  tissue_damage: z.string().default('none'),
});

export type VisualInspection = z.infer<typeof VisualInspectionSchema>;

export const CropDiagnosisSchema = z.object({
  image_valid: z.boolean(),
  detected_crop: z.string(),
  detected_crop_ur: z.string(),
  detected_crop_roman_ur: z.string().optional().default(''),
  detected_crop_sd: z.string().optional().default(''),
  selected_crop: z.string(),
  crop_match: z.boolean(),
  detected_plant_part: z.string(),
  detected_plant_part_ur: z.string(),
  detected_plant_part_roman_ur: z.string().optional().default(''),
  detected_plant_part_sd: z.string().optional().default(''),
  growth_stage: z.string(),
  growth_stage_ur: z.string(),
  growth_stage_roman_ur: z.string().optional().default(''),
  growth_stage_sd: z.string().optional().default(''),
  identification_confidence: z.number().min(0).max(1),
  visual_inspection: VisualInspectionSchema.optional().default({
    lesion_detected: false,
    lesion_count: 'none',
    lesion_shape: 'none',
    lesion_colors: [],
    lesion_margins: 'none',
    lesion_distribution: 'none',
    tissue_damage: 'none',
  }),
  diagnosis_status: z.enum([
    'healthy_no_symptoms',
    'possible_disease',
    'possible_pest',
    'possible_nutrient_deficiency',
    'environmental_stress',
    'uncertain',
    'crop_mismatch',
    'invalid_image',
  ]),
  plant_condition: z.string(),
  plant_condition_ur: z.string(),
  plant_condition_roman_ur: z.string().optional().default(''),
  plant_condition_sd: z.string().optional().default(''),
  problem_name: LocalizedStringSchema,
  possible_disease: z.array(PossibleDiseaseItemSchema).default([]),
  alternative_diagnoses: z.array(AlternativeDiagnosisSchema).optional().default([]),
  why_suspected: LocalizedStringSchema.optional().default({
    en: 'Based on visual inspection of foliage and symptom patterns.',
    ur: 'پودے کے پتے کے تفصیلی بصری معائنے اور علامات کی بنا پر۔',
    roman_ur: 'Pattay ke basri muainay aur alamaat ki bunyad par.',
    sd: 'ٻوٽي جي پن جي معائني ۽ نشانن جي بنياد تي.',
  }),
  observed_symptoms: z.array(LocalizedStringSchema).default([]),
  possible_causes: z.array(LocalizedStringSchema).default([]),
  severity: z.enum(['low', 'medium', 'high', 'not_assessed']),
  severity_explanation: LocalizedStringSchema.optional().default({
    en: 'Evaluated from lesion extent and risk to foliage.',
    ur: 'دھبوں کے سائز، پھیلاؤ اور پتے کو خطرے کی بنیاد پر جائزہ۔',
    roman_ur: 'Dhabbun ke phailao aur nuqsan ka andaza.',
    sd: 'نشانن جي پکيڙ جي بنياد تي اندازو.',
  }),
  recommendations: z.array(LocalizedStringSchema).default([]),
  what_to_do_now: z.array(LocalizedStringSchema).optional().default([]),
  prevention: z.array(LocalizedStringSchema).default([]),
  when_to_consult_expert: LocalizedStringSchema.optional().default({
    en: 'Consult local agricultural extension officer if symptoms spread or worsen.',
    ur: 'اگر علامات میں اضافہ ہو یا پھیلاؤ بڑھے تو فوراً مقامی زرعی توسیعی افسر سے تصدیق کروائیں۔',
    roman_ur: 'Agar alamaat barhein to foran muqami zaria afsar se rabta karein.',
    sd: 'جيڪڏهن بيماري پکڙجي ته فوري طور مقامي زرعي عملدار سان رابطو ڪريو.',
  }),
  requires_retake: z.boolean(),
  requires_expert_review: z.boolean(),
  message: LocalizedStringSchema,
});

export type CropDiagnosis = z.infer<typeof CropDiagnosisSchema>;

export const CropAnalysisRequestSchema = z.object({
  image: z.string().min(20).max(6_000_000),
  selectedCrop: z.string().min(1).max(50),
  confirmMismatchOverride: z.boolean().optional().default(false),
  clientQuality: z.any().optional(),
  apiKey: z.string().optional(),
});

export type CropAnalysisRequest = z.infer<typeof CropAnalysisRequestSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
});

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(20),
  context: z
    .object({
      farmerName: z.string().max(100).optional(),
      farmerId: z.string().max(50).optional(),
      crop: z.string().max(60).optional(),
      region: z.string().max(100).optional(),
      stage: z.string().max(100).optional(),
      weatherSummary: z.string().max(300).optional(),
    })
    .optional(),
  lang: z.enum(['en', 'ur']).default('ur'),
});

export const VerifyImageRequestSchema = z.object({
  image: z.string().min(20).max(1_800_000),
  crop: z.string().min(1).max(50),
  label: z.string().min(1).max(100).optional(),
});

export const SecondOpinionSchema = z.object({
  is_clear_leaf: z.boolean(),
  agrees_with_model: z.boolean(),
  suggested_label: z.string(),
  visible_symptoms: LocalizedStringSchema,
  recommendation: LocalizedStringSchema,
});

export type SecondOpinion = z.infer<typeof SecondOpinionSchema>;

export const WeatherQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export const GeocodeQuerySchema = z.object({
  q: z.string().min(2).max(100),
});

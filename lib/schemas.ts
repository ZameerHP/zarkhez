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
  item: LocalizedString | string | undefined | null,
  lang: AppLang,
  fallback = ''
): string {
  if (!item) return fallback;
  if (typeof item === 'string') return item || fallback;
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

export const HotspotBoxSchema = z.object({
  x: z.number().min(0).max(100), // percentage coordinates (0-100)
  y: z.number().min(0).max(100),
  w: z.number().min(0).max(100),
  h: z.number().min(0).max(100),
  label: z.string().optional().default('Lesion'),
});
export type HotspotBox = z.infer<typeof HotspotBoxSchema>;

export const DifferentialDiagnosisSchema = z.object({
  name: z.string(),
  scientific_name: z.string().optional().default(''),
  similarities: LocalizedStringSchema,
  differences: LocalizedStringSchema,
  likelihood: z.enum(['less_likely', 'possible_coinfection', 'unlikely']).default('less_likely'),
  field_distinction_tip: LocalizedStringSchema,
});
export type DifferentialDiagnosis = z.infer<typeof DifferentialDiagnosisSchema>;

export const ChemicalRecommendationSchema = z.object({
  active_ingredient: z.string(),
  purpose: LocalizedStringSchema,
  safety_precautions: LocalizedStringSchema,
});
export type ChemicalRecommendation = z.infer<typeof ChemicalRecommendationSchema>;

export const TreatmentPillarsSchema = z.object({
  immediate_actions: z.array(LocalizedStringSchema).default([]),
  cultural_management: z.array(LocalizedStringSchema).default([]),
  biological_management: z.array(LocalizedStringSchema).default([]),
  chemical_management: z.array(ChemicalRecommendationSchema).default([]),
});
export type TreatmentPillars = z.infer<typeof TreatmentPillarsSchema>;

export const VisualInspectionSchema = z.object({
  lesion_detected: z.boolean().default(false),
  lesion_count: z.string().default('none'),
  lesion_shape: z.string().default('none'),
  lesion_size_est: z.string().optional().default('none'),
  lesion_colors: z.array(z.string()).default([]),
  lesion_margins: z.string().default('none'),
  lesion_distribution: z.string().default('none'),
  tissue_damage: z.string().default('none'),
  chlorosis_detected: z.boolean().optional().default(false),
  necrosis_detected: z.boolean().optional().default(false),
  wilting_detected: z.boolean().optional().default(false),
  affected_area_pct: z.number().min(0).max(100).optional().default(0),
  detected_hotspots: z.array(HotspotBoxSchema).optional().default([]),
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
    lesion_size_est: 'none',
    lesion_colors: [],
    lesion_margins: 'none',
    lesion_distribution: 'none',
    tissue_damage: 'none',
    chlorosis_detected: false,
    necrosis_detected: false,
    wilting_detected: false,
    affected_area_pct: 0,
    detected_hotspots: [],
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
  scientific_name: z.string().optional().default(''),
  pathogen_type: z.enum([
    'fungal',
    'bacterial',
    'viral',
    'pest',
    'nutrient_deficiency',
    'environmental_stress',
    'healthy',
    'unknown',
  ]).optional().default('unknown'),
  confidence_category: z.enum(['high', 'moderate', 'low', 'uncertain']).optional().default('moderate'),
  confidence_limitations: LocalizedStringSchema.optional().default({
    en: 'Visual AI inspection cannot replace laboratory microscopic spore analysis or fungal culture.',
    ur: 'بصری اے آئی معائنہ خوردبینی جراثیمی تجزیے یا لیبارٹری ٹیسٹ کا متبادل نہیں ہے۔',
    roman_ur: 'Basri AI muaina laboratory microscopic test ka mutabadil nahi hai.',
    sd: 'بصري اي آءِ معائنو ليبارٽري ٽيسٽ جو متبادل ناهي.',
  }),
  plant_condition: z.string(),
  plant_condition_ur: z.string(),
  plant_condition_roman_ur: z.string().optional().default(''),
  plant_condition_sd: z.string().optional().default(''),
  problem_name: LocalizedStringSchema,
  possible_disease: z.array(PossibleDiseaseItemSchema).default([]),
  alternative_diagnoses: z.array(AlternativeDiagnosisSchema).optional().default([]),
  differential_diagnoses: z.array(DifferentialDiagnosisSchema).optional().default([]),
  why_suspected: LocalizedStringSchema.optional().default({
    en: 'Based on visual inspection of foliage and symptom patterns.',
    ur: 'پودے کے پتے کے تفصیلی بصری معائنے اور علامات کی بنا پر۔',
    roman_ur: 'Pattay ke basri muainay aur alamaat ki bunyad par.',
    sd: 'ٻوٽي جي پن جي معائني ۽ نشانن جي بنياد تي.',
  }),
  observed_symptoms: z.array(LocalizedStringSchema).default([]),
  possible_causes: z.array(LocalizedStringSchema).default([]),
  severity: z.enum(['low', 'medium', 'high', 'not_assessed']),
  severity_level: z.enum([
    'healthy_none',
    'low',
    'medium',
    'high',
    'critical',
    'unable_to_determine',
  ]).optional().default('low'),
  severity_explanation: LocalizedStringSchema.optional().default({
    en: 'Evaluated from lesion extent and risk to foliage.',
    ur: 'دھبوں کے سائز، پھیلاؤ اور پتے کو خطرے کی بنیاد پر جائزہ۔',
    roman_ur: 'Dhabbun ke phailao aur nuqsan ka andaza.',
    sd: 'نشانن جي پکيڙ جي بنياد تي اندازو.',
  }),
  severity_scope: z.object({
    leaf_affected_pct: z.number().min(0).max(100).optional().default(0),
    scope_note: LocalizedStringSchema.optional().default({
      en: 'Assessment reflects only this photographed leaf. Scout 20+ plants in an X-pattern to estimate field-level spread.',
      ur: 'یہ اندازہ صرف اس پتے کا ہے۔ پورے کھیت کے نقصان کا پتہ لگانے کے لیے کم از کم 20 پودوں کا معائنہ کریں۔',
      roman_ur: 'Yeh andaza sirf is patte ka hai. Pure khet ka andaza lagane ke liye 20 podon ka muaina karein.',
      sd: 'هي اندازو صرف هن پن جو آهي. پوري ٻنيءَ جي اندازي لاءِ 20 ٻوٽن جي چڪاس ڪريو.',
    }),
  }).optional().default({
    leaf_affected_pct: 0,
    scope_note: {
      en: 'Assessment reflects only this photographed leaf. Scout 20+ plants in an X-pattern to estimate field-level spread.',
      ur: 'یہ اندازہ صرف اس پتے کا ہے۔ پورے کھیت کے نقصان کا پتہ لگانے کے لیے کم از کم 20 پودوں کا معائنہ کریں۔',
      roman_ur: 'Yeh andaza sirf is patte ka hai. Pure khet ka andaza lagane ke liye 20 podon ka muaina karein.',
      sd: 'هي اندازو صرف هن پن جو آهي. پوري ٻنيءَ جي اندازي لاءِ 20 ٻوٽن جي چڪاس ڪريو.',
    },
  }),
  recommendations: z.array(LocalizedStringSchema).default([]),
  what_to_do_now: z.array(LocalizedStringSchema).optional().default([]),
  treatment_pillars: TreatmentPillarsSchema.optional().default({
    immediate_actions: [],
    cultural_management: [],
    biological_management: [],
    chemical_management: [],
  }),
  prevention: z.array(LocalizedStringSchema).default([]),
  when_to_consult_expert: LocalizedStringSchema.optional().default({
    en: 'Consult local agricultural extension officer if symptoms spread or worsen.',
    ur: 'اگر علامات میں اضافہ ہو یا پھیلاؤ بڑھے تو فوراً مقامی زرعی توسیعی افسر سے تصدیق کروائیں۔',
    roman_ur: 'Agar alamaat barhein to foran muqami zaria afsar se rabta karein.',
    sd: 'جيڪڏهن بيماري پکڙجي ته فوري طور مقامي زرعي عملدار سان رابطو ڪريو.',
  }),
  explanations: z.object({
    farmer_friendly: LocalizedStringSchema,
    scientific: LocalizedStringSchema,
  }).optional().default({
    farmer_friendly: {
      en: 'Inspect your crop closely and follow sanitation practices.',
      ur: 'اپنی فصل کا باقاعدگی سے معائنہ کریں اور کھیت کی صفائی کا خیال رکھیں۔',
      roman_ur: 'Apni fasal ka baqaidgi se muaina karein aur khet saf rakhein.',
      sd: 'پنهنجي فصل جو باقاعدي معائنو ڪريو.',
    },
    scientific: {
      en: 'Foliar pathology assessment based on observable macroscopic tissue alterations.',
      ur: 'پتے کے بافتی بگاڑ اور علامات کے مشاہدے پر مبنی زرعی تجزیہ۔',
      roman_ur: 'Patte ke bafti bigar par mabni zaria tajzia.',
      sd: 'پن جي تاندورن جي بگاڙ تي ٻڌل زرعي تجزيو.',
    },
  }),
  voice_script: LocalizedStringSchema.optional().default({
    en: 'Diagnosis completed. Please check your recommendations.',
    ur: 'معائنہ مکمل ہو گیا ہے۔ تفصیلی تجاویز نیچے ملاحظہ فرمائیں۔',
    roman_ur: 'Muaina mukammal ho gaya hai. Tajaveez neeche dekhein.',
    sd: 'معائنو مڪمل ٿي ويو. تجويزون هيٺ ڏسو.',
  }),
  requires_retake: z.boolean(),
  requires_expert_review: z.boolean(),
  message: LocalizedStringSchema,
  plant_name: LocalizedStringSchema.optional(),
  plant_part: LocalizedStringSchema.optional(),
  image_quality_assessment: z
    .object({
      quality_status: z.enum(['good', 'fair', 'poor', 'invalid']).default('good'),
      sharpness: z.string().optional().default('clear'),
      lighting: z.string().optional().default('adequate'),
      framing: z.string().optional().default('adequate'),
      notes: LocalizedStringSchema.optional(),
    })
    .optional(),
  inspection_source: z
    .enum(['gemini_vision', 'offline_assessment', 'hybrid'])
    .optional()
    .default('gemini_vision'),
  gemini_inspection_status: z
    .enum(['completed', 'partial', 'failed', 'not_run'])
    .optional()
    .default('completed'),
  scan_timestamp: z.string().optional(),
});

export type CropDiagnosis = z.infer<typeof CropDiagnosisSchema>;

export const ScanErrorCategorySchema = z.enum([
  'network_or_timeout',
  'rate_limited',
  'quota_exhausted',
  'temporary_service_failure',
  'permanent_config_error',
  'invalid_image_input',
  'malformed_ai_response',
  'schema_validation_failed',
]);

export type ScanErrorCategory = z.infer<typeof ScanErrorCategorySchema>;

/**
 * Customer-safe public error payload returned to browser clients.
 * Strictly excludes internal error codes, Zod paths, stack traces, and diagnostic text.
 */
export const PublicScanErrorSchema = z.object({
  error: z.literal('structured_scan_error'),
  request_id: z.string().optional(),
  error_category: ScanErrorCategorySchema,
  retryable: z.boolean(),
  user_message: LocalizedStringSchema,
});

export type PublicScanError = z.infer<typeof PublicScanErrorSchema>;

export const CropAnalysisRequestSchema = z.object({
  image: z.string().min(20).max(5_000_000),
  selectedCrop: z.string().min(1).max(50),
  confirmMismatchOverride: z.boolean().optional().default(false),
  clientQuality: z.any().optional(),
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
  voiceLang: z.enum(['ur', 'sd', 'en']).optional(),
  voiceMode: z.boolean().optional().default(false),
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

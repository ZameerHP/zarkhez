import { z } from 'zod';

export const LocalizedStringSchema = z.object({
  en: z.string().min(1),
  ur: z.string().min(1),
});

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
  confidence: z.number().min(0).max(1),
});

export const CropDiagnosisSchema = z.object({
  image_valid: z.boolean(),
  detected_crop: z.string(),
  detected_crop_ur: z.string(),
  selected_crop: z.string(),
  crop_match: z.boolean(),
  detected_plant_part: z.string(),
  detected_plant_part_ur: z.string(),
  growth_stage: z.string(),
  growth_stage_ur: z.string(),
  identification_confidence: z.number().min(0).max(1),
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
  problem_name: LocalizedStringSchema,
  possible_disease: z.array(PossibleDiseaseItemSchema).default([]),
  observed_symptoms: z.array(LocalizedStringSchema).default([]),
  possible_causes: z.array(LocalizedStringSchema).default([]),
  severity: z.enum(['low', 'medium', 'high', 'not_assessed']),
  recommendations: z.array(LocalizedStringSchema).default([]),
  prevention: z.array(LocalizedStringSchema).default([]),
  requires_retake: z.boolean(),
  requires_expert_review: z.boolean(),
  message: LocalizedStringSchema,
});

export type CropDiagnosis = z.infer<typeof CropDiagnosisSchema>;

export const CropAnalysisRequestSchema = z.object({
  image: z.string().min(20).max(6_000_000),
  selectedCrop: z.string().min(1).max(50),
  confirmMismatchOverride: z.boolean().optional().default(false),
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

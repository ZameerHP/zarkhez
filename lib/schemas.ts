import { z } from 'zod';

export const LocalizedStringSchema = z.object({
  en: z.string().min(1),
  ur: z.string().min(1),
});

export const AdviceSchema = z.object({
  problem_name: LocalizedStringSchema,
  severity: z.enum(['low', 'medium', 'high']),
  summary: LocalizedStringSchema,
  steps: z.array(LocalizedStringSchema).min(1).max(6),
  prevention: z.array(LocalizedStringSchema).min(1).max(5),
  see_expert: z.boolean(),
  expert_reason: LocalizedStringSchema.optional(),
});

export type Advice = z.infer<typeof AdviceSchema>;

export const AdviceRequestSchema = z.object({
  label: z.string().min(1).max(100),
  confidence: z.number().min(0).max(1),
  crop: z.string().min(1).max(50),
});

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

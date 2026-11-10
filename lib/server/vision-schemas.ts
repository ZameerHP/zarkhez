import { z } from 'zod';
import {
  LocalizedStringSchema,
  ScanErrorCategorySchema,
} from '../schemas';

export const FieldValidationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  expected: z.string().optional(),
  received: z.string().optional(),
  message: z.string(),
});

export type FieldValidationIssue = z.infer<typeof FieldValidationIssueSchema>;

export const StructuredScanErrorSchema = z.object({
  error: z.literal('structured_scan_error'),
  error_category: ScanErrorCategorySchema,
  code: z.string(),
  retryable: z.boolean(),
  user_message: LocalizedStringSchema,
  technical_summary: z.string(),
  field_errors: z.array(FieldValidationIssueSchema).optional(),
});

export type StructuredScanError = z.infer<typeof StructuredScanErrorSchema>;

const GEMINI_LOCALIZED_SCHEMA = {
  type: 'OBJECT',
  properties: {
    en: { type: 'STRING' },
    ur: { type: 'STRING' },
  },
  required: ['en', 'ur'],
};

/**
 * Official Vision OpenAPI 3.0 Response Schema matching CropDiagnosisSchema 1:1.
 * Kept strictly server-side so internal schema structures never ship in browser bundles.
 */
export const GEMINI_DIAGNOSIS_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    image_valid: { type: 'BOOLEAN' },
    detected_crop: { type: 'STRING' },
    detected_crop_ur: { type: 'STRING' },
    selected_crop: { type: 'STRING' },
    crop_match: { type: 'BOOLEAN' },
    detected_plant_part: { type: 'STRING' },
    detected_plant_part_ur: { type: 'STRING' },
    growth_stage: { type: 'STRING' },
    growth_stage_ur: { type: 'STRING' },
    identification_confidence: { type: 'NUMBER' },
    scientific_name: { type: 'STRING' },
    pathogen_type: {
      type: 'STRING',
      enum: [
        'fungal',
        'bacterial',
        'viral',
        'pest',
        'nutrient_deficiency',
        'environmental_stress',
        'healthy',
        'unknown',
      ],
    },
    confidence_category: {
      type: 'STRING',
      enum: ['high', 'moderate', 'low', 'uncertain'],
    },
    confidence_limitations: GEMINI_LOCALIZED_SCHEMA,
    visual_inspection: {
      type: 'OBJECT',
      properties: {
        lesion_detected: { type: 'BOOLEAN' },
        lesion_count: { type: 'STRING' },
        lesion_shape: { type: 'STRING' },
        lesion_size_est: { type: 'STRING' },
        lesion_colors: { type: 'ARRAY', items: { type: 'STRING' } },
        lesion_margins: { type: 'STRING' },
        lesion_distribution: { type: 'STRING' },
        tissue_damage: { type: 'STRING' },
        chlorosis_detected: { type: 'BOOLEAN' },
        necrosis_detected: { type: 'BOOLEAN' },
        wilting_detected: { type: 'BOOLEAN' },
        affected_area_pct: { type: 'NUMBER' },
        detected_hotspots: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              x: { type: 'NUMBER' },
              y: { type: 'NUMBER' },
              w: { type: 'NUMBER' },
              h: { type: 'NUMBER' },
              label: { type: 'STRING' },
            },
            required: ['x', 'y', 'w', 'h'],
          },
        },
      },
      required: ['lesion_detected', 'lesion_count', 'lesion_shape', 'affected_area_pct'],
    },
    diagnosis_status: {
      type: 'STRING',
      enum: [
        'healthy_no_symptoms',
        'possible_disease',
        'possible_pest',
        'possible_nutrient_deficiency',
        'environmental_stress',
        'uncertain',
        'crop_mismatch',
        'invalid_image',
      ],
    },
    plant_condition: { type: 'STRING' },
    plant_condition_ur: { type: 'STRING' },
    problem_name: GEMINI_LOCALIZED_SCHEMA,
    possible_disease: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          name_ur: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
          is_primary: { type: 'BOOLEAN' },
        },
        required: ['name', 'name_ur', 'confidence'],
      },
    },
    differential_diagnoses: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          scientific_name: { type: 'STRING' },
          similarities: GEMINI_LOCALIZED_SCHEMA,
          differences: GEMINI_LOCALIZED_SCHEMA,
          likelihood: {
            type: 'STRING',
            enum: ['less_likely', 'possible_coinfection', 'unlikely'],
          },
          field_distinction_tip: GEMINI_LOCALIZED_SCHEMA,
        },
        required: ['name', 'similarities', 'differences', 'likelihood', 'field_distinction_tip'],
      },
    },
    why_suspected: GEMINI_LOCALIZED_SCHEMA,
    observed_symptoms: { type: 'ARRAY', items: GEMINI_LOCALIZED_SCHEMA },
    possible_causes: { type: 'ARRAY', items: GEMINI_LOCALIZED_SCHEMA },
    severity: { type: 'STRING', enum: ['low', 'medium', 'high', 'not_assessed'] },
    severity_level: {
      type: 'STRING',
      enum: ['healthy_none', 'low', 'medium', 'high', 'critical', 'unable_to_determine'],
    },
    severity_explanation: GEMINI_LOCALIZED_SCHEMA,
    severity_scope: {
      type: 'OBJECT',
      properties: {
        leaf_affected_pct: { type: 'NUMBER' },
        scope_note: GEMINI_LOCALIZED_SCHEMA,
      },
      required: ['leaf_affected_pct', 'scope_note'],
    },
    treatment_pillars: {
      type: 'OBJECT',
      properties: {
        immediate_actions: { type: 'ARRAY', items: GEMINI_LOCALIZED_SCHEMA },
        cultural_management: { type: 'ARRAY', items: GEMINI_LOCALIZED_SCHEMA },
        biological_management: { type: 'ARRAY', items: GEMINI_LOCALIZED_SCHEMA },
        chemical_management: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              active_ingredient: { type: 'STRING' },
              purpose: GEMINI_LOCALIZED_SCHEMA,
              safety_precautions: GEMINI_LOCALIZED_SCHEMA,
            },
            required: ['active_ingredient', 'purpose', 'safety_precautions'],
          },
        },
      },
    },
    recommendations: { type: 'ARRAY', items: GEMINI_LOCALIZED_SCHEMA },
    prevention: { type: 'ARRAY', items: GEMINI_LOCALIZED_SCHEMA },
    when_to_consult_expert: GEMINI_LOCALIZED_SCHEMA,
    explanations: {
      type: 'OBJECT',
      properties: {
        farmer_friendly: GEMINI_LOCALIZED_SCHEMA,
        scientific: GEMINI_LOCALIZED_SCHEMA,
      },
      required: ['farmer_friendly', 'scientific'],
    },
    voice_script: GEMINI_LOCALIZED_SCHEMA,
    requires_retake: { type: 'BOOLEAN' },
    requires_expert_review: { type: 'BOOLEAN' },
    message: GEMINI_LOCALIZED_SCHEMA,
  },
  required: [
    'image_valid',
    'detected_crop',
    'detected_crop_ur',
    'selected_crop',
    'crop_match',
    'detected_plant_part',
    'detected_plant_part_ur',
    'growth_stage',
    'growth_stage_ur',
    'identification_confidence',
    'diagnosis_status',
    'plant_condition',
    'plant_condition_ur',
    'problem_name',
    'severity',
    'requires_retake',
    'requires_expert_review',
    'message',
  ],
};

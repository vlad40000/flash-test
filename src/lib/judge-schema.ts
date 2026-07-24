import { z } from 'zod';

// ── Defect codes ──────────────────────────────────────────────────────────────

export const judgeDefectCodeValues = [
  'VISIBLE_MISIDENTIFICATION',
  'UNSUPPORTED_VISIBLE_CLAIM',
  'BACKGROUND_TREATMENT',
  'COLOR_MODE',
  'PALETTE_OR_COLOR',
  'GRADIENT_POLICY',
  'SHADING_SYSTEM',
  'LINE_SYSTEM',
  'STYLE_FAMILY',
  'STYLE_SYSTEM_OTHER',
  'THEME_TOO_SPECIFIC',
  'THEME_TOO_VAGUE',
  'SOURCE_MOTIF_LEAKAGE',
  'IP_OR_NAMED_WORLD_LEAKAGE',
  'QUARANTINE_OMISSION',
  'QUARANTINE_MISCATEGORIZATION',
  'DESIGN_TEXT_LEAKAGE',
  'ANNOTATION_CONTAMINATION',
  'WATERMARK_CONTAMINATION',
  'CAPTURE_CONTEXT_CONTAMINATION',
  'UNSUPPORTED_CERTAINTY',
  'MISUSED_X',
  'UNCERTAINTY_OTHER',
  'OTHER',
] as const;

export type JudgeDefectCode = (typeof judgeDefectCodeValues)[number];

// ── Rubric categories scored by the judge ─────────────────────────────────────

export const judgeCategoryValues = [
  'visible_factual_accuracy',
  'style_system_accuracy',
  'theme_abstraction_quality',
  'quarantine_quality',
  'uncertainty_discipline',
] as const;

export type JudgeCategory = (typeof judgeCategoryValues)[number];

// ── Judge result Zod schema ───────────────────────────────────────────────────

export const judgeResultSchema = z.object({
  verdict: z.enum(['pass', 'pass_with_deductions', 'major_failure']),
  confidence: z.number().min(0).max(1),
  evidence_mode: z.enum([
    'image_plus_machine_evidence',
    'image_plus_approved_evidence',
    'image_only',
  ]),
  defects: z.array(
    z.object({
      defect_code: z.enum(judgeDefectCodeValues),
      category: z.enum(judgeCategoryValues),
      severity: z.enum(['minor', 'moderate', 'major', 'critical']),
      deduction: z.number().int().min(1).max(20),
      explanation: z.string().min(1),
      image_evidence: z.string().min(1),
      response_evidence: z.string().min(1),
      evidence_reference: z.string().nullable(),
    })
  ),
  category_notes: z.object({
    visible_factual_accuracy: z.string(),
    style_system_accuracy: z.string(),
    theme_abstraction_quality: z.string(),
    quarantine_quality: z.string(),
    uncertainty_discipline: z.string(),
  }),
});

export type JudgeResult = z.infer<typeof judgeResultSchema>;

// ── JSON Schema for Gemini structured output ──────────────────────────────────

export const JUDGE_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  required: ['verdict', 'confidence', 'evidence_mode', 'defects', 'category_notes'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'pass_with_deductions', 'major_failure'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence_mode: {
      type: 'string',
      enum: [
        'image_plus_machine_evidence',
        'image_plus_approved_evidence',
        'image_only',
      ],
    },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'defect_code',
          'category',
          'severity',
          'deduction',
          'explanation',
          'image_evidence',
          'response_evidence',
          'evidence_reference',
        ],
        properties: {
          defect_code: { type: 'string', enum: [...judgeDefectCodeValues] },
          category: { type: 'string', enum: [...judgeCategoryValues] },
          severity: { type: 'string', enum: ['minor', 'moderate', 'major', 'critical'] },
          deduction: { type: 'integer', minimum: 1, maximum: 20 },
          explanation: { type: 'string', minLength: 1 },
          image_evidence: { type: 'string', minLength: 1 },
          response_evidence: { type: 'string', minLength: 1 },
          evidence_reference: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
    category_notes: {
      type: 'object',
      required: [
        'visible_factual_accuracy',
        'style_system_accuracy',
        'theme_abstraction_quality',
        'quarantine_quality',
        'uncertainty_discipline',
      ],
      properties: {
        visible_factual_accuracy: { type: 'string' },
        style_system_accuracy: { type: 'string' },
        theme_abstraction_quality: { type: 'string' },
        quarantine_quality: { type: 'string' },
        uncertainty_discipline: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

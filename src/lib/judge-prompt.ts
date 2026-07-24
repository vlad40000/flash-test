import type { EvidenceRecord } from '@/types';

// ── System instruction (versioned server-side) ────────────────────────────────

export const JUDGE_SYSTEM_INSTRUCTION_VERSION = '1.0.0';

export function buildJudgeSystemInstruction(): string {
  return `You are a blind evaluator of a FLASH-1 Theme Extraction response.
You are not generating or rewriting the extraction.
You must evaluate only the supplied source image, extraction response,
FLASH-1 contract, fixed rubric, and available evidence.
The generating model and parameter configuration are intentionally hidden.
Do not infer or request them.
Score each defect once under its primary category.
Return only the required structured JSON.

CATEGORY BOUNDARY RULES:
- Exact subjects, lettering, symbols, props, poses, settings, identity features, and source-specific concepts belong in quarantine.
- Reusable style mechanics belong in the style system.
- Reusable collection-level thematic territory belongs in theme abstraction.
- Named franchise places, exact slogans, and source-specific motifs must not leak into reusable theme territory.
- Screen bezels, workflow annotations, watermarks, glare, and capture artifacts are not design content.
- Use uncertainty discipline when the capture cannot support a reliable claim.
- Do not penalize one defect twice.
- Do not include candidate model names anywhere in the prompt.

DEDUCTION RULES:
- Score each defect once under its primary category only.
- Do not create two deductions for one visible defect (e.g., a gradient violation is either a GRADIENT_POLICY or a SHADING_SYSTEM defect — not both).
- Provide image_evidence and response_evidence for every defect.
- Your structured JSON is the authoritative record. Do not include a final numeric total — code computes the score.`;
}

// ── Evidence block builder ────────────────────────────────────────────────────

function buildEvidenceBlock(evidence: EvidenceRecord | null): string {
  if (!evidence) {
    return `EVIDENCE MODE: image_only
No matching evidence record exists for this image.
Score directly from the source image, extraction response, FLASH-1 contract, and rubric.`;
  }

  const hasApprovedVisual = evidence.reviewDecision === 'approved' && evidence.visualFacts;
  const hasMachinePixel = evidence.pixelFacts && Object.keys(evidence.pixelFacts as object).length > 0;

  if (hasApprovedVisual) {
    return `EVIDENCE MODE: image_plus_approved_evidence
The following authored visual facts have been owner-approved and are authoritative for this evaluation.
APPROVED VISUAL FACTS:
${JSON.stringify(evidence.visualFacts, null, 2)}

MACHINE-VERIFIED PIXEL FACTS:
${hasMachinePixel ? JSON.stringify(evidence.pixelFacts, null, 2) : '(none)'}`;
  }

  if (hasMachinePixel) {
    return `EVIDENCE MODE: image_plus_machine_evidence
Machine-verified pixel facts are authoritative. Visual facts are not yet owner-approved and must not be treated as authoritative.
MACHINE-VERIFIED PIXEL FACTS:
${JSON.stringify(evidence.pixelFacts, null, 2)}

PENDING VISUAL FACTS (non-authoritative — use only for directional context if helpful, do not penalize based on these alone):
${evidence.visualFacts ? JSON.stringify(evidence.visualFacts, null, 2) : '(none)'}`;
  }

  return `EVIDENCE MODE: image_only
An evidence record exists but contains no applicable machine-verified pixel facts and no approved visual facts.
Score directly from the source image, extraction response, FLASH-1 contract, and rubric.`;
}

// ── Judge prompt builder ──────────────────────────────────────────────────────

export interface JudgePromptInput {
  extractionResponseText: string;
  parsedJson: unknown | null;
  flashContract: string;
  evidence: EvidenceRecord | null;
}

export function buildJudgePrompt(input: JudgePromptInput): string {
  const evidenceBlock = buildEvidenceBlock(input.evidence);

  return `# FLASH-1 THEME EXTRACTION — BLIND EVALUATION

## SOURCE IMAGE
The source image is provided as the first input to this request.

## EXTRACTION RESPONSE
Raw text output from the extractor:
\`\`\`
${input.extractionResponseText}
\`\`\`

Parsed JSON (for structured field access):
\`\`\`json
${input.parsedJson != null ? JSON.stringify(input.parsedJson, null, 2) : 'NOT PARSEABLE'}
\`\`\`

## FLASH-1 CONTRACT
${input.flashContract}

## EVIDENCE
${evidenceBlock}

## FIXED SCORING RUBRIC (100 points maximum)

| Category | Maximum |
|----------|---------|
| Schema and contract compliance | 20 |
| Visible factual accuracy | 20 |
| Style-system accuracy | 20 |
| Theme abstraction quality | 15 |
| Quarantine quality | 20 |
| Uncertainty discipline | 5 |

**IMPORTANT:** Schema and contract compliance is scored deterministically by code, not by you.
Your task is to score: visible_factual_accuracy, style_system_accuracy, theme_abstraction_quality, quarantine_quality, uncertainty_discipline.

## SEVERITY ANCHORS

- **minor** (1–3 pts): One field slightly off; defensible interpretation.
- **moderate** (3–6 pts): Meaningfully incorrect; visible in the image.
- **major** (6–12 pts): Clearly wrong; would misdirect a designer.
- **critical** (12–20 pts): Catastrophic failure of the category's purpose.

## EVALUATION TASK

1. Examine the source image carefully.
2. Compare each field of the extraction response against the image, contract, and evidence.
3. Identify all defects. Score each once under its primary category.
4. Return the required structured JSON. Do not include a computed total.
5. Set evidence_mode to reflect which evidence tier you used.`;
}

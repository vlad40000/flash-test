import type { AutoScoreResult } from '@/lib/auto-score';
import type { JudgeResult } from '@/lib/judge-schema';
import type {
  AutomaticAssessment,
  AutomaticDefect,
  DeterministicAssessment,
  EvidenceMode,
  ScoreStatus,
} from '@/types';

// ── Category maxima ───────────────────────────────────────────────────────────

const CATEGORY_MAXIMA: Record<string, number> = {
  schema_contract_compliance: 20,
  visible_factual_accuracy: 20,
  style_system_accuracy: 20,
  theme_abstraction_quality: 15,
  quarantine_quality: 20,
  uncertainty_discipline: 5,
};

// Map from deterministic scorer's key names → API/judge category names
const DET_TO_JUDGE_CATEGORY: Record<string, string> = {
  schemaContractCompliance: 'schema_contract_compliance',
  visibleFactualAccuracy: 'visible_factual_accuracy',
  styleSystemAccuracy: 'style_system_accuracy',
  quarantineQuality: 'quarantine_quality',
};

// ── Deduction key normalizer ──────────────────────────────────────────────────

/**
 * Canonical deduplication key: `defect_code:category:normalized_field`.
 * Does not rely on exact explanation text.
 */
function deductionKey(defectCode: string, category: string, field: string): string {
  const normalizedField = field
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '');
  return `${defectCode}:${category}:${normalizedField}`;
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface MergeInput {
  deterministicResult: AutoScoreResult;
  judgeResult: JudgeResult | null;
  scoreStatus: ScoreStatus;
  judgeJobId: string | null;
}

// ── Short-circuit statuses ────────────────────────────────────────────────────

const INELIGIBLE_STATUSES = new Set<ScoreStatus>([
  'provider_failed',
  'json_invalid',
  'schema_invalid',
  'stopped',
]);

// ── Pure merge function ───────────────────────────────────────────────────────

export function mergeAutomaticAssessment(input: MergeInput): AutomaticAssessment {
  const { deterministicResult, judgeResult, scoreStatus, judgeJobId } = input;

  // Build deterministic assessment wrapper
  const deterministicAssessment: DeterministicAssessment = {
    scoreStatus,
    schemaValid: deterministicResult.schemaClean,
    eligibleForRanking: deterministicResult.eligibleForRanking,
    scores: deterministicResult.scores,
    ledger: deterministicResult.ledger,
    rankingIneligibilityReasons: deterministicResult.rankingIneligibilityReasons,
    notes: deterministicResult.notes,
  };

  // ── Gate on disqualifying status ─────────────────────────────────────────

  if (INELIGIBLE_STATUSES.has(scoreStatus)) {
    const catScores = buildCategoryScoresFromDeterministic(deterministicResult);
    return {
      scoreStatus,
      schemaValid: deterministicResult.schemaClean,
      eligibleForRanking: false,
      categoryScores: catScores,
      totalScore: null,
      confidence: null,
      evidenceMode: null,
      defects: buildDeterministicDefects(deterministicResult),
      deterministicAssessment,
      judgeJobId,
      scoredAt: null,
    };
  }

  // ── Judge failed or not yet available ────────────────────────────────────

  if (!judgeResult) {
    return {
      scoreStatus: scoreStatus === 'scored' ? 'judge_failed' : scoreStatus,
      schemaValid: deterministicResult.schemaClean,
      eligibleForRanking: false,
      categoryScores: buildCategoryScoresFromDeterministic(deterministicResult),
      totalScore: null,
      confidence: null,
      evidenceMode: null,
      defects: buildDeterministicDefects(deterministicResult),
      deterministicAssessment,
      judgeJobId,
      scoredAt: null,
    };
  }

  // ── Merge deterministic + judge defects ──────────────────────────────────

  const detDefects = buildDeterministicDefects(deterministicResult);

  // Build set of canonical keys from deterministic defects for deduplication
  const detKeys = new Set<string>(detDefects.map((d) => d.deductionKey));

  // Convert judge defects and filter duplicates
  const judgeDefects: AutomaticDefect[] = judgeResult.defects
    .map((jd) => {
      const key = deductionKey(jd.defect_code, jd.category, jd.defect_code);
      return {
        defectCode: jd.defect_code,
        category: jd.category,
        severity: jd.severity,
        deduction: jd.deduction,
        source: 'ai-judge' as const,
        field: jd.defect_code,
        explanation: jd.explanation,
        imageEvidence: jd.image_evidence,
        responseEvidence: jd.response_evidence,
        evidenceReference: jd.evidence_reference,
        deductionKey: key,
      };
    })
    .filter((jd) => !detKeys.has(jd.deductionKey));

  const allDefects = [...detDefects, ...judgeDefects];

  // ── Compute category scores ───────────────────────────────────────────────

  // Start at maximum for each judge-scored category
  const judgeScored = new Set(['visible_factual_accuracy', 'style_system_accuracy', 'theme_abstraction_quality', 'quarantine_quality', 'uncertainty_discipline']);
  const categoryTotals: Record<string, number> = {};
  for (const [cat, max] of Object.entries(CATEGORY_MAXIMA)) {
    categoryTotals[cat] = max;
  }

  // Apply all deductions
  for (const defect of allDefects) {
    if (defect.severity === 'fatal') continue; // Fatal is already reflected in schema category
    const cat = defect.category;
    if (cat in categoryTotals) {
      categoryTotals[cat] = Math.max(0, categoryTotals[cat]! - defect.deduction);
    }
  }

  // Deterministic schema score overrides
  const detSchemaScore = deterministicResult.scores.schemaContractCompliance;
  if (detSchemaScore !== null) {
    categoryTotals['schema_contract_compliance'] = detSchemaScore;
  }

  const visFactual = judgeScored.has('visible_factual_accuracy') ? categoryTotals['visible_factual_accuracy'] : null;
  const styleAcc = judgeScored.has('style_system_accuracy') ? categoryTotals['style_system_accuracy'] : null;
  const themeAbstr = judgeScored.has('theme_abstraction_quality') ? categoryTotals['theme_abstraction_quality'] : null;
  const quarantine = judgeScored.has('quarantine_quality') ? categoryTotals['quarantine_quality'] : null;
  const uncertainty = judgeScored.has('uncertainty_discipline') ? categoryTotals['uncertainty_discipline'] : null;
  const schemaCompliance = categoryTotals['schema_contract_compliance'] ?? null;

  const categoryScores: AutomaticAssessment['categoryScores'] = {
    schema_contract_compliance: schemaCompliance,
    visible_factual_accuracy: visFactual ?? null,
    style_system_accuracy: styleAcc ?? null,
    theme_abstraction_quality: themeAbstr ?? null,
    quarantine_quality: quarantine ?? null,
    uncertainty_discipline: uncertainty ?? null,
  };

  const allCatValues = Object.values(categoryScores);
  const totalScore = allCatValues.every((v) => v !== null)
    ? (allCatValues as number[]).reduce((sum, v) => sum + v, 0)
    : null;

  // Evidence mode from judge
  const evidenceMode = judgeResult.evidence_mode as EvidenceMode;

  return {
    scoreStatus: 'scored',
    schemaValid: deterministicResult.schemaClean,
    eligibleForRanking: deterministicResult.eligibleForRanking && totalScore !== null,
    categoryScores,
    totalScore,
    confidence: judgeResult.confidence,
    evidenceMode,
    defects: allDefects,
    deterministicAssessment,
    judgeJobId,
    scoredAt: new Date().toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCategoryScoresFromDeterministic(result: AutoScoreResult): AutomaticAssessment['categoryScores'] {
  return {
    schema_contract_compliance: result.scores.schemaContractCompliance,
    visible_factual_accuracy: result.scores.visibleFactualAccuracy,
    style_system_accuracy: result.scores.styleSystemAccuracy,
    theme_abstraction_quality: null, // always human/judge
    quarantine_quality: result.scores.quarantineQuality,
    uncertainty_discipline: null, // always judge
  };
}

function buildDeterministicDefects(result: AutoScoreResult): AutomaticDefect[] {
  return result.ledger.map((entry) => {
    const judgeCategory = DET_TO_JUDGE_CATEGORY[entry.category] ?? entry.category;
    return {
      defectCode: entry.deductionKey.split(':')[0]?.toUpperCase() ?? 'OTHER',
      category: judgeCategory,
      severity: entry.severity === 'fatal' ? 'fatal' : entry.severity,
      deduction: entry.deduction,
      source: 'deterministic' as const,
      field: entry.field,
      explanation: entry.message,
      imageEvidence: null,
      responseEvidence: null,
      evidenceReference: null,
      deductionKey: deductionKey(
        entry.deductionKey.split(':')[0]?.toUpperCase() ?? 'OTHER',
        judgeCategory,
        entry.field
      ),
    };
  });
}

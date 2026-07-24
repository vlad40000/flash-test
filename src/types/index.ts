import type { AutoScoreResult } from '@/lib/auto-score';

// ── Extraction model constants ────────────────────────────────────────────────

export const MODELS = ['gemini-3.5-flash', 'gemini-3.1-pro-preview'] as const;
export type BenchmarkModel = (typeof MODELS)[number];

export const TEMPERATURES = [0.2, 0.4, 0.8, 1.0] as const;
export type BenchmarkTemperature = (typeof TEMPERATURES)[number];

export const THINKING_LEVELS = ['low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const TOP_P = 0.95 as const;
export const MAX_OUTPUT_TOKENS = 65_536 as const;
export const CONCURRENCY = 4 as const;
export const MAX_TRIALS = 5 as const;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'stopped'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type SupportedMime = 'image/png' | 'image/jpeg' | 'image/webp';

// ── Score status ──────────────────────────────────────────────────────────────

export type ScoreStatus =
  | 'not_started'
  | 'queued'
  | 'judging'
  | 'scored'
  | 'provider_failed'
  | 'json_invalid'
  | 'schema_invalid'
  | 'judge_failed'
  | 'stopped';

// ── Extraction job & attempt ──────────────────────────────────────────────────

export interface BenchmarkJob {
  id: string;
  experimentId: string;
  model: BenchmarkModel;
  temperature: BenchmarkTemperature;
  topP: typeof TOP_P;
  thinkingLevel: ThinkingLevel;
  trial: number;
  cellId: string;
  waveNumber: number;
  status: JobStatus;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  workerNumber: number | null;
  queuePosition: number;
}

export interface JobAttempt {
  jobId: string;
  attempt: number;
  startedAt: string;
  completedAt: string | null;
  latencyMs: number | null;
  providerStatus: number | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  retryAfterSeconds: number | null;
  interactionId: string | null;
  rawOutputText: string | null;
  parsedJson: unknown | null;
  jsonParseValid: boolean;
  schemaValid: boolean;
  schemaIssues: string[];
  recoveryPossible: boolean;
  usage: unknown | null;
}

// ── Judge job & attempt ───────────────────────────────────────────────────────

export interface JudgeJob {
  id: string;
  experimentId: string;
  extractionJobId: string;
  extractionAttemptNumber: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'stopped';
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface JudgeAttempt {
  judgeJobId: string;
  attempt: number;
  model: 'gemini-3.1-pro-preview';
  temperature: 0.2;
  topP: 0.95;
  thinkingLevel: 'high';
  startedAt: string;
  completedAt: string | null;
  latencyMs: number | null;
  providerStatus: number | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  rawOutputText: string | null;
  parsedOutput: unknown | null;
  schemaValid: boolean;
  schemaIssues: string[];
  usage: unknown | null;
}

// ── Defects ───────────────────────────────────────────────────────────────────

export type DefectSource = 'deterministic' | 'ai-judge';

export interface AutomaticDefect {
  defectCode: string;
  category: string;
  severity: 'minor' | 'moderate' | 'major' | 'critical' | 'fatal';
  deduction: number;
  source: DefectSource;
  field: string;
  explanation: string;
  imageEvidence: string | null;
  responseEvidence: string | null;
  evidenceReference: string | null;
  deductionKey: string;
}

// ── Assessments ───────────────────────────────────────────────────────────────

export type EvidenceMode =
  | 'image_plus_machine_evidence'
  | 'image_plus_approved_evidence'
  | 'image_only';

export interface DeterministicAssessment {
  scoreStatus: ScoreStatus;
  schemaValid: boolean;
  eligibleForRanking: boolean;
  scores: AutoScoreResult['scores'];
  ledger: AutoScoreResult['ledger'];
  rankingIneligibilityReasons: string[];
  notes: string[];
}

export interface AutomaticAssessment {
  scoreStatus: ScoreStatus;
  schemaValid: boolean;
  eligibleForRanking: boolean;
  categoryScores: {
    schema_contract_compliance: number | null;
    visible_factual_accuracy: number | null;
    style_system_accuracy: number | null;
    theme_abstraction_quality: number | null;
    quarantine_quality: number | null;
    uncertainty_discipline: number | null;
  };
  totalScore: number | null;
  confidence: number | null;
  evidenceMode: EvidenceMode | null;
  defects: AutomaticDefect[];
  deterministicAssessment: DeterministicAssessment;
  judgeJobId: string | null;
  scoredAt: string | null;
}

// ── Experiment manifest ───────────────────────────────────────────────────────

export interface ExperimentManifest {
  experimentId: string;
  createdAt: string;
  updatedAt: string;
  seed: number;
  sdkVersion: string;

  image: {
    originalFilename: string;
    detectedMimeType: SupportedMime;
    detectedExtension: 'png' | 'jpg' | 'webp';
    byteLength: number;
    sha256: string;
  };
  prompt: { sha256: string; byteLength: number };
  systemInstruction: { sha256: string; byteLength: number };
  schema: { sha256: string; byteLength: number };

  locked: {
    models: readonly BenchmarkModel[];
    temperatures: readonly BenchmarkTemperature[];
    thinkingLevels: readonly ThinkingLevel[];
    topP: typeof TOP_P;
    maxOutputTokens: typeof MAX_OUTPUT_TOKENS;
    concurrency: typeof CONCURRENCY;
    structuredOutput: true;
    store: false;
    transport: 'interactions';
  };

  trials: number;
  totalCalls: number;
  status:
    | 'created'
    | 'running'
    | 'extracting'
    | 'extraction_complete'
    | 'scoring'
    | 'paused'
    | 'stopped'
    | 'completed'
    | 'complete'
    | 'complete_with_extraction_errors'
    | 'complete_with_scoring_errors';
  lastError?: string | null;

  evidenceReviews?: Record<string, EvidenceReviewDecision>;
}

export type EvidenceReviewDecision = 'approved' | 'needs_revision' | 'rejected';

export interface EvidenceRecord {
  filename: string;
  role?: string;
  pixelFacts?: unknown;
  visualFacts?: unknown;
  quarantineRequirements?: unknown;
  discriminationTarget?: unknown;
  ownerSignOffState?: 'machine_verified' | 'owner_reviewed' | 'not_approved' | string;
  reviewDecision?: EvidenceReviewDecision | null;
}

// ── Scoring categories ────────────────────────────────────────────────────────

export const SCORING_CATEGORIES = [
  { key: 'schemaContractCompliance', label: 'Schema and contract compliance', max: 20 },
  { key: 'visibleFactualAccuracy', label: 'Visible factual accuracy', max: 20 },
  { key: 'styleSystemAccuracy', label: 'Style-system accuracy', max: 20 },
  { key: 'themeAbstractionQuality', label: 'Theme abstraction quality', max: 15 },
  { key: 'quarantineQuality', label: 'Quarantine quality', max: 20 },
  { key: 'uncertaintyDiscipline', label: 'Uncertainty discipline', max: 5 },
] as const;

export type ScoringCategoryKey = (typeof SCORING_CATEGORIES)[number]['key'];

// ── Legacy manual score (kept for backward-compat reads only) ─────────────────

/**
 * @deprecated Manual scoring is replaced by automatic scoring.
 * This type is retained only for backward-compatible reading of old score files.
 * It is no longer written and does not affect rankings or summaries.
 */
export interface ManualScore {
  jobId: string;
  attempt: number;
  scores: Partial<Record<ScoringCategoryKey, number>>;
  notes: string;
  updatedAt: string;
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

export interface ConfigAggregate {
  model: BenchmarkModel;
  temperature: BenchmarkTemperature;
  thinkingLevel: ThinkingLevel;
  totalTrials: number;
  completedTrials: number;
  providerSucceeded: number;
  providerFailed: number;
  jsonParseValidRate: number;
  schemaValidRate: number;
  averageLatencyMs: number | null;
  // Automatic scoring fields
  eligibleAttemptCount: number;
  disqualifiedAttemptCount: number;
  judgeFailureCount: number;
  meanScore: number | null;
  medianScore: number | null;
  minimumScore: number | null;
  p10Score: number | null;
  standardDeviation: number | null;
  criticalDefectRate: number | null;
  meanJudgeConfidence: number | null;
  extractionLatency: number | null;
  judgeLatency: number | null;
  // Legacy fields kept for display continuity; computed from automatic scoring
  /** @deprecated Use meanScore instead */
  averageManualScore: number | null;
  /** @deprecated Use eligibleAttemptCount instead */
  scoredTrials: number;
}

export interface ExperimentSummary {
  generatedAt: string;
  statusCounts: Record<JobStatus, number>;
  jsonInvalid: number;
  schemaInvalid: number;
  retryableFailures: number;
  aggregates: ConfigAggregate[];
}

export interface ExperimentListItem {
  experimentId: string;
  createdAt: string;
  updatedAt: string;
  originalFilename: string;
  trials: number;
  totalCalls: number;
  status: ExperimentManifest['status'];
}

// ── Composite attempt detail (API response shape) ─────────────────────────────

export interface AttemptDetail {
  jobId: string;
  attemptNumber: number;
  extraction: JobAttempt;
  automaticAssessment: AutomaticAssessment | null;
  judge: {
    status: ScoreStatus;
    judgeJobId: string | null;
    attempts: JudgeAttempt[];
  };
}

// ── Audit flag ────────────────────────────────────────────────────────────────

export interface AuditFlag {
  jobId: string;
  attemptNumber: number;
  flaggedAt: string;
  notes: string;
}

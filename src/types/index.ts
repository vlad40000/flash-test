import type { AutoScoreResult, CombinedScoreResult } from '@/lib/auto-score';

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
  status: 'created' | 'running' | 'paused' | 'stopped' | 'completed';
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

export const SCORING_CATEGORIES = [
  { key: 'schemaContractCompliance', label: 'Schema and contract compliance', max: 20 },
  { key: 'visibleFactualAccuracy', label: 'Visible factual accuracy', max: 20 },
  { key: 'styleSystemAccuracy', label: 'Style-system accuracy', max: 20 },
  { key: 'themeAbstractionQuality', label: 'Theme abstraction quality', max: 15 },
  { key: 'quarantineQuality', label: 'Quarantine quality', max: 20 },
  { key: 'uncertaintyDiscipline', label: 'Uncertainty discipline', max: 5 },
] as const;

export type ScoringCategoryKey = (typeof SCORING_CATEGORIES)[number]['key'];

export interface ManualScore {
  jobId: string;
  attempt: number;
  scores: Partial<Record<ScoringCategoryKey, number>>;
  notes: string;
  updatedAt: string;
}

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
  averageManualScore: number | null;
  scoredTrials: number;
  averageAutoScore: number | null;
  autoScoredTrials: number;
  averageHumanJudgmentScore: number | null;
  humanJudgmentScoredTrials: number;
  averageCombinedScore: number | null;
  combinedScoredTrials: number;
  rankingEligibleTrials: number;
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

export interface AttemptScoreView {
  jobId: string;
  attempt: number;
  automatic: AutoScoreResult;
  combined: CombinedScoreResult;
}

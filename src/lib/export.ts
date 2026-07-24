import { BenchmarkJob, EvidenceRecord, ExperimentManifest, ExperimentSummary, JobAttempt, ManualScore } from '@/types';
import { manualScoreTotal } from './summary';

export interface ExportBundle {
  manifest: ExperimentManifest;
  jobs: BenchmarkJob[];
  attempts: JobAttempt[];
  scores: ManualScore[];
  evidence: EvidenceRecord[];
  summary: ExperimentSummary;
  artifacts: {
    prompt: string;
    systemInstruction: string;
    responseSchema: unknown;
  };
}

export function toJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** One JSON object per line, one line per attempt, with its locked job and manual review. */
export function toJsonl(bundle: ExportBundle): string {
  const scores = new Map(bundle.scores.map((score) => [`${score.jobId}__${score.attempt}`, score]));
  return bundle.attempts
    .map((attempt) => {
      const job = bundle.jobs.find((item) => item.id === attempt.jobId);
      const score = scores.get(`${attempt.jobId}__${attempt.attempt}`) ?? null;
      return JSON.stringify({ experimentId: bundle.manifest.experimentId, job, attempt, score });
    })
    .join('\n');
}

const CSV_COLUMNS = [
  'jobId',
  'model',
  'temperature',
  'topP',
  'thinkingLevel',
  'trial',
  'waveNumber',
  'attempt',
  'status',
  'latencyMs',
  'providerStatus',
  'providerErrorCode',
  'jsonParseValid',
  'schemaValid',
  'schemaIssuesCount',
  'manualScoreTotal',
  'reviewNotes',
] as const;

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(bundle: ExportBundle): string {
  const scoreMap = new Map(bundle.scores.map((score) => [`${score.jobId}__${score.attempt}`, score]));
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const attempt of bundle.attempts) {
    const job = bundle.jobs.find((item) => item.id === attempt.jobId);
    const score = scoreMap.get(`${attempt.jobId}__${attempt.attempt}`);
    const row = [
      attempt.jobId,
      job?.model ?? '',
      job?.temperature ?? '',
      job?.topP ?? '',
      job?.thinkingLevel ?? '',
      job?.trial ?? '',
      job?.waveNumber ?? '',
      attempt.attempt,
      job?.status ?? '',
      attempt.latencyMs ?? '',
      attempt.providerStatus ?? '',
      attempt.providerErrorCode ?? '',
      attempt.jsonParseValid,
      attempt.schemaValid,
      attempt.schemaIssues.length,
      manualScoreTotal(score),
      score?.notes ?? '',
    ];
    rows.push(row.map(csvEscape).join(','));
  }
  return rows.join('\n');
}

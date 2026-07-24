import { AutomaticAssessment, BenchmarkJob, EvidenceRecord, ExperimentManifest, ExperimentSummary, JobAttempt, JudgeJob, ManualScore } from '@/types';

export interface ExportBundle {
  manifest: ExperimentManifest;
  jobs: BenchmarkJob[];
  attempts: JobAttempt[];
  scores: ManualScore[];
  evidence: EvidenceRecord[];
  judgeJobs: JudgeJob[];
  assessments: Record<string, AutomaticAssessment>;
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

export function toJsonl(bundle: ExportBundle): string {
  const scores = new Map(bundle.scores.map((score) => [`${score.jobId}__${score.attempt}`, score]));
  return bundle.attempts
    .map((attempt) => {
      const job = bundle.jobs.find((item) => item.id === attempt.jobId);
      const score = scores.get(`${attempt.jobId}__${attempt.attempt}`) ?? null;
      const judgeJob = bundle.judgeJobs?.find((jj) => jj.extractionJobId === attempt.jobId && jj.extractionAttemptNumber === attempt.attempt) ?? null;
      const assessment = bundle.assessments?.[`${attempt.jobId}__${attempt.attempt}`] ?? null;
      return JSON.stringify({ experimentId: bundle.manifest.experimentId, job, attempt, score, judgeJob, assessment });
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
  'scoreStatus',
  'automaticScore',
  'eligibleForRanking',
] as const;

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(bundle: ExportBundle): string {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const attempt of bundle.attempts) {
    const job = bundle.jobs.find((item) => item.id === attempt.jobId);
    const assessment = bundle.assessments?.[`${attempt.jobId}__${attempt.attempt}`];

    let scoreStatus = 'not_started';
    if (!attempt.jsonParseValid) scoreStatus = 'json_invalid';
    else if (!attempt.schemaValid) scoreStatus = 'schema_invalid';
    else if (assessment?.scoreStatus) scoreStatus = assessment.scoreStatus;
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
      scoreStatus,
      assessment?.totalScore ?? '',
      assessment?.eligibleForRanking ?? false,
    ];
    rows.push(row.map(csvEscape).join(','));
  }
  return rows.join('\n');
}

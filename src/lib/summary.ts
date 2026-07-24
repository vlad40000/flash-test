import {
  AutomaticAssessment,
  BenchmarkJob,
  ConfigAggregate,
  ExperimentSummary,
  JOB_STATUSES,
  JobAttempt,
  ManualScore,
  EvidenceRecord,
} from '@/types';
import { isRetryable } from './retry';

// ── Utility: final attempt per job ────────────────────────────────────────────

export function finalAttemptMap(attempts: JobAttempt[]): Map<string, JobAttempt> {
  const map = new Map<string, JobAttempt>();
  for (const attempt of attempts) {
    const existing = map.get(attempt.jobId);
    if (!existing || attempt.attempt > existing.attempt) map.set(attempt.jobId, attempt);
  }
  return map;
}

// ── Legacy helper (kept for backward compat — not used in scoring) ─────────────

/**
 * @deprecated Manual scoring has been replaced by automatic scoring.
 * Retained only for backward-compatible export formatting.
 */
export function manualScoreTotal(score: ManualScore | undefined | null): number | null {
  if (!score?.scores) return null;
  let total = 0;
  const requiredKeys = [
    'schemaContractCompliance',
    'visibleFactualAccuracy',
    'styleSystemAccuracy',
    'themeAbstractionQuality',
    'quarantineQuality',
    'uncertaintyDiscipline',
  ] as const;
  for (const key of requiredKeys) {
    const value = score.scores[key];
    if (typeof value !== 'number') return null;
    total += value;
  }
  return total;
}

// ── Statistics helpers ────────────────────────────────────────────────────────

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[idx] ?? null;
}

function stddev(values: number[]): number | null {
  if (values.length === 0) return null;
  const m = mean(values) ?? 0;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ── Aggregate builder ─────────────────────────────────────────────────────────

export function aggregateByConfig(
  jobs: BenchmarkJob[],
  attempts: JobAttempt[],
  _scores: ManualScore[] = [],       // kept for backward compat signature
  _evidence: EvidenceRecord | null = null,  // kept for backward compat signature
  assessments: Record<string, AutomaticAssessment> = {}
): ConfigAggregate[] {
  const finalAttempts = finalAttemptMap(attempts);

  type GroupAccumulator = ConfigAggregate & {
    jsonValidCount: number;
    schemaValidCount: number;
    latencySum: number;
    latencyCount: number;
    eligibleScores: number[];
    judgeConfidences: number[];
    judgeLatencies: number[];
    criticalDefectCount: number;
    eligibleCount: number;
  };

  const groups = new Map<string, GroupAccumulator>();

  for (const job of jobs) {
    const key = `${job.model}__${job.temperature}__${job.thinkingLevel}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        model: job.model,
        temperature: job.temperature,
        thinkingLevel: job.thinkingLevel,
        totalTrials: 0,
        completedTrials: 0,
        providerSucceeded: 0,
        providerFailed: 0,
        jsonParseValidRate: 0,
        schemaValidRate: 0,
        averageLatencyMs: null,
        // Automatic scoring fields
        eligibleAttemptCount: 0,
        disqualifiedAttemptCount: 0,
        judgeFailureCount: 0,
        meanScore: null,
        medianScore: null,
        minimumScore: null,
        p10Score: null,
        standardDeviation: null,
        criticalDefectRate: null,
        meanJudgeConfidence: null,
        extractionLatency: null,
        judgeLatency: null,
        // Legacy compat
        averageManualScore: null,
        scoredTrials: 0,
        // Internal accumulators
        jsonValidCount: 0,
        schemaValidCount: 0,
        latencySum: 0,
        latencyCount: 0,
        eligibleScores: [],
        judgeConfidences: [],
        judgeLatencies: [],
        criticalDefectCount: 0,
        eligibleCount: 0,
      };
      groups.set(key, group);
    }

    group.totalTrials++;

    if (job.status === 'succeeded') {
      group.providerSucceeded++;
      group.completedTrials++;
    } else if (job.status === 'failed') {
      group.providerFailed++;
      group.completedTrials++;
    }

    const attempt = finalAttempts.get(job.id);
    if (!attempt) continue;

    if (attempt.jsonParseValid) group.jsonValidCount++;
    if (attempt.schemaValid) group.schemaValidCount++;

    if (attempt.latencyMs != null) {
      group.latencySum += attempt.latencyMs;
      group.latencyCount++;
    }

    const assessment = assessments[`${job.id}__${attempt.attempt}`];
    if (!assessment) {
      // No assessment yet — count as disqualified if extraction failed/invalid
      if (!attempt.jsonParseValid || !attempt.schemaValid || job.status === 'failed') {
        group.disqualifiedAttemptCount++;
      }
      continue;
    }

    if (assessment.scoreStatus === 'judge_failed') {
      group.judgeFailureCount++;
      continue;
    }

    if (!assessment.eligibleForRanking || assessment.totalScore === null || assessment.scoreStatus !== 'scored') {
      group.disqualifiedAttemptCount++;
      continue;
    }

    // Eligible
    group.eligibleCount++;
    group.eligibleScores.push(assessment.totalScore);

    if (assessment.confidence != null) {
      group.judgeConfidences.push(assessment.confidence);
    }

    // Count critical defects
    const criticalDefects = assessment.defects.filter((d) => d.severity === 'critical');
    if (criticalDefects.length > 0) group.criticalDefectCount++;
  }

  return Array.from(groups.values())
    .map((group): ConfigAggregate => {
      const meanScore = mean(group.eligibleScores);
      const medianScore = median(group.eligibleScores);
      const minimumScore = group.eligibleScores.length > 0 ? Math.min(...group.eligibleScores) : null;
      const p10Score = percentile(group.eligibleScores, 0.1);
      const standardDeviation = stddev(group.eligibleScores);
      const criticalDefectRate = group.eligibleCount > 0 ? group.criticalDefectCount / group.eligibleCount : null;
      const meanJudgeConfidence = mean(group.judgeConfidences);
      const extractionLatency = group.latencyCount > 0 ? Math.round(group.latencySum / group.latencyCount) : null;
      const judgeLatency = mean(group.judgeLatencies) != null ? Math.round(mean(group.judgeLatencies)!) : null;

      return {
        model: group.model,
        temperature: group.temperature,
        thinkingLevel: group.thinkingLevel,
        totalTrials: group.totalTrials,
        completedTrials: group.completedTrials,
        providerSucceeded: group.providerSucceeded,
        providerFailed: group.providerFailed,
        jsonParseValidRate: group.completedTrials ? group.jsonValidCount / group.completedTrials : 0,
        schemaValidRate: group.completedTrials ? group.schemaValidCount / group.completedTrials : 0,
        averageLatencyMs: extractionLatency,
        eligibleAttemptCount: group.eligibleCount,
        disqualifiedAttemptCount: group.disqualifiedAttemptCount,
        judgeFailureCount: group.judgeFailureCount,
        meanScore: meanScore != null ? Math.round(meanScore * 100) / 100 : null,
        medianScore: medianScore != null ? Math.round(medianScore * 100) / 100 : null,
        minimumScore,
        p10Score,
        standardDeviation: standardDeviation != null ? Math.round(standardDeviation * 100) / 100 : null,
        criticalDefectRate,
        meanJudgeConfidence: meanJudgeConfidence != null ? Math.round(meanJudgeConfidence * 100) / 100 : null,
        extractionLatency,
        judgeLatency,
        // Legacy compat
        averageManualScore: meanScore != null ? Math.round(meanScore * 100) / 100 : null,
        scoredTrials: group.eligibleCount,
      };
    })
    .sort((a, b) => {
      // Reliability-first ranking (spec §12)
      const aCrit = a.criticalDefectRate ?? 1;
      const bCrit = b.criticalDefectRate ?? 1;
      if (aCrit !== bCrit) return aCrit - bCrit;

      if (a.schemaValidRate !== b.schemaValidRate) return b.schemaValidRate - a.schemaValidRate;

      const aMin = a.minimumScore ?? -1;
      const bMin = b.minimumScore ?? -1;
      if (aMin !== bMin) return bMin - aMin;

      const aP10 = a.p10Score ?? -1;
      const bP10 = b.p10Score ?? -1;
      if (aP10 !== bP10) return bP10 - aP10;

      const aMean = a.meanScore ?? -1;
      const bMean = b.meanScore ?? -1;
      if (aMean !== bMean) return bMean - aMean;

      const aStd = a.standardDeviation ?? 999;
      const bStd = b.standardDeviation ?? 999;
      return aStd - bStd;
    });
}

// ── Public summary builder ────────────────────────────────────────────────────

export function buildSummary(
  jobs: BenchmarkJob[],
  attempts: JobAttempt[],
  scores: ManualScore[] = [],
  evidence: EvidenceRecord | null = null,
  assessments: Record<string, AutomaticAssessment> = {}
): ExperimentSummary {
  const statusCounts = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as ExperimentSummary['statusCounts'];
  for (const job of jobs) statusCounts[job.status]++;

  const finalAttempts = finalAttemptMap(attempts);
  let jsonInvalid = 0;
  let schemaInvalid = 0;
  let retryableFailures = 0;

  for (const job of jobs) {
    const attempt = finalAttempts.get(job.id);
    if (!attempt) continue;
    if (job.status === 'succeeded' && !attempt.jsonParseValid) jsonInvalid++;
    if (job.status === 'succeeded' && attempt.jsonParseValid && !attempt.schemaValid) schemaInvalid++;
    if (
      job.status === 'failed' &&
      isRetryable({
        providerStatus: attempt.providerStatus,
        providerErrorCode: attempt.providerErrorCode,
        isOutputValidationFailure: false,
      })
    ) {
      retryableFailures++;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    statusCounts,
    jsonInvalid,
    schemaInvalid,
    retryableFailures,
    aggregates: aggregateByConfig(jobs, attempts, scores, evidence, assessments),
  };
}

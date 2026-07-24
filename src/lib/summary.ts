import {
  BenchmarkJob,
  ConfigAggregate,
  ExperimentSummary,
  JOB_STATUSES,
  JobAttempt,
  ManualScore,
  SCORING_CATEGORIES,
  EvidenceRecord,
} from '@/types';
import { isRetryable } from './retry';
import { autoScore, combineAutoAndManualScores } from '@/lib/auto-score';

export function finalAttemptMap(attempts: JobAttempt[]): Map<string, JobAttempt> {
  const map = new Map<string, JobAttempt>();
  for (const attempt of attempts) {
    const existing = map.get(attempt.jobId);
    if (!existing || attempt.attempt > existing.attempt) map.set(attempt.jobId, attempt);
  }
  return map;
}

export function manualScoreTotal(score: ManualScore | undefined): number | null {
  if (!score) return null;
  let total = 0;
  let complete = true;
  for (const category of SCORING_CATEGORIES) {
    const value = score.scores[category.key];
    if (typeof value !== 'number') {
      complete = false;
      continue;
    }
    total += value;
  }
  return complete ? total : null;
}

export function aggregateByConfig(
  jobs: BenchmarkJob[],
  attempts: JobAttempt[],
  scores: ManualScore[] = [],
  evidence: EvidenceRecord | null = null
): ConfigAggregate[] {
  const finalAttempts = finalAttemptMap(attempts);
  const scoreByIdentity = new Map(scores.map((score) => [`${score.jobId}__${score.attempt}`, score]));
  const groups = new Map<
    string,
    ConfigAggregate & {
      jsonValidCount: number;
      schemaValidCount: number;
      latencySum: number;
      latencyCount: number;
      manualScoreSum: number;
      autoScoreSum: number;
      humanJudgmentScoreSum: number;
      combinedScoreSum: number;
    }
  >();

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
        averageManualScore: null,
        scoredTrials: 0,
        averageAutoScore: null,
        autoScoredTrials: 0,
        averageHumanJudgmentScore: null,
        humanJudgmentScoredTrials: 0,
        averageCombinedScore: null,
        combinedScoredTrials: 0,
        rankingEligibleTrials: 0,
        jsonValidCount: 0,
        schemaValidCount: 0,
        latencySum: 0,
        latencyCount: 0,
        manualScoreSum: 0,
        autoScoreSum: 0,
        humanJudgmentScoreSum: 0,
        combinedScoreSum: 0,
      };
      groups.set(key, group);
    }

    group.totalTrials++;
    if (job.status === 'succeeded') {
      group.providerSucceeded++;
      group.completedTrials++;
    }
    if (job.status === 'failed') {
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
    const manual = scoreByIdentity.get(`${job.id}__${attempt.attempt}`);
    const total = manualScoreTotal(manual);
    if (total != null) {
      group.manualScoreSum += total;
      group.scoredTrials++;
    }

    const automatic = autoScore({
      parsedJson: attempt.parsedJson,
      schemaValid: attempt.schemaValid,
      evidence,
    });

    const combined = combineAutoAndManualScores({
      auto: automatic,
      manualScores: manual?.scores,
    });

    if (automatic.autoTotal != null) {
      group.autoScoreSum += automatic.autoTotal;
      group.autoScoredTrials += 1;
    }

    if (combined.humanJudgmentScore != null) {
      group.humanJudgmentScoreSum += combined.humanJudgmentScore;
      group.humanJudgmentScoredTrials += 1;
    }

    if (combined.eligibleForRanking && combined.combinedScore != null) {
      group.combinedScoreSum += combined.combinedScore;
      group.combinedScoredTrials += 1;
      group.rankingEligibleTrials += 1;
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      model: group.model,
      temperature: group.temperature,
      thinkingLevel: group.thinkingLevel,
      totalTrials: group.totalTrials,
      completedTrials: group.completedTrials,
      providerSucceeded: group.providerSucceeded,
      providerFailed: group.providerFailed,
      jsonParseValidRate: group.completedTrials ? group.jsonValidCount / group.completedTrials : 0,
      schemaValidRate: group.completedTrials ? group.schemaValidCount / group.completedTrials : 0,
      averageLatencyMs: group.latencyCount ? Math.round(group.latencySum / group.latencyCount) : null,
      averageManualScore: group.scoredTrials
        ? Math.round((group.manualScoreSum / group.scoredTrials) * 100) / 100
        : null,
      scoredTrials: group.scoredTrials,
      averageAutoScore: group.autoScoredTrials
        ? Math.round((group.autoScoreSum / group.autoScoredTrials) * 100) / 100
        : null,
      autoScoredTrials: group.autoScoredTrials,
      averageHumanJudgmentScore: group.humanJudgmentScoredTrials
        ? Math.round((group.humanJudgmentScoreSum / group.humanJudgmentScoredTrials) * 100) / 100
        : null,
      humanJudgmentScoredTrials: group.humanJudgmentScoredTrials,
      averageCombinedScore: group.combinedScoredTrials
        ? Math.round((group.combinedScoreSum / group.combinedScoredTrials) * 100) / 100
        : null,
      combinedScoredTrials: group.combinedScoredTrials,
      rankingEligibleTrials: group.rankingEligibleTrials,
    }))
    .sort((a, b) => {
      if (a.temperature !== b.temperature) return a.temperature - b.temperature;
      const thinkingOrder = { low: 0, medium: 1, high: 2 } as const;
      if (a.thinkingLevel !== b.thinkingLevel) {
        return thinkingOrder[a.thinkingLevel] - thinkingOrder[b.thinkingLevel];
      }
      return a.model.localeCompare(b.model);
    });
}

export function buildSummary(
  jobs: BenchmarkJob[],
  attempts: JobAttempt[],
  scores: ManualScore[] = [],
  evidence: EvidenceRecord | null = null
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
    aggregates: aggregateByConfig(jobs, attempts, scores, evidence),
  };
}

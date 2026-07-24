import { randomUUID } from 'node:crypto';
import type { JudgeAttempt, JudgeJob, SupportedMime } from '@/types';
import { callJudge } from './judge-client';
import { autoScore } from './auto-score';
import { mergeAutomaticAssessment } from './merge-assessment';
import { isRetryable, computeBackoffMs, MAX_RETRY_ATTEMPTS } from './retry';
import { matchEvidence } from './evidence';
import {
  appendJudgeAttempt,
  readAttempts,
  readAutomaticAssessments,
  readEvidence,
  readJudgeJobs,
  readManifest,
  readScores,
  readSourceImage,
  readTextArtifact,
  updateJudgeJob,
  writeAutomaticAssessment,
  writeJudgeJobs,
  writeManifest,
  writeSummary,
} from './storage';
import { buildSummary } from './summary';

const JUDGE_CONCURRENCY = 4;
const MAX_JUDGE_RETRY_ATTEMPTS = 3;

// ── Judge-retryable error codes (subset of extraction retryable) ──────────────
// Do not retry: invalid_request, judge_schema_invalid, malformed image errors

const JUDGE_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const JUDGE_RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'network_interruption',
  'connection_reset',
  'request_timeout',
  'empty_output',
]);

function isJudgeRetryable(providerStatus: number | null, providerErrorCode: string | null): boolean {
  if (providerStatus != null && JUDGE_RETRYABLE_STATUSES.has(providerStatus)) return true;
  if (providerErrorCode && JUDGE_RETRYABLE_CODES.has(providerErrorCode)) return true;
  return false;
}

// ── Active run tracking ───────────────────────────────────────────────────────

const activeJudgeRuns = new Map<string, Promise<void>>();

export function startJudgeRun(experimentId: string): Promise<void> {
  const existing = activeJudgeRuns.get(experimentId);
  if (existing) return existing;
  const promise = executeJudgeRun(experimentId).finally(() => {
    activeJudgeRuns.delete(experimentId);
  });
  activeJudgeRuns.set(experimentId, promise);
  return promise;
}

export function isJudgeRunActive(experimentId: string): boolean {
  return activeJudgeRuns.has(experimentId);
}

// ── Main judge execution ──────────────────────────────────────────────────────

async function executeJudgeRun(experimentId: string): Promise<void> {
  let manifest = await readManifest(experimentId);

  // Transition to scoring
  manifest.status = 'scoring';
  manifest.updatedAt = new Date().toISOString();
  await writeManifest(manifest);

  try {
    // Load shared resources once
    const [sourceImageBuffer, promptText, judgeJobs, evidenceAll] = await Promise.all([
      readSourceImage(experimentId, `source-image.${manifest.image.detectedExtension}`),
      readTextArtifact(experimentId, 'prompt.txt'),
      readJudgeJobs(experimentId),
      readEvidence(experimentId),
    ]);

    const evidence = matchEvidence(
      evidenceAll,
      manifest.image.originalFilename,
      manifest.evidenceReviews ?? {}
    );
    const activeEvidence = evidence[0] ?? null;

    const imageBase64 = sourceImageBuffer.toString('base64');
    const mimeType = manifest.image.detectedMimeType as SupportedMime;

    // Filter to queued jobs only
    const queuedJobs = judgeJobs.filter((j) => j.status === 'queued');

    // Run with bounded concurrency
    let index = 0;
    let hasFailures = false;

    async function worker(): Promise<void> {
      while (index < queuedJobs.length) {
        const job = queuedJobs[index++];
        if (!job) break;
        const failed = await runOneJudgeJob({
          experimentId,
          job,
          imageBase64,
          mimeType,
          flashContract: promptText,
          evidence: activeEvidence,
        });
        if (failed) hasFailures = true;

        // Rebuild summary after each completed judge result
        await rebuildSummary(experimentId);
      }
    }

    const workers = Array.from({ length: JUDGE_CONCURRENCY }, () => worker());
    await Promise.all(workers);

    // Determine final status
    manifest = await readManifest(experimentId);
    manifest.status = hasFailures ? 'complete_with_scoring_errors' : 'complete';
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(manifest);

    // Final summary rebuild
    await rebuildSummary(experimentId);
  } catch (error) {
    manifest = await readManifest(experimentId);
    manifest.status = 'complete_with_scoring_errors';
    manifest.lastError = error instanceof Error ? error.message : String(error);
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(manifest);
  }
}

// ── Single judge job execution with retries ───────────────────────────────────

interface RunOneInput {
  experimentId: string;
  job: JudgeJob;
  imageBase64: string;
  mimeType: SupportedMime;
  flashContract: string;
  evidence: import('@/types').EvidenceRecord | null;
}

/** Returns true if the job ultimately failed (non-transient or exhausted retries). */
async function runOneJudgeJob(input: RunOneInput): Promise<boolean> {
  const { experimentId, job, imageBase64, mimeType, flashContract, evidence } = input;

  // Load the extraction attempt that this judge job covers
  const allAttempts = await readAttempts(experimentId);
  const extractionAttempt = allAttempts.find(
    (a) => a.jobId === job.extractionJobId && a.attempt === job.extractionAttemptNumber
  );

  if (!extractionAttempt?.rawOutputText) {
    // Extraction attempt not found — mark judge job failed
    await updateJudgeJob(experimentId, job.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
    });
    return true;
  }

  await updateJudgeJob(experimentId, job.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  let attemptNumber = 0;

  while (attemptNumber < MAX_JUDGE_RETRY_ATTEMPTS) {
    attemptNumber++;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    const result = await callJudge({
      imageBase64,
      mimeType,
      extractionResponseText: extractionAttempt.rawOutputText,
      parsedJson: extractionAttempt.parsedJson,
      flashContract,
      evidence,
    });

    const completedAt = new Date().toISOString();
    const latencyMs = Date.now() - startMs;

    const attempt: JudgeAttempt = {
      judgeJobId: job.id,
      attempt: attemptNumber,
      model: 'gemini-3.1-pro-preview',
      temperature: 0.2,
      topP: 0.95,
      thinkingLevel: 'high',
      startedAt,
      completedAt,
      latencyMs,
      providerStatus: result.providerStatus,
      providerErrorCode: result.providerErrorCode,
      providerErrorMessage: result.providerErrorMessage,
      rawOutputText: result.rawOutputText,
      parsedOutput: result.parsedOutput,
      schemaValid: result.schemaValid,
      schemaIssues: result.schemaIssues,
      usage: result.usage,
    };

    await appendJudgeAttempt(experimentId, attempt);

    if (result.ok && result.parsedOutput) {
      // Success — compute and persist the automatic assessment
      const detResult = autoScore({
        parsedJson: extractionAttempt.parsedJson,
        schemaValid: extractionAttempt.schemaValid,
        evidence,
      });

      const assessment = mergeAutomaticAssessment({
        deterministicResult: detResult,
        judgeResult: result.parsedOutput,
        scoreStatus: 'scored',
        judgeJobId: job.id,
      });

      const assessmentKey = `${experimentId}/${job.extractionJobId}/${job.extractionAttemptNumber}/${job.id}`;
      await writeAutomaticAssessment(experimentId, assessmentKey, assessment);

      await updateJudgeJob(experimentId, job.id, {
        status: 'succeeded',
        completedAt,
      });

      return false; // success
    }

    // Failed — check if schema-invalid (do not retry)
    if (!isJudgeRetryable(result.providerStatus, result.providerErrorCode)) {
      break;
    }

    // Transient — back off and retry
    if (attemptNumber < MAX_JUDGE_RETRY_ATTEMPTS) {
      const backoffMs = computeBackoffMs(attemptNumber, result.retryAfterSeconds);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  // All retries exhausted — mark failed
  await updateJudgeJob(experimentId, job.id, {
    status: 'failed',
    completedAt: new Date().toISOString(),
  });

  // Persist a judge_failed assessment
  const detResult = autoScore({
    parsedJson: extractionAttempt.parsedJson,
    schemaValid: extractionAttempt.schemaValid,
    evidence,
  });

  const assessment = mergeAutomaticAssessment({
    deterministicResult: detResult,
    judgeResult: null,
    scoreStatus: 'judge_failed',
    judgeJobId: job.id,
  });

  const assessmentKey = `${job.extractionJobId}__${job.extractionAttemptNumber}`;
  await writeAutomaticAssessment(experimentId, assessmentKey, assessment);

  return true; // failed
}

// ── Summary rebuild helper ────────────────────────────────────────────────────

async function rebuildSummary(experimentId: string): Promise<void> {
  const [manifest, jobs, attempts, scores, evidenceAll, assessments] = await Promise.all([
    readManifest(experimentId),
    readJudgeJobs(experimentId).then(() => import('./storage').then((s) => s.readJobs(experimentId))),
    readAttempts(experimentId),
    readScores(experimentId),
    readEvidence(experimentId),
    readAutomaticAssessments(experimentId),
  ]);

  const evidence = matchEvidence(
    evidenceAll,
    manifest.image.originalFilename,
    manifest.evidenceReviews ?? {}
  );

  const summary = buildSummary(jobs, attempts, scores, evidence[0] ?? null, assessments);
  await writeSummary(experimentId, summary);
}

// ── Create judge jobs from completed extraction ───────────────────────────────

/**
 * Creates JudgeJob records for every schema-valid extraction attempt.
 * Called by the extraction queue when all extraction jobs are terminal.
 */
export async function createJudgeJobs(
  experimentId: string,
  finalAttemptMap: Map<string, import('@/types').JobAttempt>
): Promise<JudgeJob[]> {
  const now = new Date().toISOString();
  const judgeJobs: JudgeJob[] = [];

  for (const [extractionJobId, attempt] of finalAttemptMap.entries()) {
    // Only create judge jobs for schema-valid, parse-valid attempts
    if (!attempt.jsonParseValid || !attempt.schemaValid) continue;

    judgeJobs.push({
      id: `judge-${randomUUID().slice(0, 8)}`,
      experimentId,
      extractionJobId,
      extractionAttemptNumber: attempt.attempt,
      status: 'queued',
      createdAt: now,
      startedAt: null,
      completedAt: null,
    });
  }

  await writeJudgeJobs(experimentId, judgeJobs);
  return judgeJobs;
}

// Re-export for use from queue.ts
export { isRetryable, computeBackoffMs };

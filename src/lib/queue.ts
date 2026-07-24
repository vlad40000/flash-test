import { BenchmarkJob, CONCURRENCY, ExperimentManifest, JobAttempt } from '@/types';
import {
  appendAttempt,
  readAttempts,
  readEvidence,
  readJobs,
  readManifest,
  readScores,
  readSourceImage,
  readTextArtifact,
  writeJobs,
  writeManifest,
  writeRawResponse,
  writeSummary,
} from './storage';
import { matchEvidence } from './evidence';
import { callThemeExtraction } from './gemini-client';
import { computeBackoffMs, isRetryable, MAX_RETRY_ATTEMPTS } from './retry';
import { validateOutput } from './validate-output';
import { buildSummary } from './summary';

interface RunState {
  experimentId: string;
  jobs: BenchmarkJob[];
  paused: boolean;
  stopRequested: boolean;
  activeWorkers: number;
  running: boolean;
  manifest: ExperimentManifest;
  systemInstruction: string;
  prompt: string;
  responseJsonSchema: unknown;
  imageBase64: string;
  mimeType: ExperimentManifest['image']['detectedMimeType'];
  attemptCounts: Map<string, number>;
}

const runs = new Map<string, RunState>();
const runPromises = new Map<string, Promise<void>>();

export interface PublicRunState {
  running: boolean;
  paused: boolean;
  stopRequested: boolean;
  activeWorkers: number;
}

export function getRunState(experimentId: string): PublicRunState | null {
  const state = runs.get(experimentId);
  if (!state) return null;
  return {
    running: state.running,
    paused: state.paused,
    stopRequested: state.stopRequested,
    activeWorkers: state.activeWorkers,
  };
}

export async function startRun(experimentId: string): Promise<void> {
  const existing = runPromises.get(experimentId);
  if (existing) return existing;

  const run = executeRun(experimentId).finally(() => {
    if (runPromises.get(experimentId) === run) runPromises.delete(experimentId);
  });
  runPromises.set(experimentId, run);
  return run;
}

async function executeRun(experimentId: string): Promise<void> {
  const live = runs.get(experimentId);
  if (live?.running) return;

  const manifest = await readManifest(experimentId);
  const jobs = await readJobs(experimentId);
  const priorAttempts = await readAttempts(experimentId);

  // A Node restart can leave jobs persisted as running. No provider call survives that restart,
  // so those logical jobs must return to the queue while retaining their previous attempts.
  for (const job of jobs) {
    if (job.status === 'running') {
      job.status = 'queued';
      job.startedAt = null;
      job.completedAt = null;
      job.workerNumber = null;
    }
  }

  const remaining = jobs.some((job) => job.status === 'queued');
  if (!remaining) {
    manifest.status = jobs.every((job) => job.status === 'succeeded' || job.status === 'failed')
      ? 'completed'
      : manifest.status;
    await writeManifest(manifest);
    const evidenceAll = await readEvidence(experimentId);
    const evidence = matchEvidence(evidenceAll, manifest.image.originalFilename, manifest.evidenceReviews ?? {});
    await writeSummary(experimentId, buildSummary(jobs, priorAttempts, await readScores(experimentId), evidence[0] ?? null));
    return;
  }

  const responseJsonSchema = JSON.parse(await readTextArtifact(experimentId, 'response-schema.json'));
  const imageBytes = await readSourceImage(experimentId, `source-image.${manifest.image.detectedExtension}`);
  const attemptCounts = new Map<string, number>();
  for (const attempt of priorAttempts) {
    attemptCounts.set(attempt.jobId, Math.max(attemptCounts.get(attempt.jobId) ?? 0, attempt.attempt));
  }

  const state: RunState = {
    experimentId,
    jobs,
    paused: false,
    stopRequested: false,
    activeWorkers: 0,
    running: true,
    manifest,
    systemInstruction: await readTextArtifact(experimentId, 'system-instruction.txt'),
    prompt: await readTextArtifact(experimentId, 'prompt.txt'),
    responseJsonSchema,
    imageBase64: imageBytes.toString('base64'),
    mimeType: manifest.image.detectedMimeType,
    attemptCounts,
  };
  runs.set(experimentId, state);

  manifest.status = 'running';
  manifest.lastError = null;
  await writeJobs(experimentId, jobs);
  await writeManifest(manifest);

  try {
    const workers = Array.from({ length: CONCURRENCY }, (_, index) => runWorker(state, index + 1));
    await Promise.all(workers);

    if (state.stopRequested) {
      manifest.status = 'stopped';
    } else if (state.paused) {
      manifest.status = 'paused';
    } else if (state.jobs.every((job) => job.status === 'succeeded' || job.status === 'failed')) {
      manifest.status = 'completed';
    } else {
      manifest.status = 'paused';
    }
  } catch (error) {
    manifest.status = 'paused';
    manifest.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    state.running = false;
    await writeJobs(experimentId, state.jobs);
    await writeManifest(manifest);
    const [attempts, scores, evidenceAll] = await Promise.all([readAttempts(experimentId), readScores(experimentId), readEvidence(experimentId)]);
    const evidence = matchEvidence(evidenceAll, manifest.image.originalFilename, manifest.evidenceReviews ?? {});
    await writeSummary(experimentId, buildSummary(state.jobs, attempts, scores, evidence[0] ?? null));
  }
}

export async function pauseRun(experimentId: string): Promise<boolean> {
  const state = runs.get(experimentId);
  if (!state?.running) return false;
  state.paused = true;
  state.manifest.status = 'paused';
  await writeManifest(state.manifest);
  return true;
}

export async function resumeRun(experimentId: string): Promise<'resumed' | 'started'> {
  const state = runs.get(experimentId);
  if (state?.running) {
    state.paused = false;
    state.manifest.status = 'running';
    await writeManifest(state.manifest);
    return 'resumed';
  }
  return 'started';
}

export async function stopRun(experimentId: string): Promise<void> {
  const state = runs.get(experimentId);
  if (state?.running) {
    state.stopRequested = true;
    state.paused = false;
    state.manifest.status = 'stopped';
    await writeManifest(state.manifest);
    return;
  }

  const [manifest, jobs] = await Promise.all([readManifest(experimentId), readJobs(experimentId)]);
  for (const job of jobs) {
    if (job.status === 'queued') job.status = 'stopped';
  }
  manifest.status = 'stopped';
  await Promise.all([writeJobs(experimentId, jobs), writeManifest(manifest)]);
}

async function runWorker(state: RunState, workerNumber: number): Promise<void> {
  state.activeWorkers++;
  try {
    while (true) {
      if (state.stopRequested) {
        markRemainingStopped(state);
        return;
      }
      if (state.paused) {
        await sleep(250);
        continue;
      }

      const claimed = claimNextJobInWave(state);
      if (claimed === 'wait') {
        await sleep(100);
        continue;
      }
      if (claimed == null) return;

      claimed.status = 'running';
      claimed.startedAt = new Date().toISOString();
      claimed.workerNumber = workerNumber;
      await writeJobs(state.experimentId, state.jobs);

      await runJobWithRetries(state, claimed);
      await writeJobs(state.experimentId, state.jobs);
    }
  } finally {
    state.activeWorkers--;
  }
}

function claimNextJobInWave(state: RunState): BenchmarkJob | 'wait' | null {
  const outstanding = state.jobs.filter((job) => job.status === 'queued' || job.status === 'running');
  if (outstanding.length === 0) return null;

  const currentWave = Math.min(...outstanding.map((job) => job.waveNumber));
  const queued = state.jobs.find((job) => job.waveNumber === currentWave && job.status === 'queued');
  if (queued) {
    // Claim synchronously before any await so another worker cannot take the same job.
    queued.status = 'running';
    return queued;
  }
  return 'wait';
}

function markRemainingStopped(state: RunState): void {
  for (const job of state.jobs) {
    if (job.status === 'queued') job.status = 'stopped';
  }
}

async function runJobWithRetries(state: RunState, job: BenchmarkJob): Promise<void> {
  let attemptNumber = (state.attemptCounts.get(job.id) ?? 0) + 1;

  while (true) {
    while (state.paused && !state.stopRequested) {
      await sleep(250);
    }
    if (state.stopRequested) {
      job.status = 'stopped';
      job.completedAt = new Date().toISOString();
      return;
    }

    const attemptStart = new Date().toISOString();
    const startedMs = Date.now();
    const result = await callThemeExtraction({
      job,
      systemInstruction: state.systemInstruction,
      prompt: state.prompt,
      imageBase64: state.imageBase64,
      mimeType: state.mimeType,
      responseJsonSchema: state.responseJsonSchema,
    });

    const latencyMs = Date.now() - startedMs;
    const validation = result.ok && result.outputText != null
      ? validateOutput(result.outputText, state.responseJsonSchema)
      : {
          jsonParseValid: false,
          schemaValid: false,
          schemaIssues: result.providerErrorMessage ? [result.providerErrorMessage] : [],
          parsedJson: null,
          recoveryPossible: false,
        };

    if (result.outputText != null) {
      await writeRawResponse(state.experimentId, job.id, attemptNumber, result.outputText);
    }

    const attempt: JobAttempt = {
      jobId: job.id,
      attempt: attemptNumber,
      startedAt: attemptStart,
      completedAt: new Date().toISOString(),
      latencyMs,
      providerStatus: result.providerStatus,
      providerErrorCode: result.providerErrorCode,
      providerErrorMessage: result.providerErrorMessage,
      retryAfterSeconds: result.retryAfterSeconds,
      interactionId: result.interactionId,
      rawOutputText: result.outputText,
      parsedJson: validation.parsedJson,
      jsonParseValid: validation.jsonParseValid,
      schemaValid: validation.schemaValid,
      schemaIssues: validation.schemaIssues,
      recoveryPossible: validation.recoveryPossible,
      usage: result.usage,
    };
    await appendAttempt(state.experimentId, attempt);
    state.attemptCounts.set(job.id, attemptNumber);

    if (result.ok) {
      job.status = 'succeeded';
      job.completedAt = new Date().toISOString();
      return;
    }

    const retryable = isRetryable({
      providerStatus: result.providerStatus,
      providerErrorCode: result.providerErrorCode,
      isOutputValidationFailure: false,
    });

    if (!retryable || attemptNumber >= MAX_RETRY_ATTEMPTS || state.stopRequested) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      return;
    }

    await sleep(computeBackoffMs(attemptNumber, result.retryAfterSeconds));
    attemptNumber++;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

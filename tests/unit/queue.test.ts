import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BenchmarkJob, ExperimentManifest, JobAttempt } from '@/types';
import { generateJobMatrix } from '@/lib/matrix';

const manifestFixture: ExperimentManifest = {
  experimentId: 'exp-20260724-deadbeef',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  seed: 1,
  sdkVersion: '2.13.0',
  image: {
    originalFilename: 'source.png', detectedMimeType: 'image/png', detectedExtension: 'png', byteLength: 4, sha256: 'deadbeef',
  },
  prompt: { sha256: 'a', byteLength: 2 },
  systemInstruction: { sha256: 'b', byteLength: 2 },
  schema: { sha256: 'c', byteLength: 2 },
  locked: {
    models: ['gemini-3.5-flash', 'gemini-3.1-pro-preview'], temperatures: [0.2, 0.4, 0.8, 1.0],
    thinkingLevels: ['low', 'medium', 'high'], topP: 0.95, maxOutputTokens: 65536, concurrency: 4,
    structuredOutput: true, store: false, transport: 'interactions',
  },
  trials: 1,
  totalCalls: 24,
  status: 'created',
  lastError: null,
};

let jobsState: BenchmarkJob[] = [];
let attemptsState: JobAttempt[] = [];
let concurrentInFlight = 0;
let peakConcurrency = 0;
const activeWaveCounts = new Map<number, number>();
let mixedWavesObserved = false;

vi.mock('@/lib/storage', () => ({
  readManifest: async () => manifestFixture,
  readEvidence: async () => [],
  readJobs: async () => jobsState,
  writeJobs: async (_id: string, jobs: BenchmarkJob[]) => { jobsState = jobs; },
  readJudgeJobs: async () => [],
  writeManifest: async () => {},
  readTextArtifact: async (id: string, name: string) => name === 'response-schema.json' ? '{"type":"object"}' : '{}',
  readSourceImage: async () => Buffer.from([1, 2, 3]),
  appendAttempt: async (_id: string, attempt: JobAttempt) => { attemptsState.push(attempt); },
  readAttempts: async () => attemptsState,
  readScores: async () => [],
  writeSummary: async () => {},
  writeRawResponse: async () => {},
  readAutomaticAssessments: async () => ({}),
}));

vi.mock('@/lib/gemini-client', () => ({
  callThemeExtraction: vi.fn(async ({ job }: { job: BenchmarkJob }) => {
    concurrentInFlight++;
    activeWaveCounts.set(job.waveNumber, (activeWaveCounts.get(job.waveNumber) ?? 0) + 1);
    mixedWavesObserved ||= activeWaveCounts.size > 1;
    peakConcurrency = Math.max(peakConcurrency, concurrentInFlight);
    await new Promise((resolve) => setTimeout(resolve, 15));
    concurrentInFlight--;
    const remaining = (activeWaveCounts.get(job.waveNumber) ?? 1) - 1;
    if (remaining === 0) activeWaveCounts.delete(job.waveNumber);
    else activeWaveCounts.set(job.waveNumber, remaining);
    return {
      ok: true, interactionId: 'int_1', outputText: '{}', usage: null, providerStatus: 200,
      providerErrorCode: null, providerErrorMessage: null, retryAfterSeconds: null,
    };
  }),
}));

vi.mock('@/lib/judge-queue', () => ({
  createJudgeJobs: async () => [],
  startJudgeRun: async () => {},
  isJudgeRunActive: () => false,
  isRetryable: () => false,
  computeBackoffMs: () => 0,
}));

describe('startRun concurrency', () => {
  beforeEach(() => {
    vi.resetModules();
    jobsState = generateJobMatrix('exp-20260724-deadbeef', 1, 1);
    attemptsState = [];
    concurrentInFlight = 0;
    peakConcurrency = 0;
    activeWaveCounts.clear();
    mixedWavesObserved = false;
  });

  it('never exceeds four simultaneous provider calls', async () => {
    const { startRun } = await import('@/lib/queue');
    await startRun('exp-20260724-deadbeef');
    expect(peakConcurrency).toBe(4);
    expect(jobsState.every((job) => job.status === 'succeeded')).toBe(true);
  });

  it('does not overlap jobs from different waves', async () => {
    const { startRun } = await import('@/lib/queue');
    await startRun('exp-20260724-deadbeef');
    expect(mixedWavesObserved).toBe(false);
  });
});

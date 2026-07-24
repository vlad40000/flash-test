import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncPhase } from '@/lib/queue';

let manifestState = { status: 'extraction_complete' };
let judgeJobsState: any[] = [];
let writeJudgeJobsCallCount = 0;

vi.mock('@/lib/storage', () => ({
  readManifest: async () => manifestState,
  readJobs: async () => [{ id: 'job_1' }],
  readJudgeJobs: async () => judgeJobsState,
  writeJudgeJobs: async (_id: string, jobs: any[]) => {
    judgeJobsState = jobs;
    writeJudgeJobsCallCount++;
  },
  readAttempts: async () => [{ jobId: 'job_1', attempt: 1 }],
}));

vi.mock('@/lib/judge-queue', () => ({
  createJudgeJobs: vi.fn(async () => {
    judgeJobsState = [{ id: 'judge_1', status: 'queued', startedAt: null }];
  }),
  startJudgeRun: vi.fn(),
  isJudgeRunActive: vi.fn(() => false),
}));

describe('Judge Coordinator', () => {
  beforeEach(() => {
    manifestState = { status: 'extraction_complete' };
    judgeJobsState = [];
    writeJudgeJobsCallCount = 0;
    vi.clearAllMocks();
  });

  it('should idempotently transition extraction_complete into judge jobs', async () => {
    const { createJudgeJobs, startJudgeRun } = await import('@/lib/judge-queue');
    await syncPhase('exp-123');
    expect(createJudgeJobs).toHaveBeenCalledTimes(1);
    expect(startJudgeRun).toHaveBeenCalledTimes(1);

    // Call again, should not create judge jobs again
    await syncPhase('exp-123');
    expect(createJudgeJobs).toHaveBeenCalledTimes(1);
    expect(startJudgeRun).toHaveBeenCalledTimes(2);
  });

  it('should recover stale judging jobs', async () => {
    const { startJudgeRun } = await import('@/lib/judge-queue');
    // Set up a stale job (started 6 minutes ago)
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    judgeJobsState = [{ id: 'judge_1', status: 'running', startedAt: sixMinutesAgo }];

    await syncPhase('exp-123');

    expect(judgeJobsState[0].status).toBe('queued');
    expect(judgeJobsState[0].startedAt).toBeNull();
    expect(writeJudgeJobsCallCount).toBe(1);
    expect(startJudgeRun).toHaveBeenCalledTimes(1);
  });

  it('should ignore recent judging jobs', async () => {
    const { startJudgeRun } = await import('@/lib/judge-queue');
    // Set up a recent job (started 1 minute ago)
    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    judgeJobsState = [{ id: 'judge_1', status: 'running', startedAt: oneMinuteAgo }];

    await syncPhase('exp-123');

    expect(judgeJobsState[0].status).toBe('running'); // unchanged
    expect(writeJudgeJobsCallCount).toBe(0); // no update written
    expect(startJudgeRun).toHaveBeenCalledTimes(1);
  });

  it('should not start judge run if already complete', async () => {
    const { startJudgeRun } = await import('@/lib/judge-queue');
    manifestState = { status: 'complete' };
    await syncPhase('exp-123');
    expect(startJudgeRun).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { syncPhase } from '@/lib/queue';

// Mock storage and queue dependencies
vi.mock('@/lib/storage', () => ({
  readManifest: async () => ({ status: 'extraction_complete' }),
  readJobs: async () => [{ id: 'job_1' }],
  readJudgeJobs: async () => [],
  readAttempts: async () => [{ jobId: 'job_1', attempt: 1 }],
}));

vi.mock('@/lib/judge-queue', () => ({
  createJudgeJobs: vi.fn(),
  startJudgeRun: vi.fn(),
  isJudgeRunActive: vi.fn(() => false),
}));

describe('Judge Coordinator', () => {
  it('should idempotently transition extraction_complete into judge jobs and start judge run', async () => {
    const { createJudgeJobs, startJudgeRun } = await import('@/lib/judge-queue');
    await syncPhase('exp-123');
    expect(createJudgeJobs).toHaveBeenCalledTimes(1);
    expect(startJudgeRun).toHaveBeenCalledTimes(1);
  });
});

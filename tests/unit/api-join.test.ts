import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/experiments/[id]/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/queue', () => ({
  getRunState: vi.fn(),
  syncPhase: vi.fn(async () => {}), // Returns a promise to test fire-and-forget
}));

vi.mock('@/lib/storage', () => ({
  readManifest: async () => ({ image: { originalFilename: 'img.jpg' } }),
  readJobs: async () => [],
  readEvidence: async () => [],
  readScores: async () => ({}),
  readAttempts: async () => [
    { jobId: 'job-1', attempt: 1, jsonParseValid: true, schemaValid: true },
    { jobId: 'job-1', attempt: 2, jsonParseValid: true, schemaValid: true }
  ],
  readJudgeJobs: async () => [
    { id: 'jj-1', extractionJobId: 'job-1', extractionAttemptNumber: 2, status: 'succeeded' }
  ],
  readJudgeAttempts: async () => [],
  readAutomaticAssessments: async () => ({
    // Note how we key the assessment using the canonical key
    'job-1__2': { scoreStatus: 'scored', totalScore: 90 },
    'job-1__1': { scoreStatus: 'scored', totalScore: 50 },
  }),
  writeSummary: async () => {},
}));

describe('API Join Regression', () => {
  it('should join the correct assessment to the corresponding attempt', async () => {
    const req = new NextRequest('http://localhost/api/experiments/exp-20260724-12345678');
    const res = await GET(req, { params: Promise.resolve({ id: 'exp-20260724-12345678' }) });

    expect(res.status).toBe(200);
    const data = await res.json();

    // There are two attempts
    expect(data.attemptDetails.length).toBe(2);

    const attempt1 = data.attemptDetails.find((d: any) => d.attemptNumber === 1);
    const attempt2 = data.attemptDetails.find((d: any) => d.attemptNumber === 2);

    // Assessment 1 should attach to attempt 1
    expect(attempt1.automaticAssessment?.totalScore).toBe(50);

    // Assessment 2 should attach to attempt 2
    expect(attempt2.automaticAssessment?.totalScore).toBe(90);
    expect(attempt2.judge.status).toBe('scored');
  });
});

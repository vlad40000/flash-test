import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAutomaticAssessments, writeAutomaticAssessment } from '@/lib/storage';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const EXPERIMENT_ID = 'exp-20260724-12345678';

describe('Storage Assessments Logic', () => {
  beforeAll(async () => {
    // Ensure clean state
    try {
      await rm(path.join(process.cwd(), 'data', 'runs', EXPERIMENT_ID), { recursive: true, force: true });
    } catch (e) {}
  });

  afterAll(async () => {
    try {
      await rm(path.join(process.cwd(), 'data', 'runs', EXPERIMENT_ID), { recursive: true, force: true });
    } catch (e) {}
  });

  it('should round-trip a success assessment using the nested key', async () => {
    const key = `${EXPERIMENT_ID}/ext-job-1/1/judge-job-1`;
    await writeAutomaticAssessment(EXPERIMENT_ID, key, { scoreStatus: 'scored', totalScore: 1 } as any);

    const results = await readAutomaticAssessments(EXPERIMENT_ID);
    expect(results['ext-job-1__1']).toBeDefined();
    expect(results['ext-job-1__1']?.scoreStatus).toBe('scored');
  });

  it('should round-trip a judge_failed assessment using the nested key', async () => {
    const key = `${EXPERIMENT_ID}/ext-job-2/2/judge-job-2`;
    await writeAutomaticAssessment(EXPERIMENT_ID, key, { scoreStatus: 'judge_failed', totalScore: 2 } as any);

    const results = await readAutomaticAssessments(EXPERIMENT_ID);
    expect(results['ext-job-2__2']).toBeDefined();
    expect(results['ext-job-2__2']?.scoreStatus).toBe('judge_failed');
  });

  it('should filter out stale attempts', async () => {
    const key1 = `${EXPERIMENT_ID}/ext-job-3/1/judge-job-1`;
    await writeAutomaticAssessment(EXPERIMENT_ID, key1, { scoreStatus: 'scored', totalScore: 1 } as any);
    const key2 = `${EXPERIMENT_ID}/ext-job-3/2/judge-job-2`;
    await writeAutomaticAssessment(EXPERIMENT_ID, key2, { scoreStatus: 'scored', totalScore: 2 } as any);

    const results = await readAutomaticAssessments(EXPERIMENT_ID);
    expect(results['ext-job-3__1']).toBeUndefined();
    expect(results['ext-job-3__2']?.totalScore).toBe(2);
  });

  it('should deterministically resolve duplicate judge jobs', async () => {
    const keyA = `${EXPERIMENT_ID}/ext-job-4/1/judge-job-B`;
    await writeAutomaticAssessment(EXPERIMENT_ID, keyA, { scoreStatus: 'scored', totalScore: 200 } as any);
    const keyB = `${EXPERIMENT_ID}/ext-job-4/1/judge-job-A`;
    await writeAutomaticAssessment(EXPERIMENT_ID, keyB, { scoreStatus: 'scored', totalScore: 100 } as any);

    const results = await readAutomaticAssessments(EXPERIMENT_ID);
    expect(results['ext-job-4__1']?.totalScore).toBe(100);
  });
});

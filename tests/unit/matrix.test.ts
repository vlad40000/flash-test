import { describe, expect, it } from 'vitest';
import { buildCells, expectedJobCount, generateJobMatrix } from '@/lib/matrix';
import { MODELS, TEMPERATURES, THINKING_LEVELS } from '@/types';

describe('generateJobMatrix', () => {
  it('produces exactly 24 jobs for one trial', () => {
    const jobs = generateJobMatrix('exp-test', 1, 42);
    expect(jobs).toHaveLength(24);
    expect(expectedJobCount(1)).toBe(24);
  });

  it('produces exactly 72 jobs for three trials', () => {
    const jobs = generateJobMatrix('exp-test', 3, 42);
    expect(jobs).toHaveLength(72);
    expect(expectedJobCount(3)).toBe(72);
  });

  it('uses only the two approved models', () => {
    const jobs = generateJobMatrix('exp-test', 2, 1);
    const models = new Set(jobs.map((j) => j.model));
    expect(models).toEqual(new Set(MODELS));
    expect(MODELS).toEqual(['gemini-3.5-flash', 'gemini-3.1-pro-preview']);
  });

  it('uses only the four approved temperatures', () => {
    const jobs = generateJobMatrix('exp-test', 2, 1);
    const temps = new Set(jobs.map((j) => j.temperature));
    expect(temps).toEqual(new Set(TEMPERATURES));
    expect(TEMPERATURES).toEqual([0.2, 0.4, 0.8, 1.0]);
  });

  it('uses only the three approved thinking levels', () => {
    const jobs = generateJobMatrix('exp-test', 2, 1);
    const levels = new Set(jobs.map((j) => j.thinkingLevel));
    expect(levels).toEqual(new Set(THINKING_LEVELS));
    expect(THINKING_LEVELS).toEqual(['low', 'medium', 'high']);
  });

  it('top-P always equals 0.95', () => {
    const jobs = generateJobMatrix('exp-test', 2, 1);
    expect(jobs.every((j) => j.topP === 0.95)).toBe(true);
  });

  it('every job has all dimensions populated (no omission)', () => {
    const jobs = generateJobMatrix('exp-test', 1, 7);
    for (const job of jobs) {
      expect(job.model).toBeTruthy();
      expect(job.temperature).toBeDefined();
      expect(job.thinkingLevel).toBeTruthy();
      expect(job.trial).toBeGreaterThanOrEqual(1);
      expect(job.topP).toBe(0.95);
    }
  });

  it('produces a unique job id per (model, temperature, thinking, trial) combination', () => {
    const jobs = generateJobMatrix('exp-test', 2, 5);
    const ids = new Set(jobs.map((j) => j.id));
    expect(ids.size).toBe(jobs.length);
  });

  it('pairs both models within the same cell adjacently (paired-cell scheduling)', () => {
    const jobs = generateJobMatrix('exp-test', 1, 3);
    for (let i = 0; i < jobs.length; i += 2) {
      expect(jobs[i]!.cellId).toBe(jobs[i + 1]!.cellId);
      expect(jobs[i]!.model).not.toBe(jobs[i + 1]!.model);
    }
  });


  it('assigns exactly four jobs to each full wave', () => {
    const jobs = generateJobMatrix('exp-test', 1, 42);
    const waveCounts = new Map<number, number>();
    for (const job of jobs) waveCounts.set(job.waveNumber, (waveCounts.get(job.waveNumber) ?? 0) + 1);
    expect([...waveCounts.values()]).toEqual([4, 4, 4, 4, 4, 4]);
  });

  it('is deterministic for a given seed', () => {
    const a = generateJobMatrix('exp-test', 2, 99).map((j) => j.id);
    const b = generateJobMatrix('exp-test', 2, 99).map((j) => j.id);
    expect(a).toEqual(b);
  });

  it('produces a different cell order for a different seed (with overwhelming probability)', () => {
    const a = generateJobMatrix('exp-test', 2, 1).map((j) => j.cellId);
    const b = generateJobMatrix('exp-test', 2, 2).map((j) => j.cellId);
    expect(a).not.toEqual(b);
  });

  it('builds exactly 12 cells per trial', () => {
    expect(buildCells(1)).toHaveLength(12);
    expect(buildCells(3)).toHaveLength(36);
  });
});

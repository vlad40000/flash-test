import { describe, expect, it } from 'vitest';
import { buildSummary } from '@/lib/summary';
import { generateJobMatrix } from '@/lib/matrix';
import type { JobAttempt, ManualScore } from '@/types';

it('separates provider success from JSON and schema validity', () => {
  const jobs = generateJobMatrix('exp-20260724-deadbeef', 1, 1).slice(0, 3);
  jobs[0]!.status = 'succeeded';
  jobs[1]!.status = 'succeeded';
  jobs[2]!.status = 'failed';
  const base = { attempt: 1, startedAt: '', completedAt: '', latencyMs: 100, providerErrorCode: null, providerErrorMessage: null, retryAfterSeconds: null, interactionId: 'x', parsedJson: null, schemaIssues: [], recoveryPossible: false, usage: null };
  const attempts: JobAttempt[] = [
    { ...base, jobId: jobs[0]!.id, providerStatus: 200, rawOutputText: '{}', jsonParseValid: true, schemaValid: false },
    { ...base, jobId: jobs[1]!.id, providerStatus: 200, rawOutputText: 'bad', jsonParseValid: false, schemaValid: false },
    { ...base, jobId: jobs[2]!.id, providerStatus: 503, providerErrorCode: 'UNAVAILABLE', rawOutputText: null, jsonParseValid: false, schemaValid: false },
  ];
  const scores: ManualScore[] = [];
  const summary = buildSummary(jobs, attempts, scores);
  expect(summary.schemaInvalid).toBe(1);
  expect(summary.jsonInvalid).toBe(1);
  expect(summary.retryableFailures).toBe(1);
  const firstAggregate = summary.aggregates.find((item) => item.model === jobs[0]!.model && item.temperature === jobs[0]!.temperature && item.thinkingLevel === jobs[0]!.thinkingLevel);
  expect(firstAggregate?.completedTrials).toBe(1);
  expect(firstAggregate?.schemaValidRate).toBe(0);
});

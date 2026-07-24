import { describe, expect, it } from 'vitest';
import { callThemeExtraction } from '@/lib/gemini-client';
import type { BenchmarkJob, BenchmarkModel } from '@/types';

const enabled = process.env.RUN_LIVE_GEMINI_TESTS === '1';
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const schema = {
  type: 'object',
  properties: { color: { type: 'string' } },
  required: ['color'],
  additionalProperties: false,
};

function job(model: BenchmarkModel): BenchmarkJob {
  return {
    id: `exp-20260724-deadbeef__${model}__temp-1__thinking-low__trial-1`,
    experimentId: 'exp-20260724-deadbeef',
    model,
    temperature: 1,
    topP: 0.95,
    thinkingLevel: 'low',
    trial: 1,
    cellId: 'temp-1__thinking-low__trial-1',
    waveNumber: 1,
    status: 'queued',
    queuedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    workerNumber: null,
    queuePosition: 0,
  };
}

describe.skipIf(!enabled)('live Gemini Interactions smoke test', () => {
  for (const model of ['gemini-3.5-flash', 'gemini-3.1-pro-preview'] as const) {
    it(`${model} accepts image + locked structured output`, async () => {
      const result = await callThemeExtraction({
        job: job(model),
        systemInstruction: 'Analyze only visible pixels. Return the requested JSON object.',
        prompt: 'Identify the dominant visible color in this one-pixel image.',
        imageBase64: tinyPng,
        mimeType: 'image/png',
        responseJsonSchema: schema,
      });
      expect(result.ok, result.providerErrorMessage ?? undefined).toBe(true);
      expect(result.outputText).not.toBeNull();
      expect(() => JSON.parse(result.outputText!)).not.toThrow();
    }, 120_000);
  }
});

import { describe, expect, it } from 'vitest';
import { buildInteractionRequest } from '@/lib/gemini-client';

describe('Evidence Suite Containment', () => {
  it('should not pass any evidence to the extraction model', () => {
    // The InteractionRequestInput interface deliberately omits any evidence properties
    const input = {
      job: {
        id: 'job_1',
        experimentId: 'exp-123',
        model: 'gemini-3.5-flash',
        temperature: 0.2,
        thinkingLevel: 'low',
        topP: 0.95,
        trial: 1,
        cellId: 'cell_1',
        waveNumber: 1,
        status: 'queued',
        queuedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        workerNumber: null,
        queuePosition: 1,
      } as const,
      systemInstruction: 'sys',
      prompt: 'prompt',
      imageBase64: 'base64',
      mimeType: 'image/png' as const,
      responseJsonSchema: { type: 'object' },
    };

    const request = buildInteractionRequest(input);

    // Verify the request contains only the expected properties
    expect(request.model).toBe('gemini-3.5-flash');
    expect(request.system_instruction).toBe('sys');
    expect(request.input.length).toBe(2);

    // Deep check to ensure no pixelFacts or visualFacts leak into the structure
    const jsonStr = JSON.stringify(request);
    expect(jsonStr).not.toContain('pixelFacts');
    expect(jsonStr).not.toContain('visualFacts');
    expect(jsonStr).not.toContain('evidence');
  });
});

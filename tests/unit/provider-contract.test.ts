import { describe, expect, it } from 'vitest';
import { buildInteractionRequest } from '@/lib/gemini-client';
import { generateJobMatrix } from '@/lib/matrix';

it('builds the exact locked Interactions API request', () => {
  const job = generateJobMatrix('exp-20260724-deadbeef', 1, 42)[0]!;
  const schema = { type: 'object', properties: { theme: { type: 'string' } }, required: ['theme'] };
  const request = buildInteractionRequest({
    job, systemInstruction: 'SYSTEM', prompt: 'PROMPT', imageBase64: 'AAAA', mimeType: 'image/png', responseJsonSchema: schema,
  });

  expect(request.model).toBe(job.model);
  expect(request.store).toBe(false);
  expect(request.system_instruction).toBe('SYSTEM');
  expect(request.input).toEqual([
    { type: 'image', mime_type: 'image/png', data: 'AAAA' },
    { type: 'text', text: 'PROMPT' },
  ]);
  expect(request.generation_config).toEqual({
    temperature: job.temperature, top_p: 0.95, thinking_level: job.thinkingLevel, max_output_tokens: 65_536,
  });
  expect(request.response_format).toEqual({ type: 'text', mime_type: 'application/json', schema });
});

import { readFileSync } from 'node:fs';

const types = readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8');
const provider = readFileSync(new URL('../src/lib/gemini-client.ts', import.meta.url), 'utf8');
const matrix = readFileSync(new URL('../src/lib/matrix.ts', import.meta.url), 'utf8');

const checks = [
  ['models are locked', types.includes("['gemini-3.5-flash', 'gemini-3.1-pro-preview'] as const")],
  ['temperatures are locked', types.includes('[0.2, 0.4, 0.8, 1.0] as const')],
  ['thinking levels are locked', types.includes("['low', 'medium', 'high'] as const")],
  ['top-P is locked', types.includes('export const TOP_P = 0.95 as const')],
  ['concurrency is locked', types.includes('export const CONCURRENCY = 4 as const')],
  ['max output tokens are locked', types.includes('export const MAX_OUTPUT_TOKENS = 65_536 as const')],
  ['Interactions API is used', provider.includes('client.interactions.create')],
  ['structured output is top-level', provider.includes('response_format:') && provider.includes("mime_type: 'application/json'")],
  ['provider top-P comes from locked job value', provider.includes('top_p: input.job.topP')],
  ['provider thinking level comes from the matrix', provider.includes('thinking_level: input.job.thinkingLevel')],
  ['provider max output tokens are locked', provider.includes('max_output_tokens: MAX_OUTPUT_TOKENS')],
  ['one source image payload is reused', provider.includes('data: input.imageBase64')],
  ['paired four-call waves are generated', matrix.includes('Math.floor(cellIndex / 2) + 1')],
  ['no generateContent fallback exists', !provider.includes('generateContent')],
];

const failures = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
if (failures.length) {
  console.error(`\n${failures.length} contract check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} locked-contract checks passed.`);

import { describe, expect, it } from 'vitest';
import { validateOutput } from '@/lib/validate-output';

const SCHEMA = {
  type: 'object',
  properties: { theme: { type: 'string' } },
  required: ['theme'],
};

describe('validateOutput', () => {
  it('marks well-formed, schema-conforming JSON as valid on both axes', () => {
    const result = validateOutput('{"theme": "gothic"}', SCHEMA);
    expect(result.jsonParseValid).toBe(true);
    expect(result.schemaValid).toBe(true);
    expect(result.schemaIssues).toEqual([]);
  });

  it('marks malformed JSON as schema-invalid — never recovered before primary validation', () => {
    const result = validateOutput('{"theme": "gothic"', SCHEMA); // missing closing brace
    expect(result.jsonParseValid).toBe(false);
    expect(result.schemaValid).toBe(false);
    expect(result.parsedJson).toBeNull();
  });

  it('does not strip markdown fences before primary validation', () => {
    const fenced = '```json\n{"theme": "gothic"}\n```';
    const result = validateOutput(fenced, SCHEMA);
    expect(result.jsonParseValid).toBe(false);
    expect(result.schemaValid).toBe(false);
    // Diagnostic only — must not promote the output to schema-valid.
    expect(result.recoveryPossible).toBe(true);
  });

  it('marks valid JSON that fails the schema as jsonParseValid but schemaValid=false', () => {
    const result = validateOutput('{"other": 1}', SCHEMA);
    expect(result.jsonParseValid).toBe(true);
    expect(result.schemaValid).toBe(false);
    expect(result.schemaIssues.length).toBeGreaterThan(0);
  });
});

import Ajv, { type ErrorObject } from 'ajv';

export interface OutputValidationResult {
  jsonParseValid: boolean;
  parsedJson: unknown | null;
  schemaValid: boolean;
  schemaIssues: string[];
  /** A recovery diagnostic only — never used to mark output as natively schema-valid. */
  recoveryPossible: boolean;
}

/**
 * Validates raw model output text against the locked JSON Schema. Never strips markdown fences
 * or otherwise repairs the text before primary validation — that would misrepresent what the
 * model actually returned under structured-output mode.
 */
export function validateOutput(rawOutputText: string, jsonSchema: unknown): OutputValidationResult {
  let parsedJson: unknown | null = null;
  let jsonParseValid = false;

  try {
    parsedJson = JSON.parse(rawOutputText);
    jsonParseValid = true;
  } catch {
    jsonParseValid = false;
  }

  let schemaValid = false;
  let schemaIssues: string[] = [];

  if (jsonParseValid) {
    try {
      const ajv = new Ajv({ allErrors: true, strict: false });
      const validateFn = ajv.compile(jsonSchema as object);
      schemaValid = Boolean(validateFn(parsedJson));
      schemaIssues = (validateFn.errors ?? []).map(formatAjvError);
    } catch (err) {
      schemaValid = false;
      schemaIssues = [`schema compilation error: ${err instanceof Error ? err.message : String(err)}`];
    }
  } else {
    schemaIssues = ['raw output is not valid JSON'];
  }

  const recoveryPossible = !jsonParseValid && looksRecoverable(rawOutputText);

  return { jsonParseValid, parsedJson, schemaValid, schemaIssues, recoveryPossible };
}

function formatAjvError(e: ErrorObject): string {
  return `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`;
}

/** Diagnostic only: does stripping markdown fences / trimming whitespace look like it would parse? */
function looksRecoverable(text: string): boolean {
  const trimmed = text.trim();
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    JSON.parse(fenced);
    return true;
  } catch {
    return false;
  }
}

import { GoogleGenAI } from '@google/genai';
import type { EvidenceRecord, SupportedMime } from '@/types';
import { judgeResultSchema, JUDGE_RESPONSE_JSON_SCHEMA, type JudgeResult } from './judge-schema';
import { buildJudgeSystemInstruction, buildJudgePrompt } from './judge-prompt';

// ── Locked judge configuration ─────────────────────────────────────────────────
// These constants must never be overridden by caller input.

export const JUDGE_MODEL = 'gemini-3.1-pro-preview' as const;
export const JUDGE_TEMPERATURE = 0.2 as const;
export const JUDGE_TOP_P = 0.95 as const;
export const JUDGE_THINKING_LEVEL = 'high' as const;
export const JUDGE_MAX_OUTPUT_TOKENS = 16_384 as const;
export const JUDGE_STORE = false as const;

// ── Request input ─────────────────────────────────────────────────────────────

export interface JudgeRequestInput {
  /** Base64-encoded source image bytes. */
  imageBase64: string;
  mimeType: SupportedMime;
  /** Raw extraction text as returned by the model. */
  extractionResponseText: string;
  /** Parsed extraction JSON (may be null if parse failed — should not judge in that case). */
  parsedJson: unknown | null;
  /** Full FLASH-1 prompt contract text. */
  flashContract: string;
  /** Matched evidence record, or null for image-only mode. */
  evidence: EvidenceRecord | null;
}

// ── Call result ───────────────────────────────────────────────────────────────

export interface JudgeCallResult {
  ok: boolean;
  interactionId: string | null;
  rawOutputText: string | null;
  parsedOutput: JudgeResult | null;
  schemaValid: boolean;
  schemaIssues: string[];
  usage: unknown | null;
  providerStatus: number | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  retryAfterSeconds: number | null;
}

// ── Pure request builder (tested by provider-contract tests) ──────────────────

export function buildJudgeInteractionRequest(input: JudgeRequestInput) {
  const systemInstruction = buildJudgeSystemInstruction();
  const prompt = buildJudgePrompt({
    extractionResponseText: input.extractionResponseText,
    parsedJson: input.parsedJson,
    flashContract: input.flashContract,
    evidence: input.evidence,
  });

  return {
    model: JUDGE_MODEL,
    store: JUDGE_STORE,
    system_instruction: systemInstruction,
    input: [
      { type: 'image' as const, mime_type: input.mimeType, data: input.imageBase64 },
      { type: 'text' as const, text: prompt },
    ],
    generation_config: {
      temperature: JUDGE_TEMPERATURE,
      top_p: JUDGE_TOP_P,
      thinking_level: JUDGE_THINKING_LEVEL,
      max_output_tokens: JUDGE_MAX_OUTPUT_TOKENS,
    },
    response_format: {
      type: 'text' as const,
      mime_type: 'application/json',
      schema: JUDGE_RESPONSE_JSON_SCHEMA as Record<string, unknown>,
    },
  };
}

// ── Gemini client singleton ───────────────────────────────────────────────────

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not set.') as Error & { code: string };
    error.code = 'missing_api_key';
    throw error;
  }
  if (!cachedClient) cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

// ── Output text extraction ────────────────────────────────────────────────────

function extractOutputText(interaction: unknown): string | null {
  if (!interaction || typeof interaction !== 'object') return null;
  const object = interaction as {
    output_text?: unknown;
    steps?: Array<{ type?: unknown; content?: Array<{ type?: unknown; text?: unknown }> }>;
  };
  if (typeof object.output_text === 'string') return object.output_text;
  const steps = Array.isArray(object.steps) ? object.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
    const parts = step.content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text as string);
    if (parts.length > 0) return parts.join('');
  }
  return null;
}

function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : null;
}

function readUnknown(value: unknown, key: string): unknown | null {
  if (!value || typeof value !== 'object') return null;
  return (value as Record<string, unknown>)[key] ?? null;
}

// ── Provider error parsing ────────────────────────────────────────────────────

function redactApiKey(message: string): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return message;
  return message.split(apiKey).join('[REDACTED]');
}

interface ParsedProviderError {
  status: number | null;
  code: string | null;
  message: string;
  retryAfterSeconds: number | null;
}

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseRetryAfter(headers: unknown): number | null {
  if (!headers || typeof headers !== 'object') return null;
  const record = headers as Record<string, unknown>;
  const raw = record['retry-after'] ?? record['Retry-After'];
  return numberFrom(raw);
}

function inferNetworkCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause = error.cause;
  if (cause && typeof cause === 'object') {
    const code = (cause as Record<string, unknown>).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

function parseProviderError(error: unknown): ParsedProviderError {
  const object = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const nested = object.error && typeof object.error === 'object' ? (object.error as Record<string, unknown>) : {};
  const status = numberFrom(object.status) ?? numberFrom(object.statusCode) ?? numberFrom(nested.code);
  const code = stringFrom(object.code) ?? stringFrom(nested.status) ?? inferNetworkCode(error);
  const message = redactApiKey(
    stringFrom(object.message) ?? stringFrom(nested.message) ?? (error instanceof Error ? error.message : String(error))
  );
  const retryAfterSeconds =
    numberFrom(object.retryAfterSeconds) ?? parseRetryAfter(object.headers) ?? parseRetryAfter(nested.headers);
  return { status, code, message, retryAfterSeconds };
}

// ── Validate judge output ─────────────────────────────────────────────────────

function parseAndValidateJudgeOutput(rawOutputText: string): {
  parsedOutput: JudgeResult | null;
  schemaValid: boolean;
  schemaIssues: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutputText);
  } catch {
    return {
      parsedOutput: null,
      schemaValid: false,
      schemaIssues: ['judge output is not valid JSON'],
    };
  }

  const result = judgeResultSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.errors.map(
      (e) => `${e.path.join('.') || '(root)'}: ${e.message}`
    );
    return { parsedOutput: null, schemaValid: false, schemaIssues: issues };
  }

  return { parsedOutput: result.data, schemaValid: true, schemaIssues: [] };
}

// ── Public judge call ─────────────────────────────────────────────────────────

export async function callJudge(input: JudgeRequestInput): Promise<JudgeCallResult> {
  try {
    const client = getClient();
    const request = buildJudgeInteractionRequest(input);
    const interaction = await client.interactions.create(request);
    const rawOutputText = extractOutputText(interaction);

    if (rawOutputText == null) {
      return {
        ok: false,
        interactionId: readString(interaction, 'id'),
        rawOutputText: null,
        parsedOutput: null,
        schemaValid: false,
        schemaIssues: ['judge returned no text output'],
        usage: readUnknown(interaction, 'usage'),
        providerStatus: 200,
        providerErrorCode: 'empty_output',
        providerErrorMessage: 'Judge returned no text output for a structured text request.',
        retryAfterSeconds: null,
      };
    }

    const { parsedOutput, schemaValid, schemaIssues } = parseAndValidateJudgeOutput(rawOutputText);

    return {
      ok: schemaValid,
      interactionId: readString(interaction, 'id'),
      rawOutputText,
      parsedOutput,
      schemaValid,
      schemaIssues,
      usage: readUnknown(interaction, 'usage'),
      providerStatus: 200,
      providerErrorCode: schemaValid ? null : 'judge_schema_invalid',
      providerErrorMessage: schemaValid ? null : `Judge output failed schema validation: ${schemaIssues.join('; ')}`,
      retryAfterSeconds: null,
    };
  } catch (error: unknown) {
    const parsed = parseProviderError(error);
    return {
      ok: false,
      interactionId: null,
      rawOutputText: null,
      parsedOutput: null,
      schemaValid: false,
      schemaIssues: [],
      usage: null,
      providerStatus: parsed.status,
      providerErrorCode: parsed.code,
      providerErrorMessage: parsed.message,
      retryAfterSeconds: parsed.retryAfterSeconds,
    };
  }
}

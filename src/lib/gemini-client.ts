import { GoogleGenAI } from '@google/genai';
import { BenchmarkJob, MAX_OUTPUT_TOKENS, SupportedMime } from '@/types';

export interface InteractionRequestInput {
  job: BenchmarkJob;
  systemInstruction: string;
  prompt: string;
  imageBase64: string;
  mimeType: SupportedMime;
  responseJsonSchema: unknown;
}

export interface InteractionCallResult {
  ok: boolean;
  interactionId: string | null;
  outputText: string | null;
  usage: unknown | null;
  providerStatus: number | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  retryAfterSeconds: number | null;
}

let cachedClient: GoogleGenAI | null = null;

export function hasGeminiApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not set. Create .env.local from .env.example and set it.') as Error & {
      code: string;
    };
    error.code = 'missing_api_key';
    throw error;
  }
  if (!cachedClient) cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

/** Pure request builder used by tests to prove no locked field is dropped or normalized. */
export function buildInteractionRequest(input: InteractionRequestInput) {
  return {
    model: input.job.model,
    store: false as const,
    system_instruction: input.systemInstruction,
    input: [
      { type: 'image' as const, mime_type: input.mimeType, data: input.imageBase64 },
      { type: 'text' as const, text: input.prompt },
    ],
    generation_config: {
      temperature: input.job.temperature,
      top_p: input.job.topP,
      thinking_level: input.job.thinkingLevel,
      max_output_tokens: MAX_OUTPUT_TOKENS,
    },
    response_format: {
      type: 'text' as const,
      mime_type: 'application/json',
      schema: input.responseJsonSchema as Record<string, unknown>,
    },
  };
}

function extractOutputText(interaction: unknown): string | null {
  if (!interaction || typeof interaction !== 'object') return null;
  const object = interaction as {
    output_text?: unknown;
    steps?: Array<{ type?: unknown; content?: Array<{ type?: unknown; text?: unknown }> }>;
  };

  if (typeof object.output_text === 'string') return object.output_text;

  const steps = Array.isArray(object.steps) ? object.steps : [];
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
    const parts = step.content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text as string);
    if (parts.length > 0) return parts.join('');
  }
  return null;
}

export async function callThemeExtraction(input: InteractionRequestInput): Promise<InteractionCallResult> {
  try {
    const client = getClient();
    const interaction = await client.interactions.create(buildInteractionRequest(input));
    const outputText = extractOutputText(interaction);

    if (outputText == null) {
      return {
        ok: false,
        interactionId: readString(interaction, 'id'),
        outputText: null,
        usage: readUnknown(interaction, 'usage'),
        providerStatus: 200,
        providerErrorCode: 'empty_output',
        providerErrorMessage: 'Gemini returned no text output for a structured text request.',
        retryAfterSeconds: null,
      };
    }

    return {
      ok: true,
      interactionId: readString(interaction, 'id'),
      outputText,
      usage: readUnknown(interaction, 'usage'),
      providerStatus: 200,
      providerErrorCode: null,
      providerErrorMessage: null,
      retryAfterSeconds: null,
    };
  } catch (error: unknown) {
    const parsed = parseProviderError(error);
    return {
      ok: false,
      interactionId: null,
      outputText: null,
      usage: null,
      providerStatus: parsed.status,
      providerErrorCode: parsed.code,
      providerErrorMessage: parsed.message,
      retryAfterSeconds: parsed.retryAfterSeconds,
    };
  }
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

interface ParsedProviderError {
  status: number | null;
  code: string | null;
  message: string;
  retryAfterSeconds: number | null;
}

function redactApiKey(message: string): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return message;
  return message.split(apiKey).join('[REDACTED]');
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

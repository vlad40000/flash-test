import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import {
  CONCURRENCY,
  ExperimentManifest,
  MAX_IMAGE_BYTES,
  MAX_OUTPUT_TOKENS,
  MAX_TRIALS,
  MODELS,
  TEMPERATURES,
  THINKING_LEVELS,
  TOP_P,
} from '@/types';
import { detectMimeFromBytes } from './mime';
import { sha256Bytes, sha256Text } from './hash';
import { expectedJobCount, generateJobMatrix } from './matrix';
import { generateSeed } from './rng';
import {
  createExperimentDir,
  writeJobs,
  writeManifest,
  writeSourceImage,
  writeTextArtifact,
} from './storage';

export interface CreateExperimentInput {
  imageBytes: Uint8Array;
  originalFilename: string;
  prompt: string;
  systemInstruction: string;
  responseSchemaText: string;
  trials: number;
}

export interface CreateExperimentResult {
  experimentId: string;
  manifest: ExperimentManifest;
  totalCalls: number;
}

function todayId(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `exp-${y}${m}${d}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
}

const PINNED_GENAI_SDK_VERSION = '2.13.0';
const MAX_TEXT_BYTES = 512 * 1024;

function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function validateRequiredText(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (utf8Length(normalized) > MAX_TEXT_BYTES) throw new Error(`${label} exceeds 512 KiB`);
  return normalized;
}

export async function createExperiment(input: CreateExperimentInput): Promise<CreateExperimentResult> {
  if (!Number.isInteger(input.trials) || input.trials < 1 || input.trials > MAX_TRIALS) {
    throw new Error(`trials must be an integer between 1 and ${MAX_TRIALS}`);
  }
  if (input.imageBytes.length === 0) throw new Error('source image is empty');
  if (input.imageBytes.length > MAX_IMAGE_BYTES) throw new Error('source image exceeds the 20 MiB app limit');

  const prompt = validateRequiredText('prompt', input.prompt);
  const systemInstruction = validateRequiredText('system instruction', input.systemInstruction);
  const responseSchemaText = validateRequiredText('response schema', input.responseSchemaText);

  const detected = detectMimeFromBytes(input.imageBytes);
  if (!detected) {
    throw new Error('Unsupported or unreadable image. Only PNG, JPEG, and WebP (by byte signature) are accepted.');
  }

  let parsedSchema: unknown;
  try {
    parsedSchema = JSON.parse(responseSchemaText);
  } catch {
    throw new Error('response schema is not valid JSON');
  }

  try {
    new Ajv({ strict: false, allErrors: true }).compile(parsedSchema as object);
  } catch (error) {
    throw new Error(`response schema cannot be compiled: ${error instanceof Error ? error.message : String(error)}`);
  }

  const experimentId = todayId();
  const seed = generateSeed();
  const now = new Date().toISOString();
  const canonicalSchema = JSON.stringify(parsedSchema);

  const manifest: ExperimentManifest = {
    experimentId,
    createdAt: now,
    updatedAt: now,
    seed,
    sdkVersion: PINNED_GENAI_SDK_VERSION,
    image: {
      originalFilename: input.originalFilename || `source-image.${detected.extension}`,
      detectedMimeType: detected.mimeType,
      detectedExtension: detected.extension,
      byteLength: input.imageBytes.length,
      sha256: sha256Bytes(input.imageBytes),
    },
    prompt: { sha256: sha256Text(prompt), byteLength: utf8Length(prompt) },
    systemInstruction: { sha256: sha256Text(systemInstruction), byteLength: utf8Length(systemInstruction) },
    schema: { sha256: sha256Text(canonicalSchema), byteLength: utf8Length(canonicalSchema) },
    locked: {
      models: MODELS,
      temperatures: TEMPERATURES,
      thinkingLevels: THINKING_LEVELS,
      topP: TOP_P,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      concurrency: CONCURRENCY,
      structuredOutput: true,
      store: false,
      transport: 'interactions',
    },
    trials: input.trials,
    totalCalls: expectedJobCount(input.trials),
    status: 'created',
    lastError: null,
  };

  await createExperimentDir(experimentId);
  await writeSourceImage(experimentId, detected.extension, input.imageBytes);
  await writeTextArtifact(experimentId, 'prompt.txt', prompt);
  await writeTextArtifact(experimentId, 'system-instruction.txt', systemInstruction);
  await writeTextArtifact(experimentId, 'response-schema.json', JSON.stringify(parsedSchema, null, 2));
  await writeManifest(manifest);

  const jobs = generateJobMatrix(experimentId, input.trials, seed);
  await writeJobs(experimentId, jobs);

  return { experimentId, manifest, totalCalls: manifest.totalCalls };
}

import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { del, get, list, put } from '@vercel/blob';
import {
  AutomaticAssessment,
  AuditFlag,
  BenchmarkJob,
  EvidenceRecord,
  ExperimentListItem,
  ExperimentManifest,
  ExperimentSummary,
  JobAttempt,
  JudgeAttempt,
  JudgeJob,
  ManualScore,
} from '@/types';

const LOCAL_RUNS_ROOT = path.join(process.cwd(), 'data', 'runs');
const BLOB_RUNS_PREFIX = 'flash-theme-benchmark/runs';
const ID_PATTERN = /^exp-\d{8}-[a-f0-9]{8}$/;
const writeChains = new Map<string, Promise<void>>();

type StorageMode = 'filesystem' | 'blob';

export function storageMode(env: NodeJS.ProcessEnv = process.env): StorageMode {
  const configured = env.FLASH_BENCHMARK_STORAGE?.trim().toLowerCase();
  if (configured && configured !== 'filesystem' && configured !== 'blob') {
    throw new Error('FLASH_BENCHMARK_STORAGE must be "filesystem" or "blob"');
  }

  if (env.VERCEL === '1') {
    if (configured === 'filesystem') {
      throw new Error(
        'Filesystem persistence cannot be used on Vercel. Connect a private Vercel Blob store and use FLASH_BENCHMARK_STORAGE=blob.'
      );
    }
    return 'blob';
  }

  return configured === 'blob' ? 'blob' : 'filesystem';
}

function assertBlobConfigured(): void {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN) return;
  throw new Error(
    'Blob persistence is selected but no Vercel Blob credentials are available. Connect a private Blob store to this Vercel project so BLOB_READ_WRITE_TOKEN is injected.'
  );
}

export function assertExperimentId(experimentId: string): void {
  if (!ID_PATTERN.test(experimentId)) throw new Error('invalid experiment id');
}

function localExperimentDir(experimentId: string): string {
  assertExperimentId(experimentId);
  return path.join(LOCAL_RUNS_ROOT, experimentId);
}

function localResponsesDir(experimentId: string): string {
  return path.join(localExperimentDir(experimentId), 'responses');
}

function blobExperimentPrefix(experimentId: string): string {
  assertExperimentId(experimentId);
  return `${BLOB_RUNS_PREFIX}/${experimentId}`;
}

function blobArtifactPath(experimentId: string, filename: string): string {
  return `${blobExperimentPrefix(experimentId)}/${filename}`;
}

async function ensureLocalDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

function enqueueWrite(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  writeChains.set(key, next);
  return next.finally(() => {
    if (writeChains.get(key) === next) writeChains.delete(key);
  });
}

async function atomicLocalWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  await ensureLocalDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content);
  await rename(tempPath, filePath);
}

function contentTypeFor(filename: string): string {
  if (filename.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filename.endsWith('.jsonl')) return 'application/x-ndjson; charset=utf-8';
  if (filename.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  if (filename.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

async function writeArtifact(experimentId: string, filename: string, content: string | Uint8Array): Promise<void> {
  assertExperimentId(experimentId);
  if (storageMode() === 'filesystem') {
    await atomicLocalWrite(path.join(localExperimentDir(experimentId), filename), content);
    return;
  }

  assertBlobConfigured();
  const body = typeof content === 'string'
    ? content
    : content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  await put(blobArtifactPath(experimentId, filename), body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: contentTypeFor(filename),
  });
}

async function readBlobArtifact(experimentId: string, filename: string): Promise<Buffer> {
  assertBlobConfigured();
  const result = await get(blobArtifactPath(experimentId, filename), {
    access: 'private',
    useCache: false,
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    const error = new Error(`artifact not found: ${filename}`);
    (error as NodeJS.ErrnoException).code = 'ENOENT';
    throw error;
  }
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

async function readArtifact(experimentId: string, filename: string): Promise<Buffer> {
  assertExperimentId(experimentId);
  if (storageMode() === 'filesystem') {
    return readFile(path.join(localExperimentDir(experimentId), filename));
  }
  return readBlobArtifact(experimentId, filename);
}

async function artifactExists(experimentId: string, filename: string): Promise<boolean> {
  try {
    await readArtifact(experimentId, filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function writeJson(experimentId: string, filename: string, value: unknown): Promise<void> {
  await enqueueWrite(`${experimentId}:${filename}`, () =>
    writeArtifact(experimentId, filename, JSON.stringify(value, null, 2))
  );
}

async function readJson<T>(experimentId: string, filename: string): Promise<T> {
  const buffer = await readArtifact(experimentId, filename);
  const text = new TextDecoder('utf-8').decode(buffer);
  return JSON.parse(text) as T;
}

async function listAllBlobPathnames(prefix: string): Promise<string[]> {
  assertBlobConfigured();
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    pathnames.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return pathnames;
}

export async function createExperimentDir(experimentId: string): Promise<void> {
  assertExperimentId(experimentId);
  if (storageMode() === 'filesystem') {
    await ensureLocalDir(localExperimentDir(experimentId));
    await ensureLocalDir(localResponsesDir(experimentId));
    return;
  }
  assertBlobConfigured();
  // Blob storage is object-based. Directories are represented by pathname prefixes.
}

export async function writeManifest(manifest: ExperimentManifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  await writeJson(manifest.experimentId, 'manifest.json', manifest);
}

export async function readManifest(experimentId: string): Promise<ExperimentManifest> {
  return readJson<ExperimentManifest>(experimentId, 'manifest.json');
}

export async function writeSourceImage(
  experimentId: string,
  extension: 'png' | 'jpg' | 'webp',
  bytes: Uint8Array
): Promise<string> {
  const filename = `source-image.${extension}`;
  await writeArtifact(experimentId, filename, bytes);
  return filename;
}

export async function readSourceImage(experimentId: string, filename: string): Promise<Buffer> {
  if (!/^source-image\.(png|jpg|webp)$/.test(filename)) throw new Error('invalid source image filename');
  return readArtifact(experimentId, filename);
}

const ALLOWED_TEXT_ARTIFACTS = [
  'prompt.txt',
  'system-instruction.txt',
  'response-schema.json',
  'judge-system-instruction.txt',
  'judge-rubric-prompt.txt',
];

export async function writeTextArtifact(experimentId: string, filename: string, content: string): Promise<void> {
  if (!ALLOWED_TEXT_ARTIFACTS.includes(filename)) {
    throw new Error('unsupported artifact filename');
  }
  await writeArtifact(experimentId, filename, content);
}

export async function readTextArtifact(experimentId: string, filename: string): Promise<string> {
  if (!ALLOWED_TEXT_ARTIFACTS.includes(filename)) {
    throw new Error('unsupported artifact filename');
  }
  const buffer = await readArtifact(experimentId, filename);
  return new TextDecoder('utf-8').decode(buffer);
}

export async function writeJobs(experimentId: string, jobs: BenchmarkJob[]): Promise<void> {
  await writeJson(experimentId, 'jobs.json', jobs);
}

export async function readJobs(experimentId: string): Promise<BenchmarkJob[]> {
  return readJson<BenchmarkJob[]>(experimentId, 'jobs.json');
}

export async function appendAttempt(experimentId: string, attempt: JobAttempt): Promise<void> {
  const filename = 'attempts.jsonl';
  await enqueueWrite(`${experimentId}:${filename}`, async () => {
    if (storageMode() === 'filesystem') {
      const filePath = path.join(localExperimentDir(experimentId), filename);
      await ensureLocalDir(path.dirname(filePath));
      await appendFile(filePath, `${JSON.stringify(attempt)}\n`, 'utf8');
      return;
    }

    const existing = (await artifactExists(experimentId, filename))
      ? (await readArtifact(experimentId, filename)).toString('utf8')
      : '';
    await writeArtifact(experimentId, filename, `${existing}${JSON.stringify(attempt)}\n`);
  });
}

export async function readAttempts(experimentId: string): Promise<JobAttempt[]> {
  if (!(await artifactExists(experimentId, 'attempts.jsonl'))) return [];
  const raw = (await readArtifact(experimentId, 'attempts.jsonl')).toString('utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JobAttempt);
}

export async function writeRawResponse(experimentId: string, jobId: string, attempt: number, text: string): Promise<void> {
  if (!jobId.startsWith(`${experimentId}__`) || !Number.isInteger(attempt) || attempt < 1) {
    throw new Error('invalid response identity');
  }
  await writeArtifact(experimentId, `responses/${jobId}__attempt-${attempt}.txt`, text);
}

export async function readRawResponse(experimentId: string, jobId: string, attempt: number): Promise<string> {
  const buffer = await readArtifact(experimentId, `responses/${jobId}__attempt-${attempt}.txt`);
  return new TextDecoder('utf-8').decode(buffer);
}

export async function writeEvidence(experimentId: string, records: EvidenceRecord[]): Promise<void> {
  await writeJson(experimentId, 'evidence.json', records);
}

export async function readEvidence(experimentId: string): Promise<EvidenceRecord[]> {
  if (!(await artifactExists(experimentId, 'evidence.json'))) return [];
  return readJson<EvidenceRecord[]>(experimentId, 'evidence.json');
}

export async function writeScores(experimentId: string, scores: ManualScore[]): Promise<void> {
  await writeJson(experimentId, 'scores.json', scores);
}

export async function readScores(experimentId: string): Promise<ManualScore[]> {
  if (!(await artifactExists(experimentId, 'scores.json'))) return [];
  return readJson<ManualScore[]>(experimentId, 'scores.json');
}

export async function writeSummary(experimentId: string, summary: ExperimentSummary): Promise<void> {
  await writeJson(experimentId, 'summary.json', summary);
}

export async function readSummary(experimentId: string): Promise<ExperimentSummary | null> {
  if (!(await artifactExists(experimentId, 'summary.json'))) return null;
  return readJson<ExperimentSummary>(experimentId, 'summary.json');
}

export async function listExperimentIds(): Promise<string[]> {
  if (storageMode() === 'filesystem') {
    await ensureLocalDir(LOCAL_RUNS_ROOT);
    const entries = await readdir(LOCAL_RUNS_ROOT, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name)).map((entry) => entry.name);
  }

  const pathnames = await listAllBlobPathnames(`${BLOB_RUNS_PREFIX}/`);
  const ids = new Set<string>();
  for (const pathname of pathnames) {
    const match = pathname.match(/^flash-theme-benchmark\/runs\/(exp-\d{8}-[a-f0-9]{8})\/manifest\.json$/);
    if (match?.[1]) ids.add(match[1]);
  }
  return [...ids];
}

export async function listExperiments(): Promise<ExperimentListItem[]> {
  const ids = await listExperimentIds();
  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        const manifest = await readManifest(id);
        return {
          experimentId: id,
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt ?? manifest.createdAt,
          originalFilename: manifest.image.originalFilename,
          trials: manifest.trials,
          totalCalls: manifest.totalCalls,
          status: manifest.status,
        } satisfies ExperimentListItem;
      } catch {
        return null;
      }
    })
  );
  return items
    .filter((item): item is ExperimentListItem => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function experimentExists(experimentId: string): Promise<boolean> {
  assertExperimentId(experimentId);
  return artifactExists(experimentId, 'manifest.json');
}

export async function deleteExperiment(experimentId: string): Promise<void> {
  assertExperimentId(experimentId);
  if (storageMode() === 'filesystem') {
    await rm(localExperimentDir(experimentId), { recursive: true, force: true });
    return;
  }

  const pathnames = await listAllBlobPathnames(`${blobExperimentPrefix(experimentId)}/`);
  if (pathnames.length > 0) await del(pathnames);
}

// ── Judge jobs ────────────────────────────────────────────────────────────────

export async function writeJudgeJobs(experimentId: string, judgeJobs: JudgeJob[]): Promise<void> {
  await writeJson(experimentId, 'judge-jobs.json', judgeJobs);
}

export async function readJudgeJobs(experimentId: string): Promise<JudgeJob[]> {
  if (!(await artifactExists(experimentId, 'judge-jobs.json'))) return [];
  return readJson<JudgeJob[]>(experimentId, 'judge-jobs.json');
}

export async function updateJudgeJob(
  experimentId: string,
  judgeJobId: string,
  patch: Partial<Pick<JudgeJob, 'status' | 'startedAt' | 'completedAt'>>
): Promise<void> {
  await enqueueWrite(`${experimentId}:judge-jobs.json`, async () => {
    const jobs = await readJudgeJobs(experimentId);
    const index = jobs.findIndex((j) => j.id === judgeJobId);
    if (index === -1) throw new Error(`judge job not found: ${judgeJobId}`);
    jobs[index] = { ...jobs[index]!, ...patch };
    await writeArtifact(experimentId, 'judge-jobs.json', JSON.stringify(jobs, null, 2));
  });
}

// ── Judge attempts ────────────────────────────────────────────────────────────

export async function appendJudgeAttempt(experimentId: string, attempt: JudgeAttempt): Promise<void> {
  const filename = 'judge-attempts.jsonl';
  await enqueueWrite(`${experimentId}:${filename}`, async () => {
    if (storageMode() === 'filesystem') {
      const filePath = path.join(localExperimentDir(experimentId), filename);
      await ensureLocalDir(path.dirname(filePath));
      await appendFile(filePath, `${JSON.stringify(attempt)}\n`, 'utf8');
      return;
    }
    const existing = (await artifactExists(experimentId, filename))
      ? (await readArtifact(experimentId, filename)).toString('utf8')
      : '';
    await writeArtifact(experimentId, filename, `${existing}${JSON.stringify(attempt)}\n`);
  });
}

export async function readJudgeAttempts(experimentId: string): Promise<JudgeAttempt[]> {
  if (!(await artifactExists(experimentId, 'judge-attempts.jsonl'))) return [];
  const raw = new TextDecoder('utf-8').decode(await readArtifact(experimentId, 'judge-attempts.jsonl'));
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JudgeAttempt);
}

// ── Automatic assessments ─────────────────────────────────────────────────────

export async function writeAutomaticAssessment(
  experimentId: string,
  key: string,
  assessment: AutomaticAssessment
): Promise<void> {
  // key is expected to be `${extractionJobId}/${extractionAttemptNumber}/${judgeJobId}`
  await writeJson(experimentId, `assessments/${key}.json`, assessment);
}

export async function readAutomaticAssessments(
  experimentId: string
): Promise<Record<string, AutomaticAssessment>> {
  let pathnames: string[] = [];

  if (storageMode() === 'filesystem') {
    const dir = path.join(localExperimentDir(experimentId), 'assessments');
    try {
      const files = await readdir(dir, { recursive: true });
      pathnames = files
        .filter(f => f.endsWith('.json'))
        // Windows backslash to forward slash normalization
        .map(f => `assessments/${f.replace(/\\/g, '/')}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  } else {
    const prefix = `${blobExperimentPrefix(experimentId)}/assessments/${experimentId}/`;
    const fullPathnames = await listAllBlobPathnames(prefix);
    const experimentPrefix = `${blobExperimentPrefix(experimentId)}/`;
    pathnames = fullPathnames.map(p => p.startsWith(experimentPrefix) ? p.slice(experimentPrefix.length) : p);
  }

  const allAssessments: Array<{ extractionJobId: string; attemptNumber: number; judgeJobId: string; key: string; assessment: AutomaticAssessment }> = [];

  const loads = pathnames.map(async (filename) => {
    try {
      const assessment = await readJson<AutomaticAssessment>(experimentId, filename);
      const relative = filename.replace('assessments/', '').replace('.json', '');
      const parts = relative.split(/[\\/]/);
      if (parts.length >= 4) {
        const extractionJobId = parts[1]!;
        const attemptNumber = parseInt(parts[2]!, 10);
        const judgeJobId = parts[3]!;
        const legacyKey = `${extractionJobId}__${attemptNumber}`;
        allAssessments.push({ extractionJobId, attemptNumber, judgeJobId, key: legacyKey, assessment });
      }
    } catch (e) {
      console.error(`Failed to read assessment ${filename}`, e);
    }
  });

  await Promise.all(loads);

  // Group by extractionJobId to filter out stale attempts
  const byJob = new Map<string, typeof allAssessments>();
  for (const item of allAssessments) {
    if (!byJob.has(item.extractionJobId)) byJob.set(item.extractionJobId, []);
    byJob.get(item.extractionJobId)!.push(item);
  }

  const result: Record<string, AutomaticAssessment> = {};
  for (const [jobId, items] of byJob.entries()) {
    // Find highest extraction attempt number for this job
    let maxAttempt = 0;
    for (const item of items) {
      if (item.attemptNumber > maxAttempt) maxAttempt = item.attemptNumber;
    }
    // Keep only the highest attempt
    const highestAttemptItems = items.filter(item => item.attemptNumber === maxAttempt);
    // Sort deterministically by judgeJobId (first alphabetically wins)
    highestAttemptItems.sort((a, b) => a.judgeJobId.localeCompare(b.judgeJobId));

    if (highestAttemptItems.length > 0) {
      const winner = highestAttemptItems[0]!;
      result[winner.key] = winner.assessment;
    }
  }

  return result;
}

// ── Audit flags ───────────────────────────────────────────────────────────────

export async function writeAuditFlag(experimentId: string, flag: AuditFlag): Promise<void> {
  const filename = 'audit-flags.jsonl';
  await enqueueWrite(`${experimentId}:${filename}`, async () => {
    if (storageMode() === 'filesystem') {
      const filePath = path.join(localExperimentDir(experimentId), filename);
      await ensureLocalDir(path.dirname(filePath));
      await appendFile(filePath, `${JSON.stringify(flag)}\n`, 'utf8');
      return;
    }
    const existing = (await artifactExists(experimentId, filename))
      ? (await readArtifact(experimentId, filename)).toString('utf8')
      : '';
    await writeArtifact(experimentId, filename, `${existing}${JSON.stringify(flag)}\n`);
  });
}

export async function readAuditFlags(experimentId: string): Promise<AuditFlag[]> {
  if (!(await artifactExists(experimentId, 'audit-flags.jsonl'))) return [];
  const raw = new TextDecoder('utf-8').decode(await readArtifact(experimentId, 'audit-flags.jsonl'));
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditFlag);
}

import { NextRequest, NextResponse } from 'next/server';
import { ManualScore, SCORING_CATEGORIES } from '@/types';
import { buildSummary } from '@/lib/summary';
import { matchEvidence } from '@/lib/evidence';
import { readAttempts, readEvidence, readJobs, readManifest, readScores, writeScores, writeSummary } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ scores: await readScores(id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as Partial<ManualScore>;
    if (typeof body.jobId !== 'string' || !body.jobId.startsWith(`${id}__`)) throw new Error('invalid jobId');
    if (!Number.isInteger(body.attempt) || Number(body.attempt) < 1) throw new Error('invalid attempt');
    if (!body.scores || typeof body.scores !== 'object') throw new Error('scores are required');

    const normalized: ManualScore['scores'] = {};
    for (const category of SCORING_CATEGORIES) {
      const value = body.scores[category.key];
      if (value == null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > category.max) {
        throw new Error(`${category.label} must be between 0 and ${category.max}`);
      }
      normalized[category.key] = value;
    }

    const record: ManualScore = {
      jobId: body.jobId,
      attempt: Number(body.attempt),
      scores: normalized,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 20_000) : '',
      updatedAt: new Date().toISOString(),
    };

    const scores = await readScores(id);
    const index = scores.findIndex((score) => score.jobId === record.jobId && score.attempt === record.attempt);
    if (index >= 0) scores[index] = record;
    else scores.push(record);
    await writeScores(id, scores);

    const [jobs, attempts, evidenceAll, manifest] = await Promise.all([
      readJobs(id),
      readAttempts(id),
      readEvidence(id),
      readManifest(id),
    ]);
    const evidence = matchEvidence(evidenceAll, manifest.image.originalFilename, manifest.evidenceReviews ?? {});
    await writeSummary(id, buildSummary(jobs, attempts, scores, evidence[0] ?? null));
    return NextResponse.json({ ok: true, score: record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed to save score' }, { status: 400 });
  }
}

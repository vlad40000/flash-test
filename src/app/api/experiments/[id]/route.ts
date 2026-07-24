import { NextRequest, NextResponse } from 'next/server';
import { getRunState } from '@/lib/queue';
import { matchEvidence } from '@/lib/evidence';
import { buildSummary } from '@/lib/summary';
import { readAttempts, readEvidence, readJobs, readManifest, readScores, writeSummary } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [manifest, jobs, evidenceAll, scores, attempts] = await Promise.all([
      readManifest(id),
      readJobs(id),
      readEvidence(id),
      readScores(id),
      readAttempts(id),
    ]);
    const evidence = matchEvidence(evidenceAll, manifest.image.originalFilename, manifest.evidenceReviews ?? {});
    const summary = buildSummary(jobs, attempts, scores, evidence[0] ?? null);
    await writeSummary(id, summary);
    return NextResponse.json({ manifest, jobs, attempts, evidence, scores, summary, runtime: getRunState(id) });
  } catch (error) {
    const message = error instanceof Error && error.message === 'invalid experiment id' ? 'invalid experiment id' : 'experiment not found';
    return NextResponse.json({ error: message }, { status: message === 'invalid experiment id' ? 400 : 404 });
  }
}

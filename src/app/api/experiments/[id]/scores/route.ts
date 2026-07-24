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

export async function POST(_req: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  return NextResponse.json(
    { error: 'Manual scoring has been replaced by automatic scoring. This endpoint is retained for legacy data only.' },
    { status: 405 }
  );
}

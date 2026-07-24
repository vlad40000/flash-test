import { NextRequest, NextResponse } from 'next/server';
import { EvidenceReviewDecision } from '@/types';
import { readManifest, writeManifest } from '@/lib/storage';

export const runtime = 'nodejs';
const DECISIONS = new Set<EvidenceReviewDecision>(['approved', 'needs_revision', 'rejected']);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as { filename?: unknown; decision?: unknown };
    if (typeof body.filename !== 'string' || body.filename.length === 0) throw new Error('filename is required');
    if (typeof body.decision !== 'string' || !DECISIONS.has(body.decision as EvidenceReviewDecision)) {
      throw new Error('invalid evidence review decision');
    }

    const manifest = await readManifest(id);
    manifest.evidenceReviews = manifest.evidenceReviews ?? {};
    manifest.evidenceReviews[body.filename] = body.decision as EvidenceReviewDecision;
    await writeManifest(manifest);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed to save review' }, { status: 400 });
  }
}

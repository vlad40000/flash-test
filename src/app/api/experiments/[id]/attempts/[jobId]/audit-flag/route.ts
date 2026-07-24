import { NextRequest, NextResponse } from 'next/server';
import { writeAuditFlag } from '@/lib/storage';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await params;
  try {
    const body = (await req.json()) as { attemptNumber?: number; notes?: string };
    
    if (!Number.isInteger(body.attemptNumber) || Number(body.attemptNumber) < 1) {
      throw new Error('invalid attemptNumber');
    }
    if (typeof body.notes !== 'string' || body.notes.trim().length === 0) {
      throw new Error('notes are required');
    }

    const flag = {
      jobId,
      attemptNumber: Number(body.attemptNumber),
      flaggedAt: new Date().toISOString(),
      notes: body.notes.slice(0, 10_000),
    };

    await writeAuditFlag(id, flag);

    return NextResponse.json({ ok: true, flag });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to record audit flag' },
      { status: 400 }
    );
  }
}

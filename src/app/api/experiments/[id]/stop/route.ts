import { NextRequest, NextResponse } from 'next/server';
import { stopRun } from '@/lib/queue';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await stopRun(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed to stop run' }, { status: 400 });
  }
}

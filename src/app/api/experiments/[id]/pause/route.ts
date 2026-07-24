import { after, NextRequest, NextResponse } from 'next/server';
import { pauseRun, resumeRun, startRun } from '@/lib/queue';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: 'pause' | 'resume' };
  try {
    if (body.action === 'resume') {
      const result = await resumeRun(id);
      if (result === 'started') {
        after(async () => {
          try {
            await startRun(id);
          } catch (error) {
            console.error(`[flash-theme-benchmark] resumed run ${id} failed:`, error instanceof Error ? error.message : String(error));
          }
        });
      }
      return NextResponse.json({ ok: true, action: result });
    }
    const paused = await pauseRun(id);
    if (!paused) return NextResponse.json({ error: 'run is not active' }, { status: 409 });
    return NextResponse.json({ ok: true, action: 'paused' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed to update run' }, { status: 400 });
  }
}

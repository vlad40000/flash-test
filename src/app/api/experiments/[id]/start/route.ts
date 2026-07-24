import { after, NextRequest, NextResponse } from 'next/server';
import { hasGeminiApiKey } from '@/lib/gemini-client';
import { startRun } from '@/lib/queue';
import { experimentExists } from '@/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await experimentExists(id))) {
      return NextResponse.json({ error: 'experiment not found' }, { status: 404 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'storage is unavailable' },
      { status: 503 }
    );
  }
  if (!hasGeminiApiKey()) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not set on the server.' }, { status: 400 });
  }

  after(async () => {
    try {
      await startRun(id);
    } catch (error) {
      console.error(`[flash-theme-benchmark] run ${id} failed:`, error instanceof Error ? error.message : String(error));
    }
  });
  return NextResponse.json({ started: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { readJudgeJobs, readJudgeAttempts } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [jobs, attempts] = await Promise.all([
      readJudgeJobs(id),
      readJudgeAttempts(id),
    ]);
    return NextResponse.json({ jobs, attempts });
  } catch {
    return NextResponse.json({ error: 'experiment not found' }, { status: 404 });
  }
}

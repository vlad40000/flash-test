import { after, NextRequest, NextResponse } from 'next/server';
import { hasGeminiApiKey } from '@/lib/gemini-client';
import { startRun } from '@/lib/queue';
import { isRetryable } from '@/lib/retry';
import { finalAttemptMap } from '@/lib/summary';
import { readAttempts, readJobs, writeJobs } from '@/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasGeminiApiKey()) return NextResponse.json({ error: 'GEMINI_API_KEY is not set on the server.' }, { status: 400 });

  try {
    const body = (await req.json().catch(() => ({}))) as { jobIds?: string[] };
    const requested = new Set(body.jobIds ?? []);
    const [jobs, attempts] = await Promise.all([readJobs(id), readAttempts(id)]);
    const finals = finalAttemptMap(attempts);
    let requeued = 0;

    for (const job of jobs) {
      if (!requested.has(job.id) || job.status !== 'failed') continue;
      const attempt = finals.get(job.id);
      if (!attempt) continue;
      if (!isRetryable({ providerStatus: attempt.providerStatus, providerErrorCode: attempt.providerErrorCode })) continue;
      job.status = 'queued';
      job.queuedAt = new Date().toISOString();
      job.startedAt = null;
      job.completedAt = null;
      job.workerNumber = null;
      requeued++;
    }

    await writeJobs(id, jobs);
    if (requeued > 0) {
      after(async () => {
        try {
          await startRun(id);
        } catch (error) {
          console.error(`[flash-theme-benchmark] retry run ${id} failed:`, error instanceof Error ? error.message : String(error));
        }
      });
    }
    return NextResponse.json({ requeued });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed to retry jobs' }, { status: 400 });
  }
}

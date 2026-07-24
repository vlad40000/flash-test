import { after, NextRequest, NextResponse } from 'next/server';
import { readJudgeJobs, updateJudgeJob } from '@/lib/storage';
import { syncPhase } from '@/lib/queue';

export const maxDuration = 300;

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as { jobIds?: string[] };
    if (!Array.isArray(body.jobIds) || body.jobIds.length === 0) {
      throw new Error('jobIds array is required');
    }

    const jobs = await readJudgeJobs(id);
    const retryable = new Set(body.jobIds);
    let requeued = 0;

    for (const job of jobs) {
      if (retryable.has(job.id) && job.status === 'failed') {
        await updateJudgeJob(id, job.id, {
          status: 'queued',
          startedAt: null,
          completedAt: null,
        });
        requeued++;
      }
    }

    if (requeued > 0) {
      after(async () => {
        try {
          await syncPhase(id);
        } catch (error) {
          console.error(`[flash-theme-benchmark] judge run ${id} failed:`, error instanceof Error ? error.message : String(error));
        }
      });
    }

    return NextResponse.json({ ok: true, requeued });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to retry judge jobs' },
      { status: 400 }
    );
  }
}

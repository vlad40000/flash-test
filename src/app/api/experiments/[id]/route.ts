import { NextRequest, NextResponse } from 'next/server';
import { getRunState } from '@/lib/queue';
import { matchEvidence } from '@/lib/evidence';
import { buildSummary } from '@/lib/summary';
import {
  readAttempts,
  readAutomaticAssessments,
  readEvidence,
  readJobs,
  readJudgeAttempts,
  readJudgeJobs,
  readManifest,
  readScores,
  writeSummary,
} from '@/lib/storage';
import type { AttemptDetail, ScoreStatus } from '@/types';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [manifest, jobs, evidenceAll, scores, attempts, judgeJobs, judgeAttempts, assessments] =
      await Promise.all([
        readManifest(id),
        readJobs(id),
        readEvidence(id),
        readScores(id),
        readAttempts(id),
        readJudgeJobs(id),
        readJudgeAttempts(id),
        readAutomaticAssessments(id),
      ]);

    const evidence = matchEvidence(evidenceAll, manifest.image.originalFilename, manifest.evidenceReviews ?? {});
    const summary = buildSummary(jobs, attempts, scores, evidence[0] ?? null, assessments);
    await writeSummary(id, summary);

    // Build composite attempt detail array
    const judgeAttemptsByJobId = new Map<string, typeof judgeAttempts[number][]>();
    for (const ja of judgeAttempts) {
      const list = judgeAttemptsByJobId.get(ja.judgeJobId) ?? [];
      list.push(ja);
      judgeAttemptsByJobId.set(ja.judgeJobId, list);
    }

    const attemptDetails: AttemptDetail[] = attempts.map((attempt) => {
      const judgeJob = judgeJobs.find(
        (jj) => jj.extractionJobId === attempt.jobId && jj.extractionAttemptNumber === attempt.attempt
      );
      const assessment = assessments[attempt.jobId] ?? null;

      let judgeStatus: ScoreStatus = 'not_started';
      if (!attempt.jsonParseValid) judgeStatus = 'json_invalid';
      else if (!attempt.schemaValid) judgeStatus = 'schema_invalid';
      else if (judgeJob) {
        if (judgeJob.status === 'queued') judgeStatus = 'queued';
        else if (judgeJob.status === 'running') judgeStatus = 'judging';
        else if (judgeJob.status === 'succeeded') judgeStatus = 'scored';
        else if (judgeJob.status === 'failed') judgeStatus = 'judge_failed';
        else if (judgeJob.status === 'stopped') judgeStatus = 'stopped';
      } else if (assessment?.scoreStatus) {
        judgeStatus = assessment.scoreStatus;
      }

      return {
        jobId: attempt.jobId,
        attemptNumber: attempt.attempt,
        extraction: attempt,
        automaticAssessment: assessment,
        judge: {
          status: judgeStatus,
          judgeJobId: judgeJob?.id ?? null,
          attempts: judgeJob ? (judgeAttemptsByJobId.get(judgeJob.id) ?? []) : [],
        },
      };
    });

    return NextResponse.json({
      manifest,
      jobs,
      attempts,
      attemptDetails,
      evidence,
      scores,         // kept for legacy reads
      assessments,
      judgeJobs,
      summary,
      runtime: getRunState(id),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'invalid experiment id'
        ? 'invalid experiment id'
        : 'experiment not found';
    return NextResponse.json({ error: message }, { status: message === 'invalid experiment id' ? 400 : 404 });
  }
}

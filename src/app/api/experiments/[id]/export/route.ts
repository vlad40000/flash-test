import { NextRequest, NextResponse } from 'next/server';
import { matchEvidence } from '@/lib/evidence';
import { toCsv, toJson, toJsonl } from '@/lib/export';
import { buildSummary } from '@/lib/summary';
import {
  readAttempts,
  readAutomaticAssessments,
  readEvidence,
  readJobs,
  readJudgeJobs,
  readManifest,
  readScores,
  readTextArtifact,
} from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = req.nextUrl.searchParams.get('format') ?? 'json';
  try {
    const [manifest, jobs, attempts, scores, evidenceAll, prompt, systemInstruction, schemaText, judgeJobs, assessments] = await Promise.all([
      readManifest(id),
      readJobs(id),
      readAttempts(id),
      readScores(id),
      readEvidence(id),
      readTextArtifact(id, 'prompt.txt'),
      readTextArtifact(id, 'system-instruction.txt'),
      readTextArtifact(id, 'response-schema.json'),
      readJudgeJobs(id),
      readAutomaticAssessments(id),
    ]);
    const evidence = matchEvidence(evidenceAll, manifest.image.originalFilename, manifest.evidenceReviews ?? {});
    const bundle = {
      manifest,
      jobs,
      attempts,
      scores,
      evidence,
      judgeJobs,
      assessments,
      summary: buildSummary(jobs, attempts, scores, evidence[0] ?? null, assessments),
      artifacts: { prompt, systemInstruction, responseSchema: JSON.parse(schemaText) },
    };

    if (format === 'jsonl') {
      return new NextResponse(toJsonl(bundle), {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Content-Disposition': `attachment; filename="${id}.jsonl"`,
        },
      });
    }
    if (format === 'csv') {
      return new NextResponse(toCsv(bundle), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${id}.csv"`,
        },
      });
    }
    return new NextResponse(toJson(bundle), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${id}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'experiment not found' }, { status: 404 });
  }
}

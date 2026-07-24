import { NextRequest, NextResponse } from 'next/server';
import { createExperiment } from '@/lib/experiment';
import { parseEvidenceSuite } from '@/lib/evidence';
import { listExperiments, writeEvidence } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ experiments: await listExperiments() });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const imageFile = form.get('image');
    const prompt = form.get('prompt');
    const systemInstruction = form.get('systemInstruction');
    const responseSchemaText = form.get('responseSchema');
    const trialsRaw = form.get('trials');
    const evidenceFile = form.get('evidence');

    if (!(imageFile instanceof File)) return NextResponse.json({ error: 'image file is required' }, { status: 400 });
    if (typeof prompt !== 'string') return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    if (typeof systemInstruction !== 'string') {
      return NextResponse.json({ error: 'systemInstruction is required' }, { status: 400 });
    }
    if (typeof responseSchemaText !== 'string') {
      return NextResponse.json({ error: 'responseSchema is required' }, { status: 400 });
    }

    let parsedEvidence: ReturnType<typeof parseEvidenceSuite> | null = null;
    if (evidenceFile instanceof File && evidenceFile.size > 0) {
      try {
        parsedEvidence = parseEvidenceSuite(JSON.parse(await evidenceFile.text()));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'evidence file is invalid JSON';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const result = await createExperiment({
      imageBytes: new Uint8Array(await imageFile.arrayBuffer()),
      originalFilename: imageFile.name,
      prompt,
      systemInstruction,
      responseSchemaText,
      trials: Number(trialsRaw ?? 1),
    });

    if (parsedEvidence) {
      await writeEvidence(result.experimentId, parsedEvidence);
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create experiment';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

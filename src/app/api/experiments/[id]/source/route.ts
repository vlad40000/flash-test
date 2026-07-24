import { NextRequest, NextResponse } from 'next/server';
import { readManifest, readSourceImage } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const manifest = await readManifest(id);
    const bytes = await readSourceImage(id, `source-image.${manifest.image.detectedExtension}`);
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': manifest.image.detectedMimeType,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="${encodeURIComponent(manifest.image.originalFilename)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'source image not found' }, { status: 404 });
  }
}

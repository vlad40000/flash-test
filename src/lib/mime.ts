import { SupportedMime } from '@/types';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function matchesSignature(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function isWebp(bytes: Uint8Array): boolean {
  // RIFF....WEBP
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const webp = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return riff === 'RIFF' && webp === 'WEBP';
}

export interface MimeDetectionResult {
  mimeType: SupportedMime;
  extension: 'png' | 'jpg' | 'webp';
}

/**
 * Detects image MIME type from magic bytes only. Never trusts the filename extension —
 * required because the evidence suite includes a PNG-named file whose bytes are JPEG, and a
 * genuine .webp image.
 */
export function detectMimeFromBytes(bytes: Uint8Array): MimeDetectionResult | null {
  if (matchesSignature(bytes, PNG_SIGNATURE)) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (matchesSignature(bytes, JPEG_SIGNATURE)) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (isWebp(bytes)) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

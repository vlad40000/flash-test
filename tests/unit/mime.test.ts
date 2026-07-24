import { describe, expect, it } from 'vitest';
import { detectMimeFromBytes } from '@/lib/mime';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0, 0, 0, 0, // size (unused by detector)
  0x57, 0x45, 0x42, 0x50, // WEBP
]);
const GARBAGE_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe('detectMimeFromBytes', () => {
  it('detects PNG from its signature', () => {
    expect(detectMimeFromBytes(PNG_BYTES)).toEqual({ mimeType: 'image/png', extension: 'png' });
  });

  it('detects JPEG from its signature', () => {
    expect(detectMimeFromBytes(JPEG_BYTES)).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
  });

  it('detects WEBP from its RIFF/WEBP signature', () => {
    expect(detectMimeFromBytes(WEBP_BYTES)).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('returns null for unrecognized bytes', () => {
    expect(detectMimeFromBytes(GARBAGE_BYTES)).toBeNull();
  });

  it('resolves JPEG bytes to JPEG even when the caller never supplies a filename at all', () => {
    // The detector's signature is bytes-only — there is no filename parameter to fool it,
    // which is the point: a file named "photo.png" whose bytes are JPEG must resolve to JPEG.
    const result = detectMimeFromBytes(JPEG_BYTES);
    expect(result?.mimeType).toBe('image/jpeg');
    expect(result?.extension).toBe('jpg');
  });

  it('does not misclassify a PNG as JPEG or vice versa', () => {
    expect(detectMimeFromBytes(PNG_BYTES)?.mimeType).not.toBe('image/jpeg');
    expect(detectMimeFromBytes(JPEG_BYTES)?.mimeType).not.toBe('image/png');
  });
});

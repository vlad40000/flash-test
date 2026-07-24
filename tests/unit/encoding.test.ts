import { describe, expect, it } from 'vitest';
import { matchEvidence } from '@/lib/evidence';
import { readJudgeAttempts } from '@/lib/storage';

describe('Encoding Verification', () => {
  it('should preserve multi-byte characters when decoding JSON', () => {
    // Simulated JSON string with emojis and accents
    const jsonStr = JSON.stringify({ message: "Hello 🌍! Éléphant 🐘" });
    const buffer = Buffer.from(jsonStr, 'utf-8');

    // Decoding with TextDecoder
    const text = new TextDecoder('utf-8').decode(buffer);
    const parsed = JSON.parse(text);

    expect(parsed.message).toBe("Hello 🌍! Éléphant 🐘");
  });

  it('should not corrupt base64 image data when handling buffers', () => {
    // Generate some random binary data representing an image
    const rawBinary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff]);

    // Simulate reading it as a base64 string directly from the buffer
    const base64Str = rawBinary.toString('base64');

    // If someone accidentally passed it through TextDecoder ('utf-8') it would corrupt
    const corruptedText = new TextDecoder('utf-8').decode(rawBinary);
    const corruptedBase64 = Buffer.from(corruptedText, 'utf-8').toString('base64');

    // Verify that the direct base64 encoding does not equal the corrupted one
    expect(base64Str).not.toBe(corruptedBase64);

    // Verify our expected Base64 string is correctly padded/unpadded
    expect(base64Str).toBe('iVBORw0KGgr//w==');
  });

  it('should handle invalid UTF-8 byte sequences gracefully without crashing', () => {
    // Invalid UTF-8 sequence
    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xfd]);

    // TextDecoder will replace invalid bytes with the replacement character U+FFFD ()
    const decoded = new TextDecoder('utf-8').decode(invalidUtf8);

    expect(decoded).toContain('');
  });
});

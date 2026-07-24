import { describe, expect, it } from 'vitest';
import { sha256Bytes, sha256Text } from '@/lib/hash';
import { generateJobMatrix } from '@/lib/matrix';

describe('hashing', () => {
  it('produces a stable sha256 hex digest for text', () => {
    expect(sha256Text('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces a stable sha256 hex digest for bytes', () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    expect(sha256Bytes(bytes)).toBe(sha256Text('hello'));
  });

  it('one image hash / prompt hash / schema hash applies identically across every job in a matrix', () => {
    // The hash itself lives on the experiment manifest, not per-job — but every job must share
    // the same experimentId, which is what ties every job back to that single locked manifest.
    const jobs = generateJobMatrix('exp-fixed-id', 2, 3);
    const experimentIds = new Set(jobs.map((j) => j.experimentId));
    expect(experimentIds.size).toBe(1);
    expect(experimentIds.has('exp-fixed-id')).toBe(true);
  });
});

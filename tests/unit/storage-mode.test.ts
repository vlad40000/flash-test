import { describe, expect, it } from 'vitest';
import { storageMode } from '@/lib/storage';

describe('storageMode', () => {
  it('uses filesystem persistence by default outside Vercel', () => {
    expect(storageMode({} as unknown as NodeJS.ProcessEnv)).toBe('filesystem');
  });

  it('uses Blob persistence automatically on Vercel', () => {
    expect(storageMode({ VERCEL: '1' } as unknown as NodeJS.ProcessEnv)).toBe('blob');
  });

  it('allows Blob persistence during local development', () => {
    expect(storageMode({ FLASH_BENCHMARK_STORAGE: 'blob' } as unknown as NodeJS.ProcessEnv)).toBe('blob');
  });

  it('rejects filesystem persistence on Vercel', () => {
    expect(() => storageMode({ VERCEL: '1', FLASH_BENCHMARK_STORAGE: 'filesystem' } as unknown as NodeJS.ProcessEnv)).toThrow(
      /Filesystem persistence cannot be used on Vercel/
    );
  });

  it('rejects unknown storage modes', () => {
    expect(() => storageMode({ FLASH_BENCHMARK_STORAGE: 'memory' } as unknown as NodeJS.ProcessEnv)).toThrow(
      /FLASH_BENCHMARK_STORAGE must be/
    );
  });
});

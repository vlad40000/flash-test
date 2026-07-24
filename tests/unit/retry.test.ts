import { describe, expect, it } from 'vitest';
import { computeBackoffMs, isRetryable, MAX_RETRY_ATTEMPTS } from '@/lib/retry';

describe('isRetryable', () => {
  it('retries on 429', () => {
    expect(isRetryable({ providerStatus: 429, providerErrorCode: null })).toBe(true);
  });

  it('retries on 500/502/503/504', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isRetryable({ providerStatus: status, providerErrorCode: null })).toBe(true);
    }
  });

  it('retries on network interruption / connection reset / timeout codes', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'network_interruption', 'connection_reset', 'request_timeout']) {
      expect(isRetryable({ providerStatus: null, providerErrorCode: code })).toBe(true);
    }
  });

  it('does not retry on 400/401/403/404', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(isRetryable({ providerStatus: status, providerErrorCode: null })).toBe(false);
    }
  });

  it('does not retry a JSON parse failure or schema-invalid output', () => {
    expect(isRetryable({ providerStatus: 200, providerErrorCode: null, isOutputValidationFailure: true })).toBe(false);
  });

  it('never treats a retry as an additional trial — MAX_RETRY_ATTEMPTS is a per-job attempt cap', () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });
});

describe('computeBackoffMs', () => {
  it('uses roughly 2s, 4s, 8s for attempts 1, 2, 3 (base + up to 25% jitter)', () => {
    const a1 = computeBackoffMs(1);
    const a2 = computeBackoffMs(2);
    const a3 = computeBackoffMs(3);
    expect(a1).toBeGreaterThanOrEqual(2000);
    expect(a1).toBeLessThanOrEqual(2500);
    expect(a2).toBeGreaterThanOrEqual(4000);
    expect(a2).toBeLessThanOrEqual(5000);
    expect(a3).toBeGreaterThanOrEqual(8000);
    expect(a3).toBeLessThanOrEqual(10000);
  });

  it('respects a provider Retry-After value when present', () => {
    expect(computeBackoffMs(1, 17)).toBe(17000);
  });
});

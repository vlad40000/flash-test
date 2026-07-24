export const MAX_RETRY_ATTEMPTS = 3;

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'network_interruption',
  'connection_reset',
  'request_timeout',
]);

export interface RetryClassificationInput {
  providerStatus: number | null;
  providerErrorCode: string | null;
  /** True if the failure was a JSON parse failure or schema-invalid model output — never retried. */
  isOutputValidationFailure?: boolean;
}

/**
 * Classifies whether a failed attempt should be retried. Only transient provider/network
 * failures are retryable; 4xx client errors, unsupported model/parameter errors, invalid
 * image/schema errors, and output-validation failures (JSON parse / schema invalid) never are.
 */
export function isRetryable(input: RetryClassificationInput): boolean {
  if (input.isOutputValidationFailure) return false;

  if (input.providerStatus != null && RETRYABLE_HTTP_STATUSES.has(input.providerStatus)) {
    return true;
  }
  if (input.providerErrorCode && RETRYABLE_NETWORK_CODES.has(input.providerErrorCode)) {
    return true;
  }
  return false;
}

/**
 * Backoff schedule: 2s, 4s, 8s for attempts 1, 2, 3 respectively, with up to 25% jitter added.
 * A provider `Retry-After` value (seconds) takes precedence when present.
 */
export function computeBackoffMs(attemptNumber: number, retryAfterSeconds?: number | null): number {
  if (retryAfterSeconds != null && retryAfterSeconds > 0) {
    return Math.round(retryAfterSeconds * 1000);
  }
  const base = [2000, 4000, 8000][attemptNumber - 1] ?? 8000;
  const jitter = base * 0.25 * Math.random();
  return Math.round(base + jitter);
}

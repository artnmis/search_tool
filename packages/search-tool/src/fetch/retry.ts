/**
 * fetch/retry.ts
 *
 * Retry policy for transient HTTP failures.
 *
 * §105 of the spec.  The retriever retries on 429 (Too Many Requests) and
 * 503 (Service Unavailable) using the Retry-After header when present.
 * It never retries on 4xx errors other than 429, because those represent
 * permanent client-side failures (not found, forbidden, etc.).
 *
 * The retry budget is deliberately small — we are a polite retriever, not
 * a high-availability infrastructure component.
 */

/** Configuration for the retry policy. */
export interface RetryOptions {
  /** Maximum number of retries per request (default: 2). */
  maxRetries: number;
  /** Base back-off delay in ms when no Retry-After header is present. */
  baseDelayMs: number;
  /** Maximum delay regardless of Retry-After value (cap, in ms). */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 1_000, // 1 s
  maxDelayMs: 30_000, // 30 s cap on Retry-After honour
};

/**
 * Returns true when an HTTP status code warrants a retry.
 * Only 429 and 503 are retried — other errors are final.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

/**
 * Computes the delay in ms before the next retry attempt.
 *
 * Uses the Retry-After header value when present and reasonable.
 * Falls back to exponential back-off based on the attempt number.
 *
 * @param retryAfterHeader  Value of the Retry-After response header (may be
 *                          a delta-seconds integer or an HTTP-date string).
 * @param attempt           0-based attempt number (0 = first retry).
 * @param options           Retry configuration.
 */
export function computeRetryDelay(
  retryAfterHeader: string | null,
  attempt: number,
  options: RetryOptions,
): number {
  if (retryAfterHeader) {
    const delta = parseRetryAfter(retryAfterHeader);
    if (delta !== null) {
      // Honour Retry-After but cap it so we don't wait forever.
      return Math.min(delta * 1_000, options.maxDelayMs);
    }
  }

  // Exponential back-off: baseDelay * 2^attempt, capped at maxDelayMs.
  const exponential = options.baseDelayMs * Math.pow(2, attempt);
  return Math.min(exponential, options.maxDelayMs);
}

/**
 * Resolves a Retry-After header value to delta-seconds.
 * Returns null when the value cannot be parsed.
 */
function parseRetryAfter(value: string): number | null {
  // Integer form: "30"
  const asNumber = parseInt(value, 10);
  if (!isNaN(asNumber) && asNumber >= 0) return asNumber;

  // HTTP-date form: "Wed, 21 Oct 2025 07:28:00 GMT"
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const deltaMs = date.getTime() - Date.now();
    return deltaMs > 0 ? Math.ceil(deltaMs / 1_000) : 0;
  }

  return null;
}

/** Awaitable delay. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

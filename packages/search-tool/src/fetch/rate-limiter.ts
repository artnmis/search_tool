/**
 * fetch/rate-limiter.ts
 *
 * Per-domain request queue and politeness controls.
 *
 * §56 (rate limiting) and §106 (concurrency policy) of the spec.
 *
 * Two rules:
 *  1. No more than `maxConcurrentRequests` in-flight fetches at any time.
 *  2. Per-domain: honour the robots.txt Crawl-delay, and always wait at
 *     least MIN_INTER_REQUEST_MS between consecutive requests to the same
 *     domain.
 *
 * We deliberately keep this simple — a token-bucket or sliding-window
 * approach would be overkill for a retriever that makes at most ~8 requests
 * per retrieve() call.
 */

/** Minimum gap between two consecutive requests to the same domain (ms). */
const MIN_INTER_REQUEST_MS = 500;

export class RateLimiter {
  /** When each domain was last fetched (timestamp in ms). */
  private readonly lastFetch = new Map<string, number>();

  /** Per-domain crawl-delay in seconds (from robots.txt). */
  private readonly crawlDelays = new Map<string, number>();

  /** Number of requests currently in-flight. */
  private inFlight = 0;

  /** Queue of waiters blocked on the global concurrency cap. */
  private readonly waitQueue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  /**
   * Register a crawl-delay for a domain (from its robots.txt).
   * Only values in the range [0.5 s, 60 s] are accepted — values outside
   * this range are ignored to prevent DoS via robots.txt abuse.
   */
  setCrawlDelay(domain: string, seconds: number): void {
    if (seconds >= 0.5 && seconds <= 60) {
      this.crawlDelays.set(domain, seconds);
    }
  }

  /**
   * Acquires a slot before a fetch, waiting if:
   *   - the global concurrency cap is hit;
   *   - the per-domain politeness delay has not elapsed.
   *
   * Call `release()` after the fetch completes (success or failure).
   */
  async acquire(domain: string): Promise<void> {
    // Wait for a global concurrency slot.
    await this.waitForSlot();

    // Wait for the per-domain politeness delay.
    await this.waitForDomain(domain);

    this.inFlight++;
    this.lastFetch.set(domain, Date.now());
  }

  /** Must be called after every fetch, even on error. */
  release(): void {
    this.inFlight--;
    // Wake up the next waiter if any.
    const next = this.waitQueue.shift();
    if (next) next();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private waitForSlot(): Promise<void> {
    if (this.inFlight < this.maxConcurrent) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  private async waitForDomain(domain: string): Promise<void> {
    const last = this.lastFetch.get(domain);
    if (last === undefined) return; // first request to this domain

    const crawlDelayMs = (this.crawlDelays.get(domain) ?? 0) * 1_000;
    const requiredGapMs = Math.max(crawlDelayMs, MIN_INTER_REQUEST_MS);
    const elapsed = Date.now() - last;

    if (elapsed < requiredGapMs) {
      await sleep(requiredGapMs - elapsed);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

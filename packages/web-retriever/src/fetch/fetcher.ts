/**
 * fetch/fetcher.ts
 *
 * The HTTP fetch layer — the single entry point for every outgoing network
 * request in the retriever.
 *
 * Responsibilities:
 *   - attach canonical headers (User-Agent, Accept-Encoding, …)
 *   - enforce timeouts via AbortController
 *   - follow redirects safely (re-validating each hop via SSRF/redirect guards)
 *   - enforce response size limits and detect compression bombs
 *   - retry on 429/503 with Retry-After back-off
 *   - honour the rate limiter before each outgoing request
 *   - return a normalised FetchResponse or throw a typed RetrieveError
 *
 * §36 (HTTP fetching pipeline) of the spec.
 *
 * This module uses Node's built-in `fetch` (available since Node 18).
 * It does NOT use node-fetch, axios, or any other HTTP library.
 */

import { assertSafeUrl } from "../security/ssrf.js";
import { assertSafeRedirect, isRedirectLoop } from "../security/redirect.js";
import { isSafePort, getPort } from "../security/ports.js";
import { baseHeaders, conditionalHeaders } from "./headers.js";
import { readBodyWithLimit } from "./limits.js";
import { isRetryableStatus, computeRetryDelay, delay, DEFAULT_RETRY_OPTIONS } from "./retry.js";
import { RateLimiter } from "./rate-limiter.js";
import type { FetchResponse, RetrieveError, SafeUrl } from "../core/types.js";
import { DEFAULTS } from "../core/defaults.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetcherOptions {
  timeoutMs?: number | undefined;
  maxResponseBytes?: number | undefined;
  maxRedirects?: number | undefined;
  maxRetries?: number | undefined;
  /** Conditional request headers (ETag / Last-Modified from cache). */
  etag?: string | undefined;
  lastModified?: string | undefined;
  /** Extra headers to merge in (e.g. Accept: application/json). */
  extraHeaders?: Record<string, string> | undefined;
}

// ---------------------------------------------------------------------------
// Module-level shared rate limiter
// ---------------------------------------------------------------------------
// One limiter is shared across all fetches within a retrieve() call.
// Callers inject it via the Fetcher constructor so tests can swap it out.

export class Fetcher {
  private readonly rateLimiter: RateLimiter;

  constructor(rateLimiter?: RateLimiter) {
    this.rateLimiter = rateLimiter ?? new RateLimiter(DEFAULTS.maxConcurrentRequests);
  }

  /**
   * Fetches a URL and returns a normalised FetchResponse.
   *
   * Validates the URL for SSRF and port safety before any network I/O.
   * Follows redirects up to maxRedirects, re-validating each hop.
   * Retries on 429/503 within the retry budget.
   */
  async fetch(rawUrl: string, options: FetcherOptions = {}): Promise<FetchResponse> {
    const maxBytes = options.maxResponseBytes ?? DEFAULTS.maxResponseBytes;
    const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
    const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    const maxRetries = options.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries;

    // Parse and validate the URL before touching the network.
    const startUrl = parseAndValidateUrl(rawUrl);
    await assertSafeUrl(startUrl);

    let currentUrl = startUrl;
    const visitedUrls = new Set<string>();
    let attempt = 0;

    while (true) {
      const domain = currentUrl.hostname;
      const start = Date.now();

      await this.rateLimiter.acquire(domain);
      let response: Response;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          response = await fetch(currentUrl.href, {
            method: "GET",
            headers: {
              ...baseHeaders(),
              ...conditionalHeaders(options.etag, options.lastModified),
              ...(options.extraHeaders ?? {}),
            },
            redirect: "manual", // We follow redirects ourselves to re-validate each hop.
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (err: unknown) {
        this.rateLimiter.release();
        if (isAbortError(err)) {
          const timeoutError: RetrieveError = {
            code: "TIMEOUT",
            message: `Request to ${currentUrl.href} timed out after ${timeoutMs} ms`,
            url: currentUrl.href,
            cause: err,
          };
          throw timeoutError;
        }
        const netError: RetrieveError = {
          code: "NETWORK_ERROR",
          message: `Network error fetching ${currentUrl.href}: ${String(err)}`,
          url: currentUrl.href,
          cause: err,
        };
        throw netError;
      }

      this.rateLimiter.release();

      // ---- redirect handling ----
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          const error: RetrieveError = {
            code: "NETWORK_ERROR",
            message: `Redirect from ${currentUrl.href} had no Location header`,
            url: currentUrl.href,
          };
          throw error;
        }

        if (isRedirectLoop(new URL(location, currentUrl.href).href, visitedUrls)) {
          const error: RetrieveError = {
            code: "REDIRECT_LOOP",
            message: `Redirect loop detected at ${currentUrl.href}`,
            url: currentUrl.href,
          };
          throw error;
        }

        visitedUrls.add(currentUrl.href);
        currentUrl = await assertSafeRedirect(
          location,
          currentUrl.href,
          visitedUrls.size,
          { maxRedirects },
        );
        attempt = 0; // reset retry counter for the new URL
        continue;
      }

      // ---- retry on 429 / 503 ----
      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const retryAfter = response.headers.get("retry-after");
        const waitMs = computeRetryDelay(retryAfter, attempt, DEFAULT_RETRY_OPTIONS);
        attempt++;
        await delay(waitMs);
        continue;
      }

      // ---- read body ----
      const durationMs = Date.now() - start;
      const body = await readBodyWithLimit(response, maxBytes, currentUrl.href);

      const mimeType = normaliseMime(response.headers.get("content-type") ?? "");

      // Flatten response headers to a plain Record.
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        url: currentUrl.href as SafeUrl,
        status: response.status,
        headers,
        body,
        mimeType,
        durationMs,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseAndValidateUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    const error: RetrieveError = {
      code: "INVALID_URL",
      message: `Cannot parse URL: ${raw}`,
      url: raw,
    };
    throw error;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    const error: RetrieveError = {
      code: "UNSAFE_SCHEME",
      message: `Scheme not allowed: ${parsed.protocol} in ${raw}`,
      url: raw,
    };
    throw error;
  }

  const port = getPort(parsed);
  if (!isSafePort(port)) {
    const error: RetrieveError = {
      code: "UNSAFE_PORT",
      message: `Port ${port} is not in the safe-port allowlist: ${raw}`,
      url: raw,
    };
    throw error;
  }

  return parsed;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Strips charset and other parameters from a Content-Type header value,
 * and lower-cases the result for consistent comparison.
 *
 * "text/html; charset=utf-8"  →  "text/html"
 */
export function normaliseMime(raw: string): string {
  return raw.split(";")[0]?.trim().toLowerCase() ?? "";
}

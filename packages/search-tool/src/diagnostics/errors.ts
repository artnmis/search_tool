/**
 * diagnostics/errors.ts
 *
 * Full error taxonomy as typed discriminated unions.
 *
 * §84 of the spec.
 *
 * Every error the retriever can throw is represented here as a typed class
 * that extends Error.  All error codes from RetrieveErrorCode are covered.
 *
 * Using class-based errors (rather than plain objects) means:
 *   - `instanceof` checks work correctly
 *   - Stack traces are preserved
 *   - The `cause` chain is maintained
 */

import type { RetrieveErrorCode } from "../core/types.js";

/**
 * Base class for all retriever errors.
 *
 * The `code` discriminant identifies the error type without string parsing.
 */
export class RetrieverError extends Error {
  readonly code: RetrieveErrorCode;
  readonly url?: string | undefined;

  constructor(code: RetrieveErrorCode, message: string, options?: { url?: string | undefined; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "RetrieverError";
    this.code = code;
    this.url = options?.url;
  }
}

// ---------------------------------------------------------------------------
// Typed subclasses — one per error category for easy instanceof discrimination
// ---------------------------------------------------------------------------

/** The starting URL is syntactically invalid or has an unsafe scheme/port. */
export class InvalidUrlError extends RetrieverError {
  constructor(message: string, url?: string | undefined) {
    super("INVALID_URL", message, url !== undefined ? { url } : undefined);
    this.name = "InvalidUrlError";
  }
}

/** The destination resolves to a private/internal IP address. */
export class SsrfBlockedError extends RetrieverError {
  constructor(message: string, url?: string | undefined) {
    super("SSRF_BLOCKED", message, url !== undefined ? { url } : undefined);
    this.name = "SsrfBlockedError";
  }
}

/** The target URL is disallowed by robots.txt. */
export class RobotsBlockedError extends RetrieverError {
  constructor(url: string) {
    super("ROBOTS_BLOCKED", `Robots.txt disallows access to ${url}`, { url });
    this.name = "RobotsBlockedError";
  }
}

/** Network-level failure (DNS, TCP, TLS). */
export class NetworkError extends RetrieverError {
  constructor(message: string, url?: string | undefined, cause?: unknown) {
    super("NETWORK_ERROR", message, { ...(url !== undefined ? { url } : {}), cause });
    this.name = "NetworkError";
  }
}

/** Request exceeded the configured timeout. */
export class TimeoutError extends RetrieverError {
  constructor(url: string, timeoutMs: number) {
    super("TIMEOUT", `Request to ${url} timed out after ${timeoutMs}ms`, { url });
    this.name = "TimeoutError";
  }
}

/** Response body exceeded the configured size limit. */
export class ResponseTooLargeError extends RetrieverError {
  constructor(url: string, bytes: number, limit: number) {
    super("RESPONSE_TOO_LARGE", `Response from ${url} is ${bytes} bytes (limit: ${limit})`, { url });
    this.name = "ResponseTooLargeError";
  }
}

/** Compressed response expanded beyond the compression-bomb threshold. */
export class CompressionBombError extends RetrieverError {
  constructor(url: string) {
    super("COMPRESSION_BOMB", `Possible compression bomb detected from ${url}`, { url });
    this.name = "CompressionBombError";
  }
}

/** The content type has no registered adapter and no override was provided. */
export class UnsupportedContentTypeError extends RetrieverError {
  constructor(url: string, mimeType: string) {
    super("UNSUPPORTED_CONTENT_TYPE", `No adapter for ${mimeType} from ${url}`, { url });
    this.name = "UnsupportedContentTypeError";
  }
}

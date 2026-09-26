/**
 * fetch/limits.ts
 *
 * Response size enforcement and compression-bomb detection.
 *
 * §57 (response size limits) and §58 (compression bombs) of the spec.
 *
 * A "compression bomb" is a small compressed response (e.g. a few KB of
 * gzip) that expands to hundreds of megabytes.  We detect this by comparing
 * the Content-Length header to the actual decompressed byte count as we read
 * the stream.
 */

import { RetrieveError } from "../core/types.js";

/**
 * Reads a Response body up to `maxBytes`, throwing a RetrieveError if the
 * limit is exceeded.
 *
 * Also detects compression bombs: if the body grows more than
 * COMPRESSION_RATIO_LIMIT times the declared Content-Length, the read is
 * aborted.
 *
 * Returns the complete body as a Uint8Array.
 */
export async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  url: string,
): Promise<Uint8Array> {
  const contentLength = getContentLength(response);

  // Reject immediately if Content-Length already exceeds the limit.
  if (contentLength !== null && contentLength > maxBytes) {
    throw makeSizeError(url, contentLength, maxBytes);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    // No body (e.g. HEAD response or empty 204) — return empty.
    return new Uint8Array(0);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;

    // Hard size cap — stop reading.
    if (totalBytes > maxBytes) {
      reader.cancel().catch(() => {});
      throw makeSizeError(url, totalBytes, maxBytes);
    }

    // Compression bomb heuristic: decompressed body is growing way beyond
    // the declared compressed Content-Length.
    if (contentLength !== null && totalBytes > contentLength * COMPRESSION_RATIO_LIMIT) {
      reader.cancel().catch(() => {});
      const error: RetrieveError = {
        code: "COMPRESSION_BOMB",
        message:
          `Response from ${url} appears to be a compression bomb ` +
          `(decompressed ${totalBytes} bytes; declared ${contentLength} bytes)`,
        url,
      };
      throw error;
    }

    chunks.push(value);
  }

  // Merge chunks into a single buffer.
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * If the response body grows more than this multiple of the declared
 * Content-Length, treat it as a compression bomb.
 *
 * 100× is conservative — legitimate gzip compression ratios for text are
 * typically 3–10×.  Even very compressible HTML rarely exceeds 20×.
 */
const COMPRESSION_RATIO_LIMIT = 100;

function getContentLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

function makeSizeError(url: string, actual: number, limit: number): RetrieveError {
  return {
    code: "RESPONSE_TOO_LARGE",
    message: `Response from ${url} exceeds size limit: ${actual} bytes > ${limit} bytes`,
    url,
  };
}

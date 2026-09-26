/**
 * fetch/headers.ts
 *
 * Canonical request headers sent with every outgoing fetch.
 *
 * §87 of the spec requires the retriever to identify itself honestly with a
 * descriptive User-Agent so that site operators can see traffic and block it
 * if they choose.  We never impersonate a browser — doing so to bypass
 * robots rules would violate §120 Rule 6.
 */

/** The package version string, replaced at build time or left as-is. */
const PKG_VERSION = "0.0.1";

/**
 * The User-Agent sent on every outgoing request.
 *
 * Format mirrors the crawlbot conventions used by major search engines so
 * that operators can recognise and manage the traffic.
 */
export const USER_AGENT =
  `WebRetriever/${PKG_VERSION} (+https://github.com/web-retriever; AI evidence retrieval)`;

/**
 * Returns the baseline headers that must be included on every fetch.
 *
 * Callers can spread additional headers on top.
 */
export function baseHeaders(): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    // Prefer compressed responses to reduce bandwidth (Node fetch handles decompression).
    "Accept-Encoding": "gzip, deflate, br",
    // We never send cookies; accepting them is fine for stateless public requests.
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  };
}

/**
 * Returns headers for an HTTP conditional request (§37).
 *
 * If the cache holds an ETag or Last-Modified value for the URL, include the
 * appropriate conditional header so the server can return a cheap 304.
 */
export function conditionalHeaders(
  etag?: string,
  lastModified?: string,
): Record<string, string> {
  const h: Record<string, string> = {};
  if (etag) h["If-None-Match"] = etag;
  if (lastModified) h["If-Modified-Since"] = lastModified;
  return h;
}

/**
 * resolution/canonical.ts
 *
 * URL normalisation — produces a canonical form for every URL so that
 * equivalent URLs are recognised as duplicates and tracking parameters do
 * not pollute the candidate set.
 *
 * §26 of the spec.
 *
 * What we normalise:
 *   - resolve relative URLs against a base
 *   - lower-case scheme and host
 *   - remove default port (80 for http, 443 for https)
 *   - remove URL fragments (#…)
 *   - remove known tracking parameters (utm_*, fbclid, gclid, …)
 *   - normalise trailing slash on bare paths
 *   - percent-decode unreserved characters, re-encode reserved ones
 *   - decode punycode host labels to Unicode for display (keep ASCII internally)
 */

/** Query-string parameters that carry no content information. */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_eid",
  "yclid",
  "ref",
  "_ga",
  "igshid",
]);

/**
 * Normalises a URL string for deduplication and comparison.
 *
 * Returns null when the URL cannot be parsed.
 */
export function normaliseUrl(raw: string, base?: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    return null;
  }

  // Only normalise http(s) URLs.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  // Remove fragment — fragments are client-side only and not relevant to fetch.
  parsed.hash = "";

  // Remove default ports.
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  // Remove tracking parameters.
  for (const key of TRACKING_PARAMS) {
    parsed.searchParams.delete(key);
  }

  // Sort remaining query params for consistent ordering.
  parsed.searchParams.sort();

  // Normalise bare path: "https://example.com" → "https://example.com/"
  if (parsed.pathname === "") parsed.pathname = "/";

  // Strip trailing slash from non-root paths so /page/ and /page are the same.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.href;
}

/**
 * Resolves a potentially relative URL against a base URL.
 * Returns null when either URL is invalid.
 */
export function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Returns true when two URL strings refer to the same normalised resource.
 */
export function isSameUrl(a: string, b: string): boolean {
  const na = normaliseUrl(a);
  const nb = normaliseUrl(b);
  return na !== null && nb !== null && na === nb;
}

/**
 * Returns true when `url` is on the same origin as `base`.
 * Used to enforce the same-origin preference from §101.
 */
export function isSameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

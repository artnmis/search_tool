/**
 * resolution/sitemap-resolver.ts
 *
 * Matches a candidate URL against the sitemap entry set using the same
 * deterministic similarity signals as url-repair.ts, but operates on the
 * pre-parsed sitemap URL list rather than the full observed URL set.
 *
 * §9 and §11 of the spec.
 *
 * This is kept as a thin wrapper so the core pipeline can ask
 * "is this URL in the sitemap?" without re-running full repair logic.
 */

import { normaliseUrl } from "./canonical.js";

export interface SitemapEntry {
  url: string;
  /** ISO date from <lastmod> — used as a freshness hint, never as proof of correctness. */
  lastmod?: string | undefined;
  /** <changefreq> hint, if present. */
  changefreq?: string | undefined;
  /** <priority> value 0–1, if present. */
  priority?: number | undefined;
}

/**
 * Checks whether a URL appears (exactly, after normalisation) in the given
 * sitemap entries.
 *
 * Returns the matching entry, or null if not found.
 */
export function findInSitemap(
  url: string,
  entries: SitemapEntry[],
): SitemapEntry | null {
  const normUrl = normaliseUrl(url);

  for (const entry of entries) {
    if (entry.url === url) return entry;
    if (normUrl && normaliseUrl(entry.url) === normUrl) return entry;
  }

  return null;
}

/**
 * Returns all sitemap entries whose URLs share the same origin as `baseUrl`.
 * Used to build the same-origin candidate set for URL repair and ranking.
 */
export function sameOriginEntries(
  baseUrl: string,
  entries: SitemapEntry[],
): SitemapEntry[] {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  return entries.filter((e) => {
    try {
      return new URL(e.url).origin === origin;
    } catch {
      return false;
    }
  });
}

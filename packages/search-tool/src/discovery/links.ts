/**
 * discovery/links.ts
 *
 * Same-origin link extraction from HTML pages.
 *
 * §25 of the spec.
 *
 * Extracts all <a href> links from parsed HTML, normalises them,
 * deduplicates, and filters to same-origin only.
 *
 * Link extraction is used as a fallback discovery source when no sitemap
 * or feed is available (§10 Phase E).
 */

import { resolveUrl, normaliseUrl, isSameOrigin } from "../resolution/canonical.js";

/**
 * Extracts and normalises same-origin links from a list of raw href values.
 *
 * @param hrefs    Raw href attribute values from <a> tags.
 * @param pageUrl  The page URL used to resolve relative hrefs.
 */
export function extractSameOriginLinks(hrefs: string[], pageUrl: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const href of hrefs) {
    // Skip anchors, javascript:, mailto:, etc.
    if (!href || href.startsWith("#") || href.includes(":") && !href.startsWith("http")) {
      continue;
    }

    const resolved = resolveUrl(href, pageUrl);
    if (!resolved) continue;
    if (!isSameOrigin(resolved, pageUrl)) continue;

    const normalised = normaliseUrl(resolved);
    if (!normalised || seen.has(normalised)) continue;

    seen.add(normalised);
    results.push(normalised);
  }

  return results;
}

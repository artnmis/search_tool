/**
 * ranking/dedupe.ts
 *
 * Three-level deduplication pipeline.
 *
 * §27 of the spec.
 *
 * Level 1 — URL-level:    exact and normalised URL match.
 * Level 2 — Canonical:    <link rel="canonical"> / HTTP Link header match.
 * Level 3 — Content:      near-duplicate detection via a lightweight
 *                          fingerprint (first 200 chars normalised).
 *
 * We intentionally keep Level 3 cheap — no SimHash, no MinHash, just
 * a deterministic string fingerprint.  The goal is to drop obvious
 * duplicates, not to achieve perfect near-duplicate recall.
 */

import { normaliseUrl } from "../resolution/canonical.js";

// ---------------------------------------------------------------------------
// URL-level deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicates an array of URL strings, keeping only the first occurrence
 * of each normalised URL.
 */
export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    const key = normaliseUrl(url) ?? url;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(url);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Canonical-level deduplication
// ---------------------------------------------------------------------------

/**
 * Removes URLs whose canonical resolves to an already-seen canonical URL.
 *
 * @param urlToCanonical  Map from a page's URL to its canonical URL.
 */
export function dedupeByCanonical(
  urls: string[],
  urlToCanonical: Map<string, string>,
): string[] {
  const seenCanonicals = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    const canonical = urlToCanonical.get(url) ?? url;
    const key = normaliseUrl(canonical) ?? canonical;
    if (!seenCanonicals.has(key)) {
      seenCanonicals.add(key);
      result.push(url);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Content-level deduplication
// ---------------------------------------------------------------------------

/**
 * Removes passages whose content fingerprint has already been seen.
 *
 * The fingerprint is the first 200 characters of the passage, lowercased
 * and whitespace-normalised.  This catches copy-pasted boilerplate and
 * syndicated content without any probabilistic data structure.
 */
export function dedupePassages<T extends { text: string }>(passages: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const passage of passages) {
    const fp = contentFingerprint(passage.text);
    if (!seen.has(fp)) {
      seen.add(fp);
      result.push(passage);
    }
  }

  return result;
}

function contentFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

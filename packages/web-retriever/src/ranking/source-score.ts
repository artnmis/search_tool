/**
 * ranking/source-score.ts
 *
 * Source quality and diversity scoring.
 *
 * §33 of the spec.
 *
 * After BM25 ranks passages, we apply two passes:
 *
 *   1. Populate source.relevance from its strongest passage (Bug 15 fix).
 *      "makeSource()" in the orchestrator sets relevance=0; this function
 *      updates it so the returned SourceResult metadata is accurate.
 *
 *   2. Diversity enforcement: cap the number of passages per source URL so
 *      one very long page doesn't crowd out other sources.
 */

import type { Evidence, SourceResult } from "../core/types.js";

/** Maximum passages to take from any single source URL. */
const MAX_PASSAGES_PER_SOURCE = 4;

// ---------------------------------------------------------------------------
// Source quality scoring
// ---------------------------------------------------------------------------

/**
 * Computes a 0–1 quality score for a source document.
 * Higher is better.
 */
export function scoreSource(source: SourceResult): number {
  let score = 0.5; // baseline

  // HTTP 200 preferred over everything else.
  if (source.httpStatus === 200) score += 0.2;
  else if (source.httpStatus && source.httpStatus >= 400) score -= 0.3;

  // Has a meaningful title.
  if (source.title && source.title.length > 3) score += 0.1;

  // Same-origin gets a small bonus (§101).
  // (origin check is left to the caller since we don't have the base URL here)

  return Math.max(0, Math.min(1, score));
}

/**
 * Updates each source's relevance field to be the max relevance of all
 * passages that came from it (Bug 15 fix).
 *
 * The orchestrator calls makeSource() before BM25 ranking, so relevance
 * starts at 0.  This function updates it after evidence is ranked.
 *
 * Modifies sources in place — avoids an extra allocation.
 */
export function populateSourceRelevance(
  sources: SourceResult[],
  evidence: Evidence[],
): void {
  const maxRelevanceByUrl = new Map<string, number>();

  for (const item of evidence) {
    const current = maxRelevanceByUrl.get(item.sourceUrl) ?? 0;
    if (item.relevance > current) {
      maxRelevanceByUrl.set(item.sourceUrl, item.relevance);
    }
  }

  for (const source of sources) {
    const maxRel = maxRelevanceByUrl.get(source.url);
    if (maxRel !== undefined) {
      source.relevance = maxRel;
    }
  }
}

// ---------------------------------------------------------------------------
// Diversity enforcement
// ---------------------------------------------------------------------------

/**
 * Applies a per-source passage cap to promote diversity.
 *
 * Given a ranked list of evidence passages, returns a new list where no
 * single source URL contributes more than `maxPerSource` passages.
 *
 * The input order (ranking) is preserved — we simply skip passages once
 * their source has hit the cap.
 */
export function enforceSourceDiversity(
  evidence: Evidence[],
  maxPerSource: number = MAX_PASSAGES_PER_SOURCE,
): Evidence[] {
  const countBySource = new Map<string, number>();
  const result: Evidence[] = [];

  for (const item of evidence) {
    const count = countBySource.get(item.sourceUrl) ?? 0;
    if (count < maxPerSource) {
      countBySource.set(item.sourceUrl, count + 1);
      result.push(item);
    }
  }

  return result;
}

/**
 * ranking/url-score.ts
 *
 * Deterministic URL relevance scoring.
 *
 * §30 of the spec.
 *
 * Scores a candidate URL against a query using lightweight signals that
 * require no model, no embeddings, and no remote call:
 *
 *   - Path-token overlap with query tokens
 *   - URL depth penalty (deeper = lower base score)
 *   - File type preference (HTML > text > JSON > PDF for general queries)
 *   - Recency bonus from sitemap lastmod
 *   - Same-origin preference (§101)
 *
 * The output is a 0–1 score.  It is combined with BM25 passage scores in
 * the orchestrator to produce the final candidate ranking.
 */

import { tokenize } from "./tokenizer.js";

// ---------------------------------------------------------------------------
// File-type preference weights (used when query has no strong type signal)
// ---------------------------------------------------------------------------
const MIME_WEIGHTS: Record<string, number> = {
  "text/html": 1.0,
  "text/plain": 0.8,
  "text/markdown": 0.8,
  "application/json": 0.75,
  "application/xml": 0.7,
  "application/rss+xml": 0.65,
  "application/atom+xml": 0.65,
  "application/pdf": 0.6,
  "text/csv": 0.55,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UrlScoreInput {
  url: string;
  query: string;
  /** MIME type of the resource, if known. */
  mimeType?: string;
  /** ISO date from sitemap lastmod, if present. */
  lastmod?: string;
  /** Sitemap priority 0–1, if present. */
  priority?: number;
  /** Anchor text of the link that points to this URL (Bug 10). */
  anchorText?: string;
  /** The base URL of the retrieval session (used for same-origin check). */
  baseUrl: string;
}

/**
 * Scores a single URL candidate against the query.
 * Returns a value in [0, 1].
 */
export function scoreUrl(input: UrlScoreInput): number {
  const { url, query, mimeType, lastmod, priority, anchorText, baseUrl } = input;

  const queryTokens = new Set(tokenize(query));
  const urlTokens = tokenize(urlPathTokens(url));

  // --- Signal 1: query-token overlap in URL path ---
  const overlapCount = [...urlTokens].filter((t) => queryTokens.has(t)).length;
  const overlapScore =
    queryTokens.size > 0 ? overlapCount / queryTokens.size : 0;

  // --- Signal 2: anchor text overlap with query (Bug 10 fix) ---
  // Anchor text is often more descriptive than the URL path, especially on
  // education/exam sites where URLs are opaque (e.g. /chapter/37).
  let anchorScore = 0;
  if (anchorText) {
    const anchorTokens = new Set(tokenize(anchorText));
    const anchorOverlap = [...anchorTokens].filter((t) => queryTokens.has(t)).length;
    anchorScore = queryTokens.size > 0 ? anchorOverlap / queryTokens.size : 0;
  }

  // --- Signal 3: URL depth penalty ---
  // Prefer shallower pages; deeply nested paths are less likely to be canonical.
  const depth = countPathSegments(url);
  const depthScore = Math.max(0, 1 - depth * 0.1);

  // --- Signal 4: file type weight ---
  const typeScore = mimeType ? (MIME_WEIGHTS[mimeType] ?? 0.5) : 0.7;

  // --- Signal 5: recency bonus from lastmod ---
  const recencyScore = computeRecencyScore(lastmod);

  // --- Signal 6: sitemap priority (Bug 9 fix) ---
  // Sitemap priority is the site owner's hint about page importance.
  const priorityBonus = priority != null ? priority * 0.1 : 0;

  // --- Signal 7: same-origin preference ---
  const sameOriginBonus = isSameOrigin(url, baseUrl) ? 0.1 : 0;

  // Weighted combination.
  // URL overlap and anchor text are primary signals, then quality/freshness.
  const raw =
    overlapScore * 0.4 +
    anchorScore * 0.2 +
    depthScore * 0.1 +
    typeScore * 0.1 +
    recencyScore * 0.05 +
    priorityBonus +
    sameOriginBonus;

  return Math.min(1.0, raw);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extracts the path and hostname from a URL as a tokenizable string. */
function urlPathTokens(url: string): string {
  try {
    const u = new URL(url);
    // Include hostname tokens (e.g. "docs.example.com" → "docs example com")
    // and pathname tokens together.
    return u.hostname.replace(/\./g, " ") + " " + u.pathname.replace(/[/\-_.]/g, " ");
  } catch {
    return url;
  }
}

function countPathSegments(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function isSameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * Converts an ISO lastmod date to a recency score in [0, 1].
 * Pages modified in the last 30 days score 1.0; 1 year ago scores ~0.3.
 */
function computeRecencyScore(lastmod?: string): number {
  if (!lastmod) return 0.5; // no data — neutral

  const date = new Date(lastmod);
  if (isNaN(date.getTime())) return 0.5;

  const ageMs = Date.now() - date.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay: score = e^(-ageDays / 365)
  return Math.exp(-ageDays / 365);
}

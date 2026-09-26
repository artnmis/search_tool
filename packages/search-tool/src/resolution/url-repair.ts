/**
 * resolution/url-repair.ts
 *
 * Hallucination repair — corrects AI-supplied URLs that do not exist on the
 * actual site by finding the closest observed URL in the site's known URL set.
 *
 * §9 of the spec.
 *
 * CRITICAL CONSTRAINT: a "repaired" URL must come from observed site data.
 * We never invent a URL because it "looks plausible".  If no candidate clears
 * the confidence threshold, we return resolved=false.
 *
 * Resolution order (§9):
 *   1. Exact URL match
 *   2. Exact normalised URL match
 *   3. Canonical URL match (from HTTP Link or <link rel="canonical">)
 *   4. Redirect destination (checked by the fetcher)
 *   5. Exact path found in sitemap/feed
 *   6. Exact path found in discovered links
 *   7. Deterministic path-token + anchor-text similarity against known site URLs
 *   8. Reject if confidence is below the strict threshold
 */

import { normaliseUrl, isSameOrigin } from "./canonical.js";
import type { NavigationResult } from "../core/types.js";
import type { SitemapEntry } from "./sitemap-resolver.js";

/** Minimum similarity score required to accept a path-similarity repair. */
const SIMILARITY_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Enriched candidate — preserves metadata for better ranking
// ---------------------------------------------------------------------------

/**
 * A discovered URL with all available metadata for repair ranking.
 *
 * Carrying this through the pipeline (Bug 9/10/17 fixes) allows the scorer to
 * use sitemap priority, anchor text, and source type — not just path tokens.
 */
export interface DiscoveredUrl {
  url: string;
  /** Where this URL was found. */
  source: "sitemap" | "link" | "feed" | "canonical" | "json";
  /** ISO date from sitemap lastmod, if available. */
  lastmod?: string | undefined;
  /** Sitemap priority 0–1, if available. */
  priority?: number | undefined;
  /** Anchor text of the <a> element that linked here, if available. */
  anchorText?: string | undefined;
  /** Link-follow depth from the starting URL. */
  depth: number;
}

export interface RepairInput {
  /** The URL the AI supplied (may not exist). */
  requestedUrl: string;
  /**
   * All URLs observed from robots/sitemap/feeds/links during discovery.
   * Accepts either plain strings or enriched DiscoveredUrl objects.
   */
  observedUrls: string[] | DiscoveredUrl[];
  /** The canonical URL returned by the server (if any). */
  serverCanonical?: string;
  /** Raw sitemap entries, if available — used for priority/lastmod scoring. */
  sitemapEntries?: SitemapEntry[];
}

export interface RepairResult {
  navigation: NavigationResult;
  /**
   * The best matching discovered URL with full metadata, if a repair was found.
   * Useful for the orchestrator to fetch the repaired URL directly.
   */
  repairedCandidate?: DiscoveredUrl | undefined;
}

/**
 * Attempts to resolve `requestedUrl` to a real observed URL.
 *
 * Returns a NavigationResult describing how (or whether) resolution succeeded.
 */
export function repairUrl(input: RepairInput): RepairResult {
  const { requestedUrl, serverCanonical } = input;

  // Normalise the input to DiscoveredUrl objects so the scorer has metadata.
  const observedEntries = normaliseInput(input.observedUrls, input.sitemapEntries);
  const observedPlain = observedEntries.map((e) => e.url);

  // Step 1: exact match in observed set
  if (observedPlain.includes(requestedUrl)) {
    const entry = observedEntries.find((e) => e.url === requestedUrl);
    return nav("exact", requestedUrl, true, entry);
  }

  // Step 2: normalised match
  const normRequested = normaliseUrl(requestedUrl);
  if (normRequested) {
    for (const entry of observedEntries) {
      if (normaliseUrl(entry.url) === normRequested) {
        return nav("exact", entry.url, true, entry);
      }
    }
  }

  // Step 3: canonical match
  if (serverCanonical) {
    if (observedPlain.includes(serverCanonical)) {
      const entry = observedEntries.find((e) => e.url === serverCanonical);
      return nav("canonical", serverCanonical, true, entry);
    }
  }

  // Step 4: redirect destination — handled by the fetcher; if we are here the
  // fetcher already followed redirects and the final URL is in observedEntries.

  // Step 5 & 6: exact path in sitemap/feed/links (already part of observedEntries)
  // — covered by steps 1–2.

  // Step 7: path-token + anchor-text similarity against same-origin URLs only
  const sameOriginEntries = observedEntries.filter((e) =>
    isSameOrigin(e.url, requestedUrl),
  );

  const best = findBestMatch(requestedUrl, sameOriginEntries);
  if (best && best.score >= SIMILARITY_THRESHOLD) {
    const entry = sameOriginEntries.find((e) => e.url === best.url);
    return nav("path_similarity", best.url, true, entry);
  }

  // Step 8: reject
  return {
    navigation: {
      resolved: false,
      method: "none",
      reason: "no_safe_url_match",
    },
  };
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

function normaliseInput(
  input: string[] | DiscoveredUrl[],
  sitemapEntries?: SitemapEntry[],
): DiscoveredUrl[] {
  if (input.length === 0) return [];

  // If already DiscoveredUrl, return as-is.
  if (typeof input[0] !== "string") {
    return input as DiscoveredUrl[];
  }

  // Plain strings — convert, enriching with sitemap metadata where available.
  const sitemapByUrl = new Map<string, SitemapEntry>();
  for (const se of sitemapEntries ?? []) {
    sitemapByUrl.set(se.url, se);
    const norm = normaliseUrl(se.url);
    if (norm) sitemapByUrl.set(norm, se);
  }

  return (input as string[]).map((url): DiscoveredUrl => {
    const se = sitemapByUrl.get(url) ?? sitemapByUrl.get(normaliseUrl(url) ?? "");
    return {
      url,
      source: se ? "sitemap" : "link",
      lastmod: se?.lastmod,
      priority: se?.priority,
      depth: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Similarity scoring
// ---------------------------------------------------------------------------

interface ScoredUrl {
  url: string;
  score: number;
}

/**
 * Finds the best similarity match for `requestedUrl` among `candidates`.
 *
 * Signals used (all deterministic, no embeddings):
 *   - Path-token overlap (Jaccard + soft prefix)
 *   - Anchor text overlap with query path tokens
 *   - Sitemap priority bonus
 *   - Same parent directory
 *   - File extension match
 */
function findBestMatch(requestedUrl: string, candidates: DiscoveredUrl[]): ScoredUrl | null {
  if (candidates.length === 0) return null;

  let best: ScoredUrl | null = null;

  const reqPath = safePathname(requestedUrl);
  const reqTokens = pathTokens(reqPath);

  for (const candidate of candidates) {
    const candPath = safePathname(candidate.url);
    const candTokens = pathTokens(candPath);

    const pathScore = computePathSimilarity(reqTokens, candTokens, reqPath, candPath);

    // Anchor-text bonus: if the link text overlaps with the requested path's
    // tokens, this is a strong signal that this candidate is the intended page.
    let anchorBonus = 0;
    if (candidate.anchorText) {
      const anchorTokens = new Set(pathTokens(candidate.anchorText));
      const overlap = reqTokens.filter((t) => anchorTokens.has(t)).length;
      anchorBonus = reqTokens.length > 0 ? Math.min(0.3, (overlap / reqTokens.length) * 0.4) : 0;
    }

    // Sitemap priority bonus (0–1 → 0–0.1).
    const priorityBonus = candidate.priority != null ? candidate.priority * 0.1 : 0;

    const score = Math.min(1.0, pathScore + anchorBonus + priorityBonus);

    if (best === null || score > best.score) {
      best = { url: candidate.url, score };
    }
  }

  return best;
}

function computePathSimilarity(
  reqTokens: string[],
  candTokens: string[],
  reqPath: string,
  candPath: string,
): number {
  if (reqTokens.length === 0 && candTokens.length === 0) return 1.0;
  if (reqTokens.length === 0 || candTokens.length === 0) return 0.0;

  const reqSet = new Set(reqTokens);
  const candSet = new Set(candTokens);

  // Exact Jaccard on stemmed tokens.
  const exactIntersection = [...reqSet].filter((t) => candSet.has(t)).length;
  const union = new Set([...reqSet, ...candSet]).size;
  const jaccard = exactIntersection / union;

  // Soft overlap: count a match when one token is a prefix of the other.
  // This catches "auth" ↔ "authentication" after stemming diverges.
  let softMatches = 0;
  for (const r of reqSet) {
    for (const c of candSet) {
      if (r !== c && (r.startsWith(c) || c.startsWith(r)) && Math.min(r.length, c.length) >= 4) {
        softMatches++;
        break;
      }
    }
  }
  const softScore = softMatches / Math.max(reqSet.size, candSet.size);

  // Bonus: same parent directory
  const reqParent = reqPath.split("/").slice(0, -1).join("/");
  const candParent = candPath.split("/").slice(0, -1).join("/");
  const parentBonus = reqParent === candParent ? 0.1 : 0;

  // Bonus: same file extension
  const reqExt = fileExtension(reqPath);
  const candExt = fileExtension(candPath);
  const extBonus = reqExt && reqExt === candExt ? 0.05 : 0;

  return Math.min(1.0, jaccard + softScore * 0.4 + parentBonus + extBonus);
}

function pathTokens(path: string): string[] {
  return path
    .toLowerCase()
    .split(/[/\-_. ]/)
    .filter((t) => t.length > 1);
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function fileExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? (parts[parts.length - 1] ?? "").toLowerCase() : "";
}

function nav(
  method: NavigationResult["method"],
  resolvedUrl: string,
  resolved: boolean,
  entry?: DiscoveredUrl,
): RepairResult {
  return {
    navigation: { resolved, method, resolvedUrl },
    repairedCandidate: entry,
  };
}

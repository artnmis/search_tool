/**
 * core/retrieve.ts
 *
 * The main orchestrator — wires every subsystem together into a single
 * retrieve() call.
 *
 * Pipeline (§6 of the spec):
 *
 *   1. Validate URL (scheme, SSRF, port)
 *   2. Build query plan (mode, budget, token expansion)
 *   3. Fetch robots.txt + extract crawl rules & sitemap hints
 *   4. Discover sitemaps → build URL candidate set (with metadata)
 *   5. Fetch the starting resource
 *   6. If 404 → attempt URL repair using discovered sitemap/links BEFORE giving up
 *   7. Detect content type
 *   8. Extract metadata / links (with anchor text) / application data
 *   9. Score candidates using URL path + anchor text + sitemap metadata
 *  10. Fetch top candidates within budget (budget enforced via RequestBudget)
 *  11. Extract passages from each fetched document
 *  12. Deduplicate, re-rank, enforce source diversity
 *  13. Populate source relevance from passage scores
 *  14. Return compact RetrieveResult
 *
 * §120 engineering rules are enforced here:
 *   - No LLM calls (Rule 2)
 *   - No invented URLs (Rule 5)
 *   - SSRF checked before every fetch (Rule 7)
 *   - Robots respected (Rule 6)
 *   - Source provenance preserved on every extraction (Rule 12)
 */

import { assertSafeUrl } from "../security/ssrf.js";
import { isSafePort, getPort } from "../security/ports.js";
import { Fetcher } from "../fetch/fetcher.js";
import { RateLimiter } from "../fetch/rate-limiter.js";
import { RequestBudget } from "../fetch/budget.js";
import { RobotsPolicy } from "../robots/policy.js";
import { discoverSitemaps } from "../discovery/sitemap.js";
import { extractHtml } from "../formats/html.js";
import type { ExtractedLink } from "../formats/html.js";
import { extractXml } from "../formats/xml.js";
import { extractJson } from "../formats/json.js";
import { extractText, extractMarkdown } from "../formats/text.js";
import { extractPdf } from "../formats/pdf.js";
import { detectContentType } from "../formats/detect.js";
import { extractPassages } from "../extraction/passages.js";
import { scoreUrl } from "../ranking/url-score.js";
import { BM25Index } from "../ranking/bm25.js";
import { dedupeUrls, dedupePassages } from "../ranking/dedupe.js";
import { enforceSourceDiversity, populateSourceRelevance } from "../ranking/source-score.js";
import { repairUrl } from "../resolution/url-repair.js";
import type { DiscoveredUrl } from "../resolution/url-repair.js";
import { normaliseUrl } from "../resolution/canonical.js";
import { MemoryCache } from "../cache/memory.js";
import { buildQueryPlan, shouldStop } from "./planner.js";
import { DEFAULTS } from "./defaults.js";
import type {
  RetrieveOptions,
  RetrieveResult,
  RetrieveStatus,
  Evidence,
  SourceResult,
  NavigationResult,
  RetrievalDiagnostics,
  ExtractionResult,
  FetchResponse,
  RetrieveError,
  Candidate,
} from "./types.js";
import type { SitemapEntry } from "../resolution/sitemap-resolver.js";

// ---------------------------------------------------------------------------
// Module-level shared rate limiter (Bug 20 fix)
//
// Rate limiting is per-Retriever-instance, not per-retrieve()-call.
// This prevents concurrent retrieve() calls from hammering the same domain.
// ---------------------------------------------------------------------------
const sharedRateLimiter = new RateLimiter(DEFAULTS.maxConcurrentRequests);

// ---------------------------------------------------------------------------
// createRetriever factory (§129.2 — domain hints)
// ---------------------------------------------------------------------------

export interface RetrieverConfig {
  /**
   * Static domain hints so the AI can resolve short names to known URLs.
   * e.g. { "stripe": "https://stripe.com/docs" }
   */
  domainHints?: Record<string, string>;
  /**
   * Provide a custom rate limiter to isolate this retriever instance from the
   * shared default.  Useful in tests or when running multiple independent
   * retriever instances that should not share politeness state.
   */
  rateLimiter?: RateLimiter;
}

/**
 * Creates a retriever instance with optional shared configuration.
 * Most callers can use the standalone retrieve() export instead.
 */
export function createRetriever(config: RetrieverConfig = {}) {
  // Instance-level rate limiter so concurrent retrieve() calls via the same
  // instance share politeness state (Bug 20 fix).
  const instanceRateLimiter = config.rateLimiter ?? new RateLimiter(DEFAULTS.maxConcurrentRequests);

  return {
    retrieve: (options: RetrieveOptions) =>
      retrieveWithConfig(options, config, instanceRateLimiter),
  };
}

// ---------------------------------------------------------------------------
// Standalone retrieve()
// ---------------------------------------------------------------------------

/**
 * The primary public function.
 *
 * Performs full site-local retrieval starting from `options.url` and
 * returns compact, source-backed evidence for the AI to interpret.
 */
export async function retrieve(options: RetrieveOptions): Promise<RetrieveResult> {
  return retrieveWithConfig(options, {}, sharedRateLimiter);
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

async function retrieveWithConfig(
  options: RetrieveOptions,
  config: RetrieverConfig,
  rateLimiter: RateLimiter,
): Promise<RetrieveResult> {
  const startedAt = Date.now();

  // Apply domain hint if the URL matches a registered shortcut.
  const startingUrl = resolveDomainHint(options.url, config.domainHints ?? {});

  // Build query plan first — drives all budget decisions.
  const plan = buildQueryPlan({ ...options, url: startingUrl });

  // Hard shared request budget — every HTTP operation must acquire a token
  // before any network I/O (Bug 2 fix).
  const budget = new RequestBudget(plan.maxInternalRequests);

  // Shared infrastructure for this session.
  const fetcher = new Fetcher(rateLimiter);
  const robots = new RobotsPolicy();
  const cache = options.cache ?? new MemoryCache();

  // Accumulated evidence and sources.
  const allEvidence: Evidence[] = [];
  const allSources: SourceResult[] = [];
  // All discovered URLs with metadata — used for repair and ranking.
  const discoveredUrls: DiscoveredUrl[] = [];
  const observedUrlSet = new Set<string>();

  let pagesFetched = 0;
  let documentsParsed = 0;
  let candidatesConsidered = 0;
  let candidatesDropped = 0;
  let budgetExhausted = false;

  // --- Step 1: Validate the starting URL ---
  let parsedStartUrl: URL;
  try {
    parsedStartUrl = new URL(startingUrl);
  } catch {
    return failResult(startingUrl, options.query, "INVALID_URL", "Cannot parse starting URL", plan.mode);
  }

  if (parsedStartUrl.protocol !== "http:" && parsedStartUrl.protocol !== "https:") {
    return failResult(startingUrl, options.query, "UNSAFE_SCHEME", "Only http/https is allowed", plan.mode);
  }

  if (!isSafePort(getPort(parsedStartUrl))) {
    return failResult(startingUrl, options.query, "UNSAFE_PORT", `Port not allowed: ${parsedStartUrl.port}`, plan.mode);
  }

  try {
    await assertSafeUrl(parsedStartUrl);
  } catch (e) {
    const err = e as RetrieveError;
    return failResult(startingUrl, options.query, err.code ?? "SSRF_BLOCKED", err.message, plan.mode);
  }

  // --- Step 2: Robots check for the starting URL ---
  if (options.respectRobots !== false) {
    const allowed = await robots.isAllowed(startingUrl, fetcher, budget);
    if (!allowed) {
      return {
        status: "blocked",
        query: options.query,
        startingUrl,
        sources: [],
        evidence: [],
        navigation: { resolved: false, method: "none", reason: "robots_blocked" },
        diagnostics: makeDiagnostics(budget.count, pagesFetched, documentsParsed, candidatesConsidered, candidatesDropped, startedAt, budgetExhausted, plan.mode),
      };
    }
  }

  // Register any crawl-delay from robots for this domain.
  const crawlDelay = await robots.getCrawlDelay(startingUrl, fetcher, budget);
  if (crawlDelay) {
    rateLimiter.setCrawlDelay(parsedStartUrl.hostname, crawlDelay);
  }

  // --- Step 3: Sitemap discovery ---
  // Sitemaps are discovered BEFORE fetching the starting URL so that if the
  // starting URL returns 404 we already have a corpus of real URLs to repair
  // against (Bug 1 fix).
  const origin = parsedStartUrl.origin;
  let sitemapEntries: SitemapEntry[] = [];

  if (options.followSitemaps !== false) {
    const robotsSitemaps = await robots.getSitemapUrls(origin, fetcher, budget);

    const sitemapResult = await discoverSitemaps(origin, robotsSitemaps, fetcher, budget);

    sitemapEntries = sitemapResult.entries;
    for (const entry of sitemapEntries) {
      observedUrlSet.add(entry.url);
      discoveredUrls.push({
        url: entry.url,
        source: "sitemap",
        lastmod: entry.lastmod,
        priority: entry.priority,
        depth: 1,
      });
    }
  }

  // --- Step 4: Fetch the starting resource ---
  let rootResponse: FetchResponse | null = null;
  if (!budget.tryConsume("page")) {
    budgetExhausted = true;
    return notFoundResult(startingUrl, options.query, discoveredUrls, sitemapEntries, plan.mode, makeDiagnostics(budget.count, pagesFetched, documentsParsed, candidatesConsidered, candidatesDropped, startedAt, budgetExhausted, plan.mode));
  }

  try {
    rootResponse = await fetchWithCache(startingUrl, fetcher, cache, options);
    pagesFetched++;
    observedUrlSet.add(rootResponse.url);
  } catch (e) {
    const err = e as RetrieveError;
    return failResult(startingUrl, options.query, err.code ?? "NETWORK_ERROR", err.message, plan.mode);
  }

  // --- Step 5: Handle 404 — attempt repair BEFORE giving up (Bug 1 fix) ---
  // We now have sitemap data (from Step 3) and can attempt URL repair
  // even when the starting URL itself returns 404.
  if (rootResponse.status === 404) {
    const repair = repairUrl({
      requestedUrl: startingUrl,
      observedUrls: discoveredUrls,
      sitemapEntries,
    });

    if (repair.navigation.resolved && repair.navigation.resolvedUrl) {
      // Repaired to a known-good URL — fetch that instead.
      const repairedUrl = repair.navigation.resolvedUrl;
      if (!budget.tryConsume("page")) {
        budgetExhausted = true;
        return {
          status: "not_found",
          query: options.query,
          startingUrl,
          sources: [],
          evidence: [],
          navigation: repair.navigation,
          diagnostics: makeDiagnostics(budget.count, pagesFetched, documentsParsed, candidatesConsidered, candidatesDropped, startedAt, budgetExhausted, plan.mode),
        };
      }

      try {
        rootResponse = await fetchWithCache(repairedUrl, fetcher, cache, options);
        pagesFetched++;
        observedUrlSet.add(rootResponse.url);
        if (rootResponse.status === 404) {
          // Even the repaired URL 404s — give up.
          return notFoundResult(startingUrl, options.query, discoveredUrls, sitemapEntries, plan.mode, makeDiagnostics(budget.count, pagesFetched, documentsParsed, candidatesConsidered, candidatesDropped, startedAt, budgetExhausted, plan.mode));
        }
      } catch {
        return notFoundResult(startingUrl, options.query, discoveredUrls, sitemapEntries, plan.mode, makeDiagnostics(budget.count, pagesFetched, documentsParsed, candidatesConsidered, candidatesDropped, startedAt, budgetExhausted, plan.mode));
      }
    } else {
      // No repair found.
      return notFoundResult(startingUrl, options.query, discoveredUrls, sitemapEntries, plan.mode, makeDiagnostics(budget.count, pagesFetched, documentsParsed, candidatesConsidered, candidatesDropped, startedAt, budgetExhausted, plan.mode));
    }
  }

  // --- Step 6: Detect content type and extract root document ---
  const rootMime = detectContentType(
    rootResponse.headers["content-type"] ?? "",
    rootResponse.body.slice(0, 512),
  );

  const rootExtraction = await extractDocument(rootResponse, rootMime, startingUrl, options, plan.query);
  documentsParsed++;

  // Handle SPA shell (§129.4).
  if (rootExtraction.requiresBrowser) {
    return {
      status: "js_required",
      query: options.query,
      startingUrl,
      sources: [],
      evidence: [],
      navigation: { resolved: true, method: "exact", resolvedUrl: rootResponse.url },
      diagnostics: makeDiagnostics(budget.count, pagesFetched, documentsParsed, candidatesConsidered, candidatesDropped, startedAt, budgetExhausted, plan.mode),
      shellMeta: rootExtraction.metadata,
    };
  }

  // Extract passages from the root document immediately.
  const rootPassages = extractPassages(rootExtraction.text, plan.query, rootResponse.url);
  for (const p of rootPassages) {
    allEvidence.push({ sourceUrl: rootResponse.url, text: p.text, section: p.section, relevance: p.relevance });
  }
  allSources.push(makeSource(rootResponse, rootMime, rootExtraction));

  // Collect links from the root page with anchor text for candidate scoring.
  const rootLinks: ExtractedLink[] = rootExtraction.extractedLinks ?? rootExtraction.links.map((url) => ({ url }));
  for (const link of rootLinks) {
    if (!observedUrlSet.has(link.url)) {
      observedUrlSet.add(link.url);
      discoveredUrls.push({
        url: link.url,
        source: "link",
        anchorText: link.anchorText,
        depth: 1,
      });
    }
  }

  // --- Step 7: Repair the starting URL (for navigation metadata) ---
  const serverCanonical = rootExtraction.metadata["canonical"];
  const repairResult = repairUrl({
    requestedUrl: startingUrl,
    observedUrls: discoveredUrls,
    sitemapEntries,
    ...(serverCanonical !== undefined ? { serverCanonical } : {}),
  });

  // --- Step 8: Score and rank candidate URLs ---
  const stopCheck = shouldStop(allEvidence, budget.count, plan);
  if (stopCheck.stop) {
    budgetExhausted = stopCheck.reason === "budget_exhausted";
  } else {
    // Build candidate set from sitemap entries + extracted links.
    // Exclude the root URL already fetched.
    const rootFinalUrl = rootResponse.url;
    const candidateSet = discoveredUrls.filter(
      (d) => d.url !== startingUrl && d.url !== rootFinalUrl,
    );
    candidatesConsidered = candidateSet.length;

    // Score each candidate URL using path tokens + anchor text + sitemap metadata.
    const scoredCandidates: Candidate[] = candidateSet.map((d) => {
      const scoreInput: import("../ranking/url-score.js").UrlScoreInput = {
        url: d.url,
        query: plan.query,
        baseUrl: startingUrl,
        ...(d.lastmod !== undefined ? { lastmod: d.lastmod } : {}),
        ...(d.priority !== undefined ? { priority: d.priority } : {}),
        ...(d.anchorText !== undefined ? { anchorText: d.anchorText } : {}),
      };
      const c: Candidate = {
        url: d.url,
        text: d.anchorText ?? d.url,
        score: scoreUrl(scoreInput),
      };
      if (d.lastmod !== undefined) c.lastmod = d.lastmod;
      return c;
    });

    // If a RankingOverride is provided, use it; otherwise keep URL scores.
    let rankedCandidates = scoredCandidates.sort((a, b) => b.score - a.score);
    if (options.rankingOverride) {
      rankedCandidates = await options.rankingOverride.rank(scoredCandidates, plan.query);
    }

    // --- Step 9: Fetch top candidates within budget ---
    const toFetch = rankedCandidates.slice(0, plan.maxPages - 1); // -1 because root already fetched
    candidatesDropped = rankedCandidates.length - toFetch.length;

    for (const candidate of toFetch) {
      const stopNow = shouldStop(allEvidence, budget.count, plan);
      if (stopNow.stop) {
        budgetExhausted = stopNow.reason === "budget_exhausted";
        break;
      }

      // Robots check for each candidate.
      if (options.respectRobots !== false) {
        const allowed = await robots.isAllowed(candidate.url, fetcher, budget);
        if (!allowed) continue;
      }

      if (!budget.tryConsume("page")) {
        budgetExhausted = true;
        break;
      }

      let candidateResponse: FetchResponse;
      try {
        candidateResponse = await fetchWithCache(candidate.url, fetcher, cache, options);
        pagesFetched++;
        observedUrlSet.add(candidateResponse.url);
      } catch {
        continue; // Skip failed candidates — they don't abort the whole retrieve.
      }

      if (candidateResponse.status !== 200) continue;

      const candidateMime = detectContentType(
        candidateResponse.headers["content-type"] ?? "",
        candidateResponse.body.slice(0, 512),
      );

      const extraction = await extractDocument(candidateResponse, candidateMime, candidate.url, options, plan.query);
      documentsParsed++;

      if (extraction.requiresBrowser) continue; // Can't extract — skip.

      const passages = extractPassages(extraction.text, plan.query, candidateResponse.url);
      for (const p of passages) {
        allEvidence.push({ sourceUrl: candidateResponse.url, text: p.text, section: p.section, relevance: p.relevance });
      }
      allSources.push(makeSource(candidateResponse, candidateMime, extraction));
    }
  }

  // --- Step 10: Final ranking, deduplication, diversity ---
  const dedupedEvidence = dedupePassages(allEvidence);
  const sortedEvidence = dedupedEvidence
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, DEFAULTS.maxEvidenceItems);
  const diverseEvidence = enforceSourceDiversity(sortedEvidence);

  // Populate source relevance from strongest passage (Bug 15 fix).
  populateSourceRelevance(allSources, diverseEvidence);

  // Determine overall status.
  const status: RetrieveStatus = diverseEvidence.length > 0 ? "success" : "not_found";

  return {
    status,
    query: options.query,
    startingUrl,
    sources: allSources,
    evidence: diverseEvidence,
    navigation: repairResult.navigation,
    diagnostics: makeDiagnostics(
      budget.count,
      pagesFetched,
      documentsParsed,
      candidatesConsidered,
      candidatesDropped,
      startedAt,
      budgetExhausted,
      plan.mode,
    ),
  };
}

// ---------------------------------------------------------------------------
// Extraction router — picks the right adapter for the MIME type
// ---------------------------------------------------------------------------

/**
 * Routes a fetched response to the appropriate content extractor.
 * Returns a standard ExtractionResult with an optional `extractedLinks`
 * extension field populated by the HTML extractor.
 */
async function extractDocument(
  response: FetchResponse,
  mime: string,
  pageUrl: string,
  options: RetrieveOptions,
  query: string,
): Promise<ExtractionResult & { extractedLinks?: ExtractedLink[] }> {
  const extractOptions = { query, mimeType: mime, maxPassageChars: DEFAULTS.maxPassageChars };

  // Check injected extractors first (highest priority — allows PDF override etc.).
  if (options.extractors) {
    for (const extractor of options.extractors) {
      if (extractor.mimeTypes.includes(mime)) {
        return extractor.extract(response, extractOptions);
      }
    }
  }

  if (mime === "application/pdf") {
    if (options.enablePdf) {
      // PDF has its own size budget enforced by the fetcher's maxPdfBytes.
      return extractPdf(response.body, pageUrl, extractOptions);
    }
    return { text: "", passages: [], links: [], metadata: {}, requiresOcr: false };
  }

  if (mime === "text/html") return extractHtml(response.body, pageUrl, extractOptions);
  if (mime === "application/json") return extractJson(response.body, pageUrl, extractOptions);
  if (mime === "text/markdown") return extractMarkdown(response.body, pageUrl, extractOptions);
  if (mime === "text/plain") return extractText(response.body, pageUrl, extractOptions);

  // XML-family types.
  if (
    mime === "application/xml" ||
    mime === "text/xml" ||
    mime === "application/rss+xml" ||
    mime === "application/atom+xml"
  ) {
    return extractXml(response.body, pageUrl, extractOptions);
  }

  // Unknown type — return empty (status "unsupported" surfaced by caller).
  return { text: "", passages: [], links: [], metadata: {} };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWithCache(
  url: string,
  fetcher: Fetcher,
  cache: import("./types.js").CacheProvider,
  options: RetrieveOptions,
): Promise<FetchResponse> {
  const cacheKey = normaliseUrl(url) ?? url;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const fetcherOpts: import("../fetch/fetcher.js").FetcherOptions = {};
  if (options.timeoutMs !== undefined) fetcherOpts.timeoutMs = options.timeoutMs;

  // Apply the correct size limit based on what we might be fetching.
  // We use the larger PDF limit as the binary cap so PDFs aren't cut off
  // by the HTML limit before content-type is known (Bug 8 partial fix).
  // The stricter per-type limit is applied after detection.
  const htmlLimit = options.maxResponseBytes ?? DEFAULTS.maxResponseBytes;
  const pdfLimit = options.enablePdf ? (options.maxPdfBytes ?? DEFAULTS.maxPdfBytes) : htmlLimit;
  fetcherOpts.maxResponseBytes = Math.max(htmlLimit, pdfLimit);

  const response = await fetcher.fetch(url, fetcherOpts);

  // If the fetched content is HTML/text (not a PDF), enforce the tighter HTML limit.
  if (response.body.byteLength > htmlLimit) {
    const mime = detectContentType(
      response.headers["content-type"] ?? "",
      response.body.slice(0, 512),
    );
    const isPdf = mime === "application/pdf";
    if (!isPdf) {
      // Truncate to the HTML limit — the content is not a PDF.
      const truncated = response.body.slice(0, htmlLimit);
      return { ...response, body: truncated };
    }
  }

  // Cache successful 200 responses for the duration of the session.
  if (response.status === 200) {
    await cache.set(cacheKey, response, 300);
  }

  return response;
}

function makeSource(
  response: FetchResponse,
  mime: string,
  extraction: ExtractionResult,
): SourceResult {
  return {
    url: response.url,
    title: extraction.title,
    type: mime,
    relevance: 0, // updated by populateSourceRelevance() after passage ranking
    httpStatus: response.status,
  };
}

function makeDiagnostics(
  httpRequests: number,
  pagesFetched: number,
  documentsParsed: number,
  candidatesConsidered: number,
  candidatesDropped: number,
  startedAt: number,
  budgetExhausted: boolean,
  mode: "fast" | "balanced" | "deep",
): RetrievalDiagnostics {
  return {
    httpRequests,
    pagesFetched,
    documentsParsed,
    candidatesConsidered,
    candidatesDropped,
    durationMs: Date.now() - startedAt,
    budgetExhausted,
    mode,
  };
}

function failResult(
  startingUrl: string,
  query: string,
  _code: string,
  message: string,
  mode: "fast" | "balanced" | "deep",
): RetrieveResult {
  return {
    status: "failed",
    query,
    startingUrl,
    sources: [],
    evidence: [],
    navigation: { resolved: false, method: "none", reason: message },
    diagnostics: makeDiagnostics(0, 0, 0, 0, 0, Date.now(), false, mode),
  };
}

function notFoundResult(
  startingUrl: string,
  query: string,
  discoveredUrls: DiscoveredUrl[],
  sitemapEntries: SitemapEntry[],
  mode: "fast" | "balanced" | "deep",
  diagnostics: RetrievalDiagnostics,
): RetrieveResult {
  // Best-effort repair using whatever we've already discovered.
  const repair = repairUrl({
    requestedUrl: startingUrl,
    observedUrls: discoveredUrls,
    sitemapEntries,
  });

  return {
    status: "not_found",
    query,
    startingUrl,
    sources: [],
    evidence: [],
    navigation: repair.navigation,
    diagnostics,
  };
}

function resolveDomainHint(url: string, hints: Record<string, string>): string {
  // If the "URL" is just a short keyword (no protocol, no dot), check hints.
  if (!url.includes(".") && !url.startsWith("http")) {
    const lower = url.toLowerCase().trim();
    if (hints[lower]) return hints[lower];
  }
  return url;
}

/**
 * core/defaults.ts
 *
 * All default values for RetrieveOptions in one place so they are easy to
 * audit, test, and change without hunting through business logic.
 *
 * These numbers come from §36 of the spec ("Recommended default budgets").
 */

export const DEFAULTS = {
  // crawl budget
  maxPages: 6,
  // NOTE: maxDepth is intentionally absent from public options until depth-first
  // traversal is actually implemented.  Declaring it in the interface without
  // the implementation would be misleading (see Bug 3).
  maxInternalRequests: 8,
  maxConcurrentRequests: 3,
  maxRedirects: 5,

  // per-request sizes
  // These are the defaults adopters will want to tune first.
  // - maxResponseBytes: maximum bytes for HTML / text / JSON / XML responses.
  //   Increase if you fetch large single-page docs; decrease on low-memory hosts.
  // - maxPdfBytes: maximum bytes for PDFs when enablePdf=true.
  //   15 MiB is generous for text PDFs; reduce on bandwidth-limited hosts.
  maxResponseBytes: 2 * 1024 * 1024, // 2 MiB for HTML/text
  maxPdfBytes: 15 * 1024 * 1024,     // 15 MiB for PDF

  // timeouts
  timeoutMs: 8_000,            // 8 s total per request
  connectionTimeoutMs: 3_000,  // 3 s to establish TCP

  // policy
  respectRobots: true,
  followSitemaps: true,
  followFeeds: true,
  followSameOriginLinks: true,

  // retrieval
  mode: "balanced" as const,

  // evidence
  maxPassagesPerSource: 5,
  maxPassageChars: 1_200,
  // Number of top evidence items returned to the AI.
  // Adopters on token-sensitive plans may want to lower this to 5–6.
  maxEvidenceItems: 10,

  // robots cache duration (per session — not persisted unless host injects a cache)
  robotsCacheTtlMs: 5 * 60 * 1_000, // 5 minutes

  // sitemap limits — tune these when crawling extremely large sites.
  // maxSitemapChildEntries: how many child sitemaps from a sitemap index to fetch.
  maxSitemapChildEntries: 5,
  // maxSitemapTotalEntries: hard cap on total sitemap URL entries loaded into memory.
  maxSitemapTotalEntries: 10_000,
} as const;

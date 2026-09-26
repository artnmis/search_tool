/**
 * core/types.ts
 *
 * Every public-facing TypeScript type lives here so that the rest of the
 * codebase has a single, stable place to import from.  This file has zero
 * runtime logic — it is type definitions only.
 *
 * Stability: these types are semver-stable as of v1. A breaking change to
 * any interface here is a major version bump.
 */

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** An HTTPS or HTTP URL that has passed SSRF / scheme validation. */
export type SafeUrl = string & { readonly __brand: "SafeUrl" };

/** ISO-8601 date-time string (may be date-only from sitemaps). */
export type IsoDateString = string;

// ---------------------------------------------------------------------------
// Plugin interfaces — defined in §129.6, required for the add-on ecosystem
// ---------------------------------------------------------------------------

/** Options forwarded to the underlying fetch call. */
export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** How many redirects to follow before giving up. */
  maxRedirects?: number;
}

/** The raw HTTP response before any parsing. */
export interface FetchResponse {
  url: SafeUrl; // final URL after redirects
  status: number;
  headers: Record<string, string>;
  /** Resolved body bytes — never exceeds maxResponseBytes. */
  body: Uint8Array;
  /** Content-Type header value, stripped of parameters. */
  mimeType: string;
  durationMs: number;
}

/**
 * FetchOverride — replace or augment the HTTP fetch layer.
 *
 * Use case: the browser adapter registers itself here so the core pipeline
 * calls it transparently when `enableBrowser` is true.
 *
 * Implementors must still honour SSRF rules — the core validates the URL
 * before calling this.
 */
export interface FetchOverride {
  fetch(url: SafeUrl, options: FetchOptions): Promise<FetchResponse>;
}

/** Options passed to a content extractor. */
export interface ExtractOptions {
  query: string;
  mimeType: string;
  /** Maximum characters to return per passage. */
  maxPassageChars?: number;
}

/** A single passage of text extracted from a document. */
export interface Passage {
  text: string;
  /** Where inside the document this came from (section heading, page number, …). */
  section?: string | undefined;
  /** 0–1 relevance score relative to the query. */
  relevance: number;
  /** Byte offset inside the source document, when available. */
  byteOffset?: number | undefined;
}

/** The result produced by a ContentExtractor for one document. */
export interface ExtractionResult {
  /** Plain-text content of the document. */
  text: string;
  title?: string | undefined;
  passages: Passage[];
  links: string[];
  metadata: Record<string, string>;
  /** True when the document was an image-only / scanned PDF with no text layer. */
  requiresOcr?: boolean | undefined;
  /** True when the page is a JS-only SPA shell with no server-rendered content. */
  requiresBrowser?: boolean | undefined;
}

/**
 * ContentExtractor — register an extractor for one or more MIME types.
 *
 * The core ships built-in extractors for HTML, JSON, XML, plain-text, and
 * Markdown.  The optional `web-retriever-pdf` package registers itself via
 * this interface.
 */
export interface ContentExtractor {
  mimeTypes: string[];
  extract(response: FetchResponse, options: ExtractOptions): Promise<ExtractionResult>;
}

/**
 * DiscoveryProvider — supply candidate URLs from an external source.
 *
 * The core does not use this by default.  Optional packages such as
 * `web-retriever-searxng` implement it and are passed at init time.
 */
export interface DiscoveryResult {
  url: string;
  title?: string;
  snippet?: string;
}

export interface DiscoveryOptions {
  maxResults?: number;
  language?: string;
}

export interface DiscoveryProvider {
  search(query: string, options?: DiscoveryOptions): Promise<DiscoveryResult[]>;
}

/**
 * RankingOverride — replace the default BM25 ranker.
 *
 * Use case: an embedding-based reranker for applications that want it.
 * The default BM25 path requires no external model.
 */
export interface Candidate {
  url: string;
  title?: string;
  /** Text used for ranking (page text or URL tokens). */
  text: string;
  /** Freshness hint from sitemap lastmod. */
  lastmod?: IsoDateString;
  /** BM25 or override score after ranking. */
  score: number;
}

export interface RankingOverride {
  rank(candidates: Candidate[], query: string): Promise<Candidate[]>;
}

/**
 * CacheProvider — host-injected persistent cache.
 *
 * The core uses a session-scoped in-memory cache by default.
 * A host application may inject a Redis/file-backed provider here.
 */
export interface CacheProvider {
  get(key: string): Promise<FetchResponse | undefined>;
  set(key: string, value: FetchResponse, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * IndexProvider — optional persistent site-local URL index.
 *
 * Phase 5 feature.  Not required for core retrieval.
 */
export interface IndexProvider {
  add(urls: string[]): Promise<void>;
  query(terms: string[]): Promise<string[]>;
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Main input options
// ---------------------------------------------------------------------------

/**
 * RetrieveOptions — the complete configuration for a single retrieve() call.
 *
 * Only `url` and `query` are required.  Everything else has a sensible
 * default defined in core/defaults.ts.
 */
export interface RetrieveOptions {
  /** Starting URL.  The retriever begins here and may follow links/sitemaps. */
  url: string;
  /** Natural-language retrieval objective used for scoring and ranking. */
  query: string;

  // --- crawl budget ---
  /** Maximum number of pages fetched (default: 6). */
  maxPages?: number;
  /**
   * Maximum total internal HTTP requests, including robots/sitemaps (default: 8).
   *
   * This is a hard limit enforced by a shared RequestBudget — no network
   * operation can start unless a token is available.  Tune this when your
   * hosting environment has strict outbound rate limits.
   */
  maxInternalRequests?: number;

  // --- per-request limits ---
  /** Per-request timeout in milliseconds (default: 8 000). */
  timeoutMs?: number;
  /** Maximum HTML/text response bytes (default: 2 MiB). */
  maxResponseBytes?: number;
  /** Maximum PDF response bytes when PDF is enabled (default: 15 MiB). */
  maxPdfBytes?: number;

  // --- policy flags ---
  /** Honour robots.txt directives (default: true). */
  respectRobots?: boolean;
  /** Follow sitemap URLs for candidate discovery (default: true). */
  followSitemaps?: boolean;
  /** Follow RSS/Atom feeds for candidate discovery (default: true). */
  followFeeds?: boolean;
  /** Follow same-origin HTML links (default: true). */
  followSameOriginLinks?: boolean;

  // --- domain policy ---
  /** Explicit allow-list of domains the retriever may fetch from. */
  allowDomains?: string[];
  /** Explicit deny-list of domains the retriever must not fetch from. */
  denyDomains?: string[];

  // --- optional format support ---
  /** Enable PDF text extraction via the bundled unpdf adapter (default: false). */
  enablePdf?: boolean;
  /** Enable OCR via an injected OcrProvider (default: false). */
  enableOcr?: boolean;
  /**
   * Enable browser-rendered fetching via an injected FetchOverride.
   * Requires web-retriever-browser to be installed separately.
   * Not compatible with Vercel Free / serverless (§129.3).
   */
  enableBrowser?: boolean;

  // --- retrieval mode ---
  /**
   * Controls how aggressively the retriever searches before returning.
   * - "fast"     : fetch the root page + top sitemap candidate only
   * - "balanced" : default; try up to maxPages candidates
   * - "deep"     : exhaust the full request budget before stopping
   */
  mode?: "fast" | "balanced" | "deep";

  // --- plugin injection ---
  /** Host-provided cache; falls back to in-process memory cache. */
  cache?: CacheProvider;
  /** Optional persistent site-local index. */
  index?: IndexProvider;
  /** Replace or augment the HTTP fetch layer (e.g. browser adapter). */
  fetchOverride?: FetchOverride;
  /** Add-on content extractors (e.g. PDF, DOCX). */
  extractors?: ContentExtractor[];
  /** Replace the default BM25 ranker. */
  rankingOverride?: RankingOverride;
  /** Optional external URL discovery source (e.g. SearXNG adapter). */
  discoveryProvider?: DiscoveryProvider;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Status codes for the top-level RetrieveResult. */
export type RetrieveStatus =
  | "success" // evidence found
  | "partial" // some evidence found but budget was exhausted or some fetches failed
  | "not_found" // URL resolved but no relevant evidence
  | "blocked" // robots.txt or domain policy blocked retrieval
  | "unsupported" // content type has no adapter and no override
  | "js_required" // SPA shell with no extractable static data (§129.4)
  | "failed"; // unrecoverable error (network, SSRF, etc.)

/** A single fetched source document. */
export interface SourceResult {
  url: string;
  /** Effective title extracted from the document. */
  title?: string | undefined;
  /** Detected MIME type. */
  type: string;
  /** 0–1 overall relevance score for this source relative to the query. */
  relevance: number;
  /** HTTP status code. */
  httpStatus?: number | undefined;
  /** lastmod from sitemap, if available. */
  lastmod?: IsoDateString | undefined;
}

/** A ranked evidence passage returned to the AI. */
export interface Evidence {
  /** The URL this passage came from — always an observed URL, never fabricated. */
  sourceUrl: string;
  /** The extracted text. */
  text: string;
  /** Section heading or page number context. */
  section?: string | undefined;
  /** 0–1 relevance score. */
  relevance: number;
}

/** Summary of how the starting URL was resolved. */
export interface NavigationResult {
  /**
   * Whether the starting URL was resolved to a real fetched page.
   * False when the URL was hallucinated and could not be repaired.
   */
  resolved: boolean;
  /**
   * How the URL was resolved:
   * - "exact"          : started URL matched directly
   * - "canonical"      : resolved via canonical URL
   * - "redirect"       : followed HTTP redirect
   * - "sitemap_match"  : matched an observed sitemap entry
   * - "link_match"     : matched an observed HTML link
   * - "path_similarity": closest observed path above the repair threshold
   * - "none"           : could not be resolved
   */
  method:
    | "exact"
    | "canonical"
    | "redirect"
    | "sitemap_match"
    | "link_match"
    | "path_similarity"
    | "none";
  /** The final resolved URL, if different from the starting URL. */
  resolvedUrl?: string;
  /** Human-readable reason when resolved is false. */
  reason?: string;
}

/** Per-call performance and diagnostic counters. */
export interface RetrievalDiagnostics {
  httpRequests: number;
  pagesFetched: number;
  documentsParsed: number;
  candidatesConsidered: number;
  candidatesDropped: number;
  durationMs: number;
  /** True when the retriever stopped due to budget exhaustion rather than evidence sufficiency. */
  budgetExhausted: boolean;
  /** Retrieval mode that was active. */
  mode: "fast" | "balanced" | "deep";
}

/** The complete result returned by retrieve(). */
export interface RetrieveResult {
  status: RetrieveStatus;
  query: string;
  startingUrl: string;
  sources: SourceResult[];
  evidence: Evidence[];
  navigation: NavigationResult;
  diagnostics: RetrievalDiagnostics;
  /**
   * Present when status is "js_required" — metadata that was extractable
   * from the SPA shell (title, canonical, Open Graph) even without JS execution.
   */
  shellMeta?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Error taxonomy  (§84)
// ---------------------------------------------------------------------------

/** Machine-readable error codes for every failure mode. */
export type RetrieveErrorCode =
  // URL / security
  | "INVALID_URL"
  | "UNSAFE_SCHEME"
  | "SSRF_BLOCKED"
  | "UNSAFE_PORT"
  | "DNS_REBIND"
  | "REDIRECT_LOOP"
  | "TOO_MANY_REDIRECTS"
  // policy
  | "ROBOTS_BLOCKED"
  | "DOMAIN_DENIED"
  // network
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "COMPRESSION_BOMB"
  // content
  | "UNSUPPORTED_CONTENT_TYPE"
  | "PARSE_ERROR"
  | "JS_REQUIRED"
  | "SCANNED_PDF"
  // budget
  | "BUDGET_EXHAUSTED"
  // unknown
  | "UNKNOWN";

export interface RetrieveError {
  code: RetrieveErrorCode;
  message: string;
  url?: string;
  cause?: unknown;
}

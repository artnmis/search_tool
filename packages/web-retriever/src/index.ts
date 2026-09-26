/**
 * index.ts — public package exports
 *
 * This is the only file consumers should import from when using the default
 * entry point.  AI SDK integrations are available as separate sub-exports
 * (e.g. "web-retriever/openai") to keep the core bundle lean.
 *
 * §9.5 of the implementation task list and §2.5 (AI-provider agnostic) of
 * the spec: the core package must NOT pull in any AI SDK.
 */

// --- Primary API ---
export { retrieve, createRetriever } from "./core/retrieve.js";
export type { RetrieverConfig } from "./core/retrieve.js";

// --- Public types ---
export type {
  // Input
  RetrieveOptions,
  // Output
  RetrieveResult,
  RetrieveStatus,
  Evidence,
  SourceResult,
  NavigationResult,
  RetrievalDiagnostics,
  // Plugin interfaces (semver-stable as of v1)
  FetchOverride,
  FetchOptions,
  FetchResponse,
  ContentExtractor,
  ExtractOptions,
  ExtractionResult,
  Passage,
  DiscoveryProvider,
  DiscoveryOptions,
  DiscoveryResult,
  RankingOverride,
  Candidate,
  CacheProvider,
  IndexProvider,
  // Errors
  RetrieveError,
  RetrieveErrorCode,
} from "./core/types.js";

// --- Cache ---
export { MemoryCache } from "./cache/memory.js";

// --- Request budget (for advanced host integrations) ---
export { RequestBudget } from "./fetch/budget.js";
export type { BudgetConsumer } from "./fetch/budget.js";

// --- URL resolution ---
export type { DiscoveredUrl } from "./resolution/url-repair.js";

// --- Error classes ---
export {
  RetrieverError,
  InvalidUrlError,
  SsrfBlockedError,
  RobotsBlockedError,
  NetworkError,
  TimeoutError,
  ResponseTooLargeError,
  CompressionBombError,
  UnsupportedContentTypeError,
} from "./diagnostics/errors.js";

// --- Logger (opt-in) ---
export { setLogLevel } from "./diagnostics/logger.js";
export type { LogLevel } from "./diagnostics/logger.js";

// --- Defaults (useful for host applications tuning budgets) ---
export { DEFAULTS } from "./core/defaults.js";

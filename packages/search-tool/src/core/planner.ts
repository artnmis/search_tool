/**
 * core/planner.ts
 *
 * Query planner — decides how to search and when to stop.
 *
 * §28 (query planning without AI), §29 (query expansion without AI),
 * §93 (retrieval modes), and §114 (stopping criteria) of the spec.
 *
 * The planner does three things without any LLM call:
 *
 *   1. Token expansion: split the query into terms + lightweight synonyms
 *      so the BM25 scorer can find documents that use different phrasing.
 *
 *   2. Mode selection: infer "fast" / "balanced" / "deep" from query signals
 *      (length, question words, "latest" / "recent" keywords, etc.).
 *
 *   3. Stopping criteria: decide after each fetch whether we have enough
 *      evidence to stop or should keep going.
 */

import { tokenize } from "../ranking/tokenizer.js";
import type { RetrieveOptions, Evidence } from "./types.js";
import { DEFAULTS } from "./defaults.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryPlan {
  /** Original query. */
  query: string;
  /** Expanded set of search tokens (includes synonyms and stemmed forms). */
  expandedTokens: string[];
  /** Resolved retrieval mode. */
  mode: "fast" | "balanced" | "deep";
  /** Maximum pages to fetch under this plan. */
  maxPages: number;
  /** Maximum total HTTP requests under this plan. */
  maxInternalRequests: number;
}

// ---------------------------------------------------------------------------
// Lightweight synonym table
// These are common technical-documentation synonyms only — not a thesaurus.
// ---------------------------------------------------------------------------
const SYNONYMS: Record<string, string[]> = {
  auth: ["authentication", "authorisation", "authorization", "login", "oauth"],
  authentication: ["auth", "login", "oauth", "sso"],
  api: ["endpoint", "rest", "graphql", "interface"],
  error: ["exception", "failure", "bug", "issue", "problem"],
  config: ["configuration", "setup", "settings", "options"],
  install: ["installation", "setup", "getting started"],
  deploy: ["deployment", "release", "publish", "ship"],
  performance: ["speed", "latency", "throughput", "benchmark"],
  security: ["auth", "permission", "access", "role", "policy"],
  database: ["db", "storage", "sql", "postgres", "mysql", "sqlite"],
  latest: ["recent", "new", "current", "updated", "version"],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a QueryPlan from the user's retrieve options.
 *
 * This is always called before any network I/O.
 */
export function buildQueryPlan(options: RetrieveOptions): QueryPlan {
  const query = options.query;
  const baseTokens = tokenize(query);
  const expandedTokens = expandTokens(baseTokens);

  const mode = options.mode ?? inferMode(query);
  const { maxPages, maxInternalRequests } = resolveBudget(mode, options);

  return { query, expandedTokens, mode, maxPages, maxInternalRequests };
}

/**
 * Decides whether the retriever should stop after the current fetch.
 *
 * Returns true (stop) when:
 *   - Enough high-quality evidence has been found for the mode.
 *   - The request budget is exhausted.
 */
export function shouldStop(
  evidence: Evidence[],
  requestsUsed: number,
  plan: QueryPlan,
): { stop: boolean; reason: "evidence_sufficient" | "budget_exhausted" | "continue" } {
  if (requestsUsed >= plan.maxInternalRequests) {
    return { stop: true, reason: "budget_exhausted" };
  }

  const highQualityEvidence = evidence.filter((e) => e.relevance >= 0.6);

  const thresholds: Record<QueryPlan["mode"], number> = {
    fast: 1,      // 1 good passage is enough for fast mode
    balanced: 3,  // 3 good passages for balanced
    deep: 8,      // 8 good passages for deep
  };

  if (highQualityEvidence.length >= thresholds[plan.mode]) {
    return { stop: true, reason: "evidence_sufficient" };
  }

  return { stop: false, reason: "continue" };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function expandTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);

  for (const token of tokens) {
    const synonyms = SYNONYMS[token];
    if (synonyms) {
      for (const syn of synonyms) {
        // Add tokenised synonyms (in case they are multi-word).
        for (const t of tokenize(syn)) {
          expanded.add(t);
        }
      }
    }
  }

  return [...expanded];
}

/**
 * Infers the retrieval mode from query characteristics.
 *
 * "fast"     — very short queries, or queries for a single specific fact.
 * "deep"     — queries with "all", "every", "complete", "comprehensive",
 *              "latest", or long multi-clause questions.
 * "balanced" — everything else.
 */
function inferMode(query: string): "fast" | "balanced" | "deep" {
  const q = query.toLowerCase();
  const words = q.split(/\s+/);

  const deepSignals = ["all", "every", "complete", "comprehensive", "latest",
                       "recent", "full", "entire", "list all", "list every"];
  const fastSignals = words.length <= 4; // very short queries

  if (deepSignals.some((s) => q.includes(s))) return "deep";
  if (fastSignals) return "fast";
  return "balanced";
}

function resolveBudget(
  mode: "fast" | "balanced" | "deep",
  options: RetrieveOptions,
): { maxPages: number; maxInternalRequests: number } {
  const budgets: Record<string, { maxPages: number; maxInternalRequests: number }> = {
    fast:     { maxPages: 2,                       maxInternalRequests: 4 },
    balanced: { maxPages: DEFAULTS.maxPages,        maxInternalRequests: DEFAULTS.maxInternalRequests },
    deep:     { maxPages: DEFAULTS.maxPages * 2,    maxInternalRequests: DEFAULTS.maxInternalRequests * 2 },
  };

  const base = budgets[mode]!;

  return {
    maxPages: options.maxPages ?? base.maxPages,
    maxInternalRequests: options.maxInternalRequests ?? base.maxInternalRequests,
  };
}

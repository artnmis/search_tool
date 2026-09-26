/**
 * robots/policy.ts
 *
 * Robots policy enforcement — answers "is this URL allowed for our agent?"
 *
 * §52 of the spec.
 *
 * The policy is evaluated per-origin and cached for the duration of a
 * retrieve() session.  A host-injected CacheProvider can persist it longer.
 *
 * RFC 9309 §2.3.1 status semantics:
 *   - 2xx         : parse and obey
 *   - 4xx / 410   : treat as empty robots.txt — all paths allowed
 *   - 5xx / timeout / network error : treat as unreachable — all paths DISALLOWED
 *     (conservative: the server is having trouble; assume it wants no crawling)
 */

import { parseRobots, type ParsedRobots, type RobotsRule } from "./parser.js";
import type { Fetcher } from "../fetch/fetcher.js";
import type { RequestBudget } from "../fetch/budget.js";
import { USER_AGENT } from "../fetch/headers.js";

// ---------------------------------------------------------------------------
// Policy class
// ---------------------------------------------------------------------------

/**
 * RobotsPolicy fetches, parses, and caches robots.txt for each origin,
 * then answers "is this path allowed?" for the configured user-agent.
 */
export class RobotsPolicy {
  /** Cache: origin → { parsed result, fetched-at timestamp }. */
  private readonly cache = new Map<string, { parsed: ParsedRobots | "disallow_all"; fetchedAt: number }>();

  /**
   * @param agentName  The user-agent token to match against robots groups.
   *                   Defaults to the retriever's own token ("SearchTool").
   * @param cacheTtlMs How long to cache a robots.txt result (ms).
   */
  constructor(
    private readonly agentName: string = extractAgentToken(USER_AGENT),
    private readonly cacheTtlMs: number = 5 * 60 * 1_000,
  ) {}

  /**
   * Fetches (or returns cached) robots.txt for the given origin, then
   * returns whether the given path is allowed.
   *
   * RFC 9309 §2.3.1:
   *   - 4xx → unavailable → allow (treat as no restrictions)
   *   - 5xx / network error → unreachable → DISALLOW (conservative)
   */
  async isAllowed(url: string, fetcher: Fetcher, budget?: RequestBudget): Promise<boolean> {
    const parsed = await this.getParsedRobots(url, fetcher, budget);
    if (parsed === "disallow_all") return false; // 5xx / network error
    if (parsed === null) return true; // 4xx — no restrictions

    const urlObj = new URL(url);
    return this.evaluate(urlObj.pathname + urlObj.search, parsed);
  }

  /**
   * Returns the crawl-delay (seconds) declared in robots.txt for this
   * origin and agent, or undefined if not present.
   */
  async getCrawlDelay(origin: string, fetcher: Fetcher, budget?: RequestBudget): Promise<number | undefined> {
    const parsed = await this.getParsedRobots(origin, fetcher, budget);
    if (!parsed || parsed === "disallow_all") return undefined;
    const group = this.matchGroup(parsed);
    return group?.crawlDelay;
  }

  /**
   * Returns the sitemap URLs declared in robots.txt for this origin,
   * or an empty array if the file is unavailable.
   */
  async getSitemapUrls(origin: string, fetcher: Fetcher, budget?: RequestBudget): Promise<string[]> {
    const parsed = await this.getParsedRobots(origin, fetcher, budget);
    if (!parsed || parsed === "disallow_all") return [];
    return parsed.sitemaps ?? [];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getParsedRobots(
    urlOrOrigin: string,
    fetcher: Fetcher,
    budget?: RequestBudget,
  ): Promise<ParsedRobots | "disallow_all" | null> {
    const origin = new URL(urlOrOrigin).origin;
    const cached = this.cache.get(origin);

    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.parsed === "disallow_all" ? "disallow_all" : cached.parsed;
    }

    // Consume a budget token for the robots.txt fetch.
    // If budget is exhausted, be conservative: disallow.
    if (budget && !budget.tryConsume("robots")) {
      return "disallow_all";
    }

    const robotsUrl = `${origin}/robots.txt`;
    let text: string;
    let status: number;
    try {
      const response = await fetcher.fetch(robotsUrl, { timeoutMs: 5_000, maxResponseBytes: 512 * 1024 });
      status = response.status;

      if (status >= 200 && status < 300) {
        text = new TextDecoder().decode(response.body);
      } else if (status >= 400 && status < 600) {
        // 4xx: unavailable → allow (null means "no restrictions")
        // 5xx: unreachable → disallow_all
        const result = status >= 500 ? ("disallow_all" as const) : null;
        this.cache.set(origin, { parsed: result ?? ("disallow_all" as const), fetchedAt: Date.now() });
        return result;
      } else {
        return null;
      }
    } catch {
      // Network error / timeout → unreachable → conservative disallow.
      this.cache.set(origin, { parsed: "disallow_all", fetchedAt: Date.now() });
      return "disallow_all";
    }

    const parsed = parseRobots(text);
    this.cache.set(origin, { parsed, fetchedAt: Date.now() });
    return parsed;
  }

  /**
   * Evaluates Allow/Disallow rules for a given path.
   *
   * Rule precedence (RFC 9309 §2.2.2):
   *   - The most specific matching rule wins.
   *   - Specificity = length of the pattern.
   *   - When patterns are equal length, Allow wins over Disallow.
   *
   * Falls back to checking the wildcard (*) group when no specific agent
   * group is found.
   */
  private evaluate(path: string, parsed: ParsedRobots): boolean {
    const group = this.matchGroup(parsed);
    if (!group) return true; // no matching group → allow

    let best: { rule: RobotsRule; specificity: number } | null = null;

    for (const rule of group.rules) {
      if (!matchesPattern(path, rule.pattern)) continue;
      const specificity = rule.pattern.length;
      if (best === null || specificity > best.specificity) {
        best = { rule, specificity };
      } else if (specificity === best.specificity && rule.allow && !best.rule.allow) {
        // Same length: Allow beats Disallow.
        best = { rule, specificity };
      }
    }

    // Empty Disallow ("Disallow:") means allow everything.
    if (best === null) return true;
    if (best.rule.pattern === "") return true;
    return best.rule.allow;
  }

  /** Finds the most specific matching agent group, preferring exact match over wildcard. */
  private matchGroup(parsed: ParsedRobots) {
    // First look for an exact agent name match.
    const exact = parsed.groups.find((g) =>
      g.agents.some((a) => a === this.agentName.toLowerCase()),
    );
    if (exact) return exact;

    // Fall back to the wildcard (*) group.
    return parsed.groups.find((g) => g.agents.includes("*")) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Pattern matching helpers
// ---------------------------------------------------------------------------

/**
 * Tests whether a URL path matches a robots.txt path pattern.
 *
 * Supported wildcards (per Google's extended robots.txt spec):
 *   *  → matches any sequence of characters
 *   $  → anchors to end of string
 */
function matchesPattern(path: string, pattern: string): boolean {
  if (pattern === "") return true; // empty pattern = allow everything

  // Convert the robots pattern to a RegExp.
  const segments = pattern.split("*");
  const reStr =
    "^" +
    segments.map(escapeRegex).join(".*") +
    (pattern.endsWith("$") ? "$" : "");

  return new RegExp(reStr).test(path);
}

function escapeRegex(s: string): string {
  // Escape all regex special chars except $ (handled above).
  return s.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\$$/, "");
}

/**
 * Extracts the first token from a User-Agent string for robots matching.
 * "SearchTool/0.0.1 (+...)" → "searchtool"
 */
function extractAgentToken(userAgent: string): string {
  return (userAgent.split("/")[0] ?? userAgent).toLowerCase();
}

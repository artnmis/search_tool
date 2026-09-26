/**
 * robots/parser.ts
 *
 * robots.txt parser.
 *
 * §52 of the spec requires honouring Allow, Disallow, Crawl-delay, and
 * Sitemap directives.  We implement a permissive-by-default parser: any
 * rule we cannot parse is ignored rather than blocking the entire crawl.
 *
 * The robots.txt protocol is documented at:
 *   https://www.rfc-editor.org/rfc/rfc9309
 *   https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
 */

export interface RobotsRule {
  /** Path pattern from Allow or Disallow directive. */
  pattern: string;
  /** True = Allow, false = Disallow. */
  allow: boolean;
}

export interface RobotsGroup {
  /** User-agent strings this group applies to (lower-cased). */
  agents: string[];
  rules: RobotsRule[];
  /** Crawl-delay value in seconds, if present. */
  crawlDelay?: number | undefined;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  /** Sitemap URLs declared in the file. */
  sitemaps: string[];
}

/**
 * Parses the text content of a robots.txt file.
 *
 * Handles:
 *   - multiple User-agent groups
 *   - Allow / Disallow path patterns including wildcards (* and $)
 *   - Crawl-delay
 *   - Sitemap directives
 *   - blank lines as group separators
 *   - comments (#)
 *   - case-insensitive directive names
 */
export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  // Active state while scanning groups
  let currentAgents: string[] = [];
  let currentRules: RobotsRule[] = [];
  let currentCrawlDelay: number | undefined;
  let inGroup = false;

  function flushGroup() {
    if (currentAgents.length > 0) {
      groups.push({
        agents: currentAgents,
        rules: currentRules,
        crawlDelay: currentCrawlDelay,
      });
    }
    currentAgents = [];
    currentRules = [];
    currentCrawlDelay = undefined;
    inGroup = false;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    // Strip inline comments and trim whitespace.
    const line = rawLine.replace(/#.*$/, "").trim();

    // Blank line ends the current group.
    if (line === "") {
      if (inGroup) flushGroup();
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue; // malformed line — skip

    const key = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (key === "user-agent") {
      if (inGroup && currentRules.length > 0) {
        // A new User-agent after rules means a new group.
        flushGroup();
      }
      inGroup = true;
      currentAgents.push(value.toLowerCase());
    } else if (key === "disallow") {
      currentRules.push({ pattern: value, allow: false });
    } else if (key === "allow") {
      currentRules.push({ pattern: value, allow: true });
    } else if (key === "crawl-delay") {
      const d = parseFloat(value);
      if (!isNaN(d)) currentCrawlDelay = d;
    } else if (key === "sitemap") {
      if (value) sitemaps.push(value);
    }
    // All other directives (e.g. host:, request-rate:) are intentionally ignored.
  }

  // Flush any trailing group.
  flushGroup();

  return { groups, sitemaps };
}

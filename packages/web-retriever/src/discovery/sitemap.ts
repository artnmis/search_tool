/**
 * discovery/sitemap.ts
 *
 * Sitemap discovery and parsing.
 *
 * §10 Phase C and §11 of the spec.
 *
 * Sitemap handling is a first-class feature — sitemaps are a free,
 * site-provided URL index.  We treat them as the primary candidate source
 * before falling back to link extraction.
 *
 * Supported formats:
 *   - Standard XML sitemap (<urlset>)
 *   - Sitemap index (<sitemapindex>) — fetched lazily, not fully materialised
 *   - Plain-text URL list (one URL per line)
 *   - RSS/Atom (routed via the XML adapter)
 *
 * §11 key constraint: for sites with huge sitemaps (200k+ URLs), we parse
 * the URL list, score locally, and ONLY fetch the top candidates.  We do
 * not materialise the full sitemap into memory when only a few URLs are needed.
 */

import { parseDocument, DomUtils } from "htmlparser2";
import type { Element } from "domhandler";
import type { Fetcher } from "../fetch/fetcher.js";
import type { RequestBudget } from "../fetch/budget.js";
import type { SitemapEntry } from "../resolution/sitemap-resolver.js";

// ---------------------------------------------------------------------------
// Well-known sitemap paths tried when robots.txt has no Sitemap directive
// ---------------------------------------------------------------------------
const WELL_KNOWN_PATHS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/sitemap/sitemap.xml",
] as const;

// Max child sitemaps to fetch from a sitemap index before stopping.
const MAX_CHILD_SITEMAPS = 5;
// Max URL entries to collect across all sitemaps for this session.
const MAX_TOTAL_ENTRIES = 10_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SitemapDiscoveryResult {
  entries: SitemapEntry[];
  /** Sitemap URLs that were successfully fetched. */
  fetchedSitemapUrls: string[];
}

/**
 * Discovers and parses sitemaps for a site.
 *
 * @param origin        The origin of the site (e.g. "https://example.com").
 * @param robotsSitemaps Sitemap URLs found in robots.txt (may be empty).
 * @param fetcher       The shared fetcher instance.
 * @param budget        Shared request budget — sitemap fetches consume tokens.
 */
export async function discoverSitemaps(
  origin: string,
  robotsSitemaps: string[],
  fetcher: Fetcher,
  budget?: RequestBudget,
): Promise<SitemapDiscoveryResult> {
  const entries: SitemapEntry[] = [];
  const fetchedUrls: string[] = [];
  const tried = new Set<string>();

  // Try robots.txt sitemap directives first, then fall back to well-known paths.
  const candidates = robotsSitemaps.length > 0
    ? robotsSitemaps
    : WELL_KNOWN_PATHS.map((p) => `${origin}${p}`);

  for (const url of candidates) {
    if (tried.has(url)) continue;
    tried.add(url);

    // Each sitemap fetch consumes a budget token.
    if (budget && !budget.tryConsume("sitemap")) break;

    const result = await fetchSitemap(url, fetcher, tried, 0, budget);
    if (result) {
      entries.push(...result.entries);
      fetchedUrls.push(...result.fetchedSitemapUrls);
    }

    if (entries.length >= MAX_TOTAL_ENTRIES) break;
  }

  return { entries: entries.slice(0, MAX_TOTAL_ENTRIES), fetchedSitemapUrls: fetchedUrls };
}

// ---------------------------------------------------------------------------
// Internal fetcher
// ---------------------------------------------------------------------------

async function fetchSitemap(
  url: string,
  fetcher: Fetcher,
  tried: Set<string>,
  depth: number,
  budget?: RequestBudget,
): Promise<SitemapDiscoveryResult | null> {
  // Limit recursion depth for nested sitemap indexes.
  if (depth > 2) return null;

  let response: Awaited<ReturnType<Fetcher["fetch"]>>;
  try {
    response = await fetcher.fetch(url, {
      timeoutMs: 10_000,
      maxResponseBytes: 10 * 1024 * 1024, // 10 MiB cap for sitemaps
      extraHeaders: { Accept: "application/xml,text/xml,text/plain,*/*" },
    });
  } catch {
    return null;
  }

  if (response.status !== 200) return null;

  const body = new TextDecoder().decode(response.body);
  const mime = response.mimeType;

  // Plain-text sitemap (one URL per line).
  if (mime === "text/plain") {
    return parsePlainTextSitemap(body, url);
  }

  // XML-based sitemaps.
  return parseXmlSitemap(body, url, fetcher, tried, depth, budget);
}

// ---------------------------------------------------------------------------
// XML sitemap parser
// ---------------------------------------------------------------------------

async function parseXmlSitemap(
  xml: string,
  baseUrl: string,
  fetcher: Fetcher,
  tried: Set<string>,
  depth: number,
  budget?: RequestBudget,
): Promise<SitemapDiscoveryResult> {
  const dom = parseDocument(xml, { xmlMode: true });

  // Detect sitemap index.
  const isSitemapIndex = DomUtils.findOne(
    (n) => n.type === "tag" && (n as Element).name === "sitemapindex",
    dom.children,
  ) !== null;

  if (isSitemapIndex) {
    return processSitemapIndex(dom, fetcher, tried, depth, budget);
  }

  // Standard urlset.
  return processUrlset(dom, baseUrl);
}

function processUrlset(dom: ReturnType<typeof parseDocument>, _baseUrl: string): SitemapDiscoveryResult {
  const urlEls = DomUtils.findAll(
    (n) => n.type === "tag" && (n as Element).name === "url",
    dom.children,
  );

  const entries: SitemapEntry[] = [];

  for (const urlEl of urlEls) {
    const el = urlEl as Element;
    const loc = childText(el, "loc");
    if (!loc || !loc.startsWith("http")) continue;

    entries.push({
      url: loc,
      lastmod: childText(el, "lastmod"),
      changefreq: childText(el, "changefreq"),
      priority: parseFloat(childText(el, "priority") ?? "NaN") || undefined,
    });
  }

  return { entries, fetchedSitemapUrls: [] };
}

async function processSitemapIndex(
  dom: ReturnType<typeof parseDocument>,
  fetcher: Fetcher,
  tried: Set<string>,
  depth: number,
  budget?: RequestBudget,
): Promise<SitemapDiscoveryResult> {
  const sitemapEls = DomUtils.findAll(
    (n) => n.type === "tag" && (n as Element).name === "sitemap",
    dom.children,
  );

  const allEntries: SitemapEntry[] = [];
  const fetchedUrls: string[] = [];
  let childCount = 0;

  for (const sitemapEl of sitemapEls) {
    if (childCount >= MAX_CHILD_SITEMAPS) break;
    if (allEntries.length >= MAX_TOTAL_ENTRIES) break;

    const loc = childText(sitemapEl as Element, "loc");
    if (!loc || tried.has(loc)) continue;

    tried.add(loc);
    childCount++;

    if (budget && !budget.tryConsume("sitemap")) break;

    const result = await fetchSitemap(loc, fetcher, tried, depth + 1, budget);
    if (result) {
      allEntries.push(...result.entries);
      fetchedUrls.push(loc, ...result.fetchedSitemapUrls);
    }
  }

  return { entries: allEntries, fetchedSitemapUrls: fetchedUrls };
}

// ---------------------------------------------------------------------------
// Plain-text sitemap parser
// ---------------------------------------------------------------------------

function parsePlainTextSitemap(text: string, _baseUrl: string): SitemapDiscoveryResult {
  const entries: SitemapEntry[] = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http"))
    .map((url) => ({ url }));

  return { entries, fetchedSitemapUrls: [] };
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

function childText(el: Element, tagName: string): string | undefined {
  const found = DomUtils.findOne(
    (n) => n.type === "tag" && (n as Element).name?.toLowerCase() === tagName,
    el.children,
  ) as Element | null;
  return found ? DomUtils.getText(found).trim() || undefined : undefined;
}

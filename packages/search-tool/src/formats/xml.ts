/**
 * formats/xml.ts
 *
 * Generic XML parser and RSS/Atom feed router.
 *
 * §14 (XML adapter) and §99 (feeds as freshness layer) of the spec.
 *
 * What this adapter does:
 *   1. Parses XML with htmlparser2 in XML mode (strict, no tag auto-closing).
 *   2. Detects RSS 2.0 or Atom 1.0 by root element and routes to the feed
 *      extractor.
 *   3. For generic XML, serialises all text content in document order.
 *   4. Extracts all <a href> and xmlns-qualified link elements as discovered URLs.
 */

import { parseDocument, DomUtils } from "htmlparser2";
import type { Document, Element } from "domhandler";
import type { ExtractionResult, ExtractOptions } from "../core/types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractXml(
  body: Uint8Array | string,
  pageUrl: string,
  _options: ExtractOptions,
): ExtractionResult {
  const text = typeof body === "string" ? body : new TextDecoder().decode(body);

  let dom: Document;
  try {
    dom = parseDocument(text, { xmlMode: true, decodeEntities: true });
  } catch {
    return emptyResult();
  }

  // Route to the appropriate extractor based on root element.
  const rootTag = getRootTagName(dom);

  if (rootTag === "rss") return extractRss(dom, pageUrl);
  if (rootTag === "feed") return extractAtom(dom, pageUrl);

  // Generic XML — extract all text content.
  return extractGenericXml(dom, pageUrl);
}

// ---------------------------------------------------------------------------
// RSS 2.0
// ---------------------------------------------------------------------------

function extractRss(dom: Document, _pageUrl: string): ExtractionResult {
  const items = DomUtils.findAll((n) => n.type === "tag" && (n as Element).name === "item", dom.children);

  const lines: string[] = [];
  const links: string[] = [];

  for (const item of items) {
    const title = firstChildText(item as Element, "title");
    const link = firstChildText(item as Element, "link");
    const description = firstChildText(item as Element, "description");
    const pubDate = firstChildText(item as Element, "pubdate") ??
                    firstChildText(item as Element, "pubDate");

    if (title) lines.push(`# ${title}`);
    if (pubDate) lines.push(`Published: ${pubDate}`);
    if (description) lines.push(stripHtmlTags(description));
    if (link) links.push(link.trim());
    lines.push("");
  }

  return {
    text: lines.join("\n").trim(),
    title: firstChildTextDeep(dom, "title"),
    passages: [],
    links,
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Atom 1.0
// ---------------------------------------------------------------------------

function extractAtom(dom: Document, _pageUrl: string): ExtractionResult {
  const entries = DomUtils.findAll((n) => n.type === "tag" && (n as Element).name === "entry", dom.children);

  const lines: string[] = [];
  const links: string[] = [];

  for (const entry of entries) {
    const el = entry as Element;
    const title = firstChildText(el, "title");
    const updated = firstChildText(el, "updated");
    const summary = firstChildText(el, "summary") ?? firstChildText(el, "content");

    // Atom uses <link href="..."> rather than text content.
    const linkEl = DomUtils.findOne(
      (n) => n.type === "tag" && (n as Element).name === "link",
      el.children,
    ) as Element | null;
    const href = linkEl?.attribs["href"];

    if (title) lines.push(`# ${title}`);
    if (updated) lines.push(`Updated: ${updated}`);
    if (summary) lines.push(stripHtmlTags(summary));
    if (href) links.push(href);
    lines.push("");
  }

  return {
    text: lines.join("\n").trim(),
    title: firstChildTextDeep(dom, "title"),
    passages: [],
    links,
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Generic XML
// ---------------------------------------------------------------------------

function extractGenericXml(dom: Document, _pageUrl: string): ExtractionResult {
  // Collect all text nodes, preserving context via parent element name.
  const parts: string[] = [];
  const links: string[] = [];

  function walk(nodes: typeof dom.children) {
    for (const node of nodes) {
      if (node.type === "text") {
        const t = node.data.trim();
        if (t) parts.push(t);
      }
      if (node.type === "tag") {
        const el = node as Element;
        // Collect href-style attributes as links.
        const href = el.attribs["href"] ?? el.attribs["url"] ?? el.attribs["loc"];
        if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
          links.push(href);
        }
        walk(el.children);
      }
    }
  }

  walk(dom.children);

  return {
    text: parts.join(" "),
    passages: [],
    links: [...new Set(links)],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRootTagName(dom: Document): string | null {
  for (const node of dom.children) {
    if (node.type === "tag") return (node as Element).name?.toLowerCase() ?? null;
  }
  return null;
}

function firstChildText(el: Element, tagName: string): string | undefined {
  const found = DomUtils.findOne(
    (n) => n.type === "tag" && (n as Element).name?.toLowerCase() === tagName.toLowerCase(),
    el.children,
  ) as Element | null;
  return found ? DomUtils.getText(found).trim() || undefined : undefined;
}

function firstChildTextDeep(dom: Document, tagName: string): string | undefined {
  const found = DomUtils.findOne(
    (n) => n.type === "tag" && (n as Element).name?.toLowerCase() === tagName.toLowerCase(),
    dom.children,
  ) as Element | null;
  return found ? DomUtils.getText(found).trim() || undefined : undefined;
}

/** Strips HTML/XML tags from a string (for RSS description fields that embed HTML). */
function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function emptyResult(): ExtractionResult {
  return { text: "", passages: [], links: [], metadata: {} };
}

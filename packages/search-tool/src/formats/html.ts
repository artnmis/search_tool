/**
 * formats/html.ts
 *
 * HTML/XHTML content adapter.
 *
 * §15 of the spec.
 *
 * Extraction strategy:
 *
 *   1. Structural extractor (primary) — walks the DOM collecting headings,
 *      paragraphs, lists, and table text.  Always available, never throws.
 *
 *   2. Mozilla Readability (enhancement) — attempts to clean article-style
 *      content.  Used ONLY when it returns text longer than the structural
 *      extractor's result, and only via a proper DOM shim.
 *      NOTE: Readability requires a real DOM-like object.  We build a minimal
 *      shim here.  If it throws for any reason the structural extractor result
 *      is used instead — Readability is never load-bearing.
 *
 *   3. Application data (§16) — embedded JSON state from Next.js / Nuxt / etc.
 *      is flattened to text and appended so it is searchable by BM25.
 *
 * We also extract:
 *   - <title>, <meta description>, Open Graph, Twitter Card (§24)
 *   - <link rel="canonical">  (§103)
 *   - same-origin links with anchor text (§25, Bug 10 fix)
 *   - feed discovery links    (§10 Phase D)
 *   - JSON-LD and embedded app state   (§16, §98)
 *
 * §129.4: When a page is a pure SPA shell (no useful text, no server-rendered
 * data, no embedded JSON state), we emit requiresBrowser=true so the
 * orchestrator can return a JS_REQUIRED signal.
 */

import { parseDocument, DomUtils } from "htmlparser2";
import type { Document, Element, Node } from "domhandler";
import { Readability } from "@mozilla/readability";
import type { ExtractionResult, ExtractOptions } from "../core/types.js";
import { resolveUrl, isSameOrigin } from "../resolution/canonical.js";
import { extractApplicationData } from "../discovery/application-data.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A link extracted from a page, preserving anchor text for ranking. */
export interface ExtractedLink {
  url: string;
  /** Text content of the <a> element — invaluable for candidate scoring. */
  anchorText?: string | undefined;
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------

/**
 * Extracts content from an HTML document.
 *
 * @param html     Raw HTML bytes or string.
 * @param pageUrl  The final URL of the page (used to resolve relative links).
 * @param options  Extraction configuration.
 */
export function extractHtml(
  html: Uint8Array | string,
  pageUrl: string,
  options: ExtractOptions,
): ExtractionResult & { extractedLinks: ExtractedLink[] } {
  const text = typeof html === "string" ? html : new TextDecoder().decode(html);
  const dom = parseDocument(text, { decodeEntities: true });

  const metadata = extractMetadata(dom, pageUrl);
  const extractedLinks = extractLinksWithAnchorText(dom, pageUrl);
  const links = extractedLinks.map((l) => l.url);

  // --- Application state extraction (§16) ---
  // Next.js / Nuxt / generic embedded JSON — parsed from script tags.
  const appData = extractApplicationData(html);
  const appDataText = flattenAppData(appData.blobs);

  // --- Primary: structural extractor (always runs, never throws) ---
  const structuralText = structuralExtract(dom);

  // --- Enhancement: Readability for article-style content ---
  // Readability is optional — if it fails or returns less, we keep structural.
  let mainText = structuralText;
  try {
    const readable = runReadability(text, pageUrl);
    if (readable && readable.textContent.trim().length > structuralText.length + 100) {
      // Only prefer Readability when it finds substantially more content.
      mainText = readable.textContent.trim();
    }
  } catch {
    // Readability threw — structural result is the baseline, continue normally.
  }

  // Append embedded application data so it is searchable.
  if (appDataText) {
    mainText = mainText ? `${mainText}\n\n${appDataText}` : appDataText;
  }

  // SPA shell detection: very little text AND no embedded data AND no useful meta.
  const isSpaShell =
    mainText.trim().length < 100 &&
    Object.keys(appData.blobs).length === 0 &&
    !metadata["og:title"] &&
    !metadata["description"];

  return {
    text: mainText,
    title: metadata["title"],
    passages: [], // passages are built by the passage extractor in extraction/passages.ts
    links,
    metadata,
    requiresBrowser: isSpaShell,
    requiresOcr: false,
    extractedLinks,
  };
}

// ---------------------------------------------------------------------------
// Metadata extraction  (§24)
// ---------------------------------------------------------------------------

function extractMetadata(dom: Document, pageUrl: string): Record<string, string> {
  const meta: Record<string, string> = {};

  for (const node of DomUtils.findAll((n) => n.type === "tag", dom.children)) {
    const el = node as Element;
    const tag = el.name?.toLowerCase();

    if (tag === "title" && !meta["title"]) {
      meta["title"] = DomUtils.getText(el).trim();
    }

    if (tag === "meta") {
      const name = (el.attribs["name"] ?? el.attribs["property"] ?? "").toLowerCase();
      const content = el.attribs["content"] ?? "";

      if (name && content) {
        // Only keep first occurrence to avoid duplicates.
        if (!meta[name]) meta[name] = content;
      }
    }

    if (tag === "link") {
      const rel = (el.attribs["rel"] ?? "").toLowerCase();
      const href = el.attribs["href"];

      if (rel === "canonical" && href) {
        meta["canonical"] = resolveUrl(href, pageUrl) ?? href;
      }
      // Feed links captured in link extraction below.
    }
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Link extraction with anchor text  (§25, Bug 10)
// ---------------------------------------------------------------------------

/**
 * Extracts same-origin links from the DOM, preserving the anchor text of
 * each link.  Anchor text is a strong relevance signal — particularly on
 * sites with opaque URLs (e.g. /chapter/37 where the text reads
 * "Electromagnetic Induction").
 */
function extractLinksWithAnchorText(dom: Document, pageUrl: string): ExtractedLink[] {
  const seen = new Set<string>();
  const results: ExtractedLink[] = [];

  for (const node of DomUtils.findAll((n) => n.type === "tag" && (n as Element).name === "a", dom.children)) {
    const el = node as Element;
    const href = el.attribs["href"];
    if (!href || href.startsWith("#")) continue;

    const resolved = resolveUrl(href, pageUrl);
    if (!resolved) continue;
    if (!isSameOrigin(resolved, pageUrl)) continue;
    if (seen.has(resolved)) continue;

    seen.add(resolved);
    const anchorText = DomUtils.getText(el).trim().replace(/\s+/g, " ") || undefined;
    results.push({ url: resolved, anchorText });
  }

  // Also collect feed <link> tags (no anchor text — they are <link> not <a>).
  for (const node of DomUtils.findAll((n) => n.type === "tag" && (n as Element).name === "link", dom.children)) {
    const el = node as Element;
    const rel = (el.attribs["rel"] ?? "").toLowerCase();
    const type = (el.attribs["type"] ?? "").toLowerCase();
    const href = el.attribs["href"];

    const isFeed =
      rel === "alternate" &&
      (type === "application/rss+xml" || type === "application/atom+xml");

    if (isFeed && href) {
      const resolved = resolveUrl(href, pageUrl);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        results.push({ url: resolved });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Application data flattening  (§16)
// ---------------------------------------------------------------------------

/**
 * Converts embedded application state blobs to searchable plain text.
 *
 * We flatten the JSON structure depth-first, collecting string leaf values.
 * This turns structured data like { "title": "...", "content": "..." } into
 * prose-like text that BM25 can rank.  We cap the output to avoid flooding
 * the passage extractor with unrelated data.
 */
function flattenAppData(blobs: Record<string, unknown>): string {
  const parts: string[] = [];

  function collect(value: unknown, depth: number): void {
    if (depth > 6) return; // avoid infinite recursion on deeply nested objects
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 10 && trimmed.length < 2000) {
        parts.push(trimmed);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item, depth + 1);
    } else if (value !== null && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) {
        collect(v, depth + 1);
      }
    }
  }

  for (const blob of Object.values(blobs)) {
    collect(blob, 0);
    if (parts.join("\n").length > 8000) break; // cap at ~8 KB of app-state text
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Readability wrapper
// ---------------------------------------------------------------------------

/**
 * Attempts to extract article-style content using Mozilla Readability.
 *
 * Readability expects a DOM-like document object.  We provide a minimal shim
 * that satisfies the subset of the DOM interface it actually uses.
 * If anything throws, the caller falls back to structuralExtract().
 *
 * The shim is intentionally minimal — we don't add a heavy DOM library like
 * JSDOM (Rule 3: no large core dependencies).  Readability is an optional
 * enhancement, not load-bearing infrastructure.
 */
function runReadability(html: string, url: string): { textContent: string } | null {
  const doc = createReadabilityDocument(html, url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = new Readability(doc as any);
  return reader.parse();
}

/**
 * Builds a minimal DOM-like shim from an htmlparser2 document.
 *
 * Readability primarily uses:
 *   - documentURI / baseURI  (for link resolution)
 *   - getElementsByTagName()
 *   - querySelector() / querySelectorAll()
 *   - element.textContent
 *   - element.innerHTML
 *   - element.cloneNode()
 *   - element.getAttribute()
 *
 * We implement these on top of the DomUtils / htmlparser2 objects.
 * This is enough for Readability to work on most article pages.
 * For pages where it fails, the structural extractor is the fallback.
 */
function createReadabilityDocument(html: string, url: string): object {
  const dom = parseDocument(html, { decodeEntities: true });

  function wrapElement(el: Element): object {
    return {
      tagName: el.name?.toUpperCase() ?? "",
      nodeName: el.name?.toUpperCase() ?? "",
      nodeType: 1,
      get textContent(): string {
        return DomUtils.getText(el);
      },
      get innerHTML(): string {
        // Approximate innerHTML — good enough for Readability's scoring.
        return DomUtils.getInnerHTML(el);
      },
      getAttribute(name: string): string | null {
        return el.attribs[name] ?? null;
      },
      cloneNode(): object {
        return wrapElement(el);
      },
      get children(): object[] {
        return (el.children ?? [])
          .filter((c) => c.type === "tag")
          .map((c) => wrapElement(c as Element));
      },
      get childNodes(): object[] {
        return (el.children ?? [])
          .filter((c) => c.type === "tag")
          .map((c) => wrapElement(c as Element));
      },
      get parentNode(): object | null {
        const p = el.parent;
        return p && p.type === "tag" ? wrapElement(p as Element) : null;
      },
      style: {} as Record<string, string>,
      appendChild(child: object): object { return child; },
      removeChild(_child: object): void {},
      setAttribute(_name: string, _value: string): void {},
    };
  }

  function findAll(tagName: string): object[] {
    return DomUtils.findAll(
      (n) => n.type === "tag" && (n as Element).name?.toLowerCase() === tagName.toLowerCase(),
      dom.children,
    ).map((el) => wrapElement(el as Element));
  }

  // We need a plain object that satisfies Readability's DOM expectations.
  // TypeScript sees the interface mismatch but this is intentional — we
  // provide only the subset Readability actually calls.
  const docShim = {
    documentURI: url,
    baseURI: url,
    nodeType: 9,
    nodeName: "#document",
    get body(): object | null {
      const bodyEls = DomUtils.findAll(
        (n) => n.type === "tag" && (n as Element).name === "body",
        dom.children,
      );
      return bodyEls[0] ? wrapElement(bodyEls[0] as Element) : null;
    },
    get head(): object | null {
      const headEls = DomUtils.findAll(
        (n) => n.type === "tag" && (n as Element).name === "head",
        dom.children,
      );
      return headEls[0] ? wrapElement(headEls[0] as Element) : null;
    },
    get documentElement(): object {
      const htmlEls = DomUtils.findAll(
        (n) => n.type === "tag" && (n as Element).name === "html",
        dom.children,
      );
      const el = htmlEls[0] as Element | undefined;
      return el ? wrapElement(el) : wrapElement({ name: "html", children: dom.children, attribs: {}, type: "tag" } as unknown as Element);
    },
    getElementsByTagName(tagName: string): object[] {
      return findAll(tagName);
    },
    querySelector(selector: string): object | null {
      // Very minimal: only supports tag-name and #id selectors.
      const idMatch = selector.match(/^#(.+)$/);
      if (idMatch) {
        const id = idMatch[1]!;
        const found = DomUtils.findOne(
          (n) => n.type === "tag" && (n as Element).attribs["id"] === id,
          dom.children,
        );
        return found ? wrapElement(found as Element) : null;
      }
      const results = findAll(selector.replace(/[^a-zA-Z0-9-]/g, ""));
      return results[0] ?? null;
    },
    querySelectorAll(selector: string): object[] {
      const tagPart = selector.replace(/[^a-zA-Z0-9-]/g, "");
      return findAll(tagPart);
    },
    createElementNS(_ns: string, tagName: string): object {
      return {
        tagName: tagName.toUpperCase(),
        nodeName: tagName.toUpperCase(),
        nodeType: 1,
        textContent: "",
        innerHTML: "",
        getAttribute: () => null,
        setAttribute: () => {},
        cloneNode: function() { return this; },
        children: [],
        childNodes: [],
        parentNode: null,
        style: {},
        get outerHTML() { return ""; },
        appendChild: function(child: object) { return child; },
        removeChild: () => {},
      };
    },
    createElement(tagName: string): object {
      return docShim.createElementNS("", tagName);
    },
    createTextNode(text: string): object {
      return {
        nodeType: 3,
        nodeName: "#text",
        textContent: text,
        data: text,
        parentNode: null,
      };
    },
    get children(): object[] {
      return DomUtils.findAll((n) => n.type === "tag", dom.children)
        .slice(0, 1)
        .map((el) => wrapElement(el as Element));
    },
    childNodes: [],
  };
  return docShim;
}

// ---------------------------------------------------------------------------
// Structural fallback extractor (§15 "non-article HTML")
// ---------------------------------------------------------------------------

/**
 * Extracts readable text from a non-article page (tables, reference docs,
 * structured directories) without relying on Readability.
 *
 * Walks the DOM collecting heading, paragraph, list-item, and table-cell text
 * in document order.
 */
function structuralExtract(dom: Document): string {
  const BLOCK_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "dt", "dd", "blockquote", "caption"]);
  const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "head"]);

  const parts: string[] = [];

  function walk(node: Node) {
    if (node.type === "tag") {
      const el = node as Element;
      const tag = el.name?.toLowerCase() ?? "";
      if (SKIP_TAGS.has(tag)) return;
      if (BLOCK_TAGS.has(tag)) {
        const t = DomUtils.getText(el).trim().replace(/\s+/g, " ");
        if (t) parts.push(t);
        return;
      }
    }
    if ("children" in node) {
      for (const child of (node as { children: Node[] }).children) {
        walk(child);
      }
    }
  }

  walk(dom);
  return parts.join("\n");
}

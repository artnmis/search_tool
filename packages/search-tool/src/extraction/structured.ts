/**
 * extraction/structured.ts
 *
 * Structured page extraction for non-article content.
 *
 * §15 of the spec (Important section) — pages that are not prose articles
 * (reference docs, directories, exam/question platforms, pricing pages) need
 * a different extractor than Readability.  This module handles them.
 *
 * Strategy: walk the DOM collecting headings, definition lists, and
 * key-value pairs in document order, producing a linearised text
 * representation that preserves structural context.
 */

import { parseDocument, DomUtils } from "htmlparser2";
import type { Element } from "domhandler";

export interface StructuredExtraction {
  /** Linearised text output. */
  text: string;
  /** Top-level section headings found. */
  sections: string[];
}

/**
 * Extracts content from a structured (non-article) HTML page.
 *
 * @param html  Raw HTML string or bytes.
 */
export function extractStructured(html: Uint8Array | string): StructuredExtraction {
  const text = typeof html === "string" ? html : new TextDecoder().decode(html);
  const dom = parseDocument(text);

  const parts: string[] = [];
  const sections: string[] = [];
  const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "head", "nav", "footer"]);
  const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
  const BLOCK_TAGS = new Set(["p", "li", "td", "th", "dt", "dd", "blockquote", "figcaption", "caption"]);

  function walk(nodes: ReturnType<typeof parseDocument>["children"]) {
    for (const node of nodes) {
      if (node.type !== "tag") continue;
      const el = node as Element;
      const tag = (el.name ?? "").toLowerCase();

      if (SKIP_TAGS.has(tag)) continue;

      if (HEADING_TAGS.has(tag)) {
        const headingText = DomUtils.getText(el).trim().replace(/\s+/g, " ");
        if (headingText) {
          // Mark headings prominently for passage section detection.
          parts.push(`\n## ${headingText}`);
          if (tag === "h1" || tag === "h2") sections.push(headingText);
        }
        continue;
      }

      if (BLOCK_TAGS.has(tag)) {
        const t = DomUtils.getText(el).trim().replace(/\s+/g, " ");
        if (t) parts.push(t);
        continue;
      }

      // Definition lists: <dt> term → <dd> definition
      if (tag === "dl") {
        walkDefinitionList(el, parts);
        continue;
      }

      // Recurse into containers.
      walk(el.children);
    }
  }

  walk(dom.children);

  return {
    text: parts.join("\n"),
    sections,
  };
}

function walkDefinitionList(dlEl: Element, parts: string[]): void {
  let currentTerm = "";
  for (const child of dlEl.children) {
    if (child.type !== "tag") continue;
    const el = child as Element;
    const tag = (el.name ?? "").toLowerCase();
    const t = DomUtils.getText(el).trim().replace(/\s+/g, " ");

    if (tag === "dt") {
      currentTerm = t;
    } else if (tag === "dd" && currentTerm) {
      parts.push(`${currentTerm}: ${t}`);
    }
  }
}

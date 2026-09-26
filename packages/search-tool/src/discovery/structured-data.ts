/**
 * discovery/structured-data.ts
 *
 * Structured data extraction — JSON-LD, microdata, RDFa.
 *
 * §98 of the spec.
 *
 * JSON-LD is the most common and most useful format.  We extract it from
 * <script type="application/ld+json"> tags and return the raw objects so
 * the passage extractor can include them as evidence.
 *
 * Microdata and RDFa extraction is basic — we collect itemprop/property
 * attribute values as key→value pairs.
 */

import { parseDocument, DomUtils } from "htmlparser2";
import type { Element } from "domhandler";

export interface StructuredDataResult {
  /** Raw parsed JSON-LD objects (may be @graph arrays). */
  jsonLd: unknown[];
  /** Microdata/RDFa key→value pairs. */
  microdata: Record<string, string>;
}

/**
 * Extracts structured data from raw HTML.
 *
 * @param html     Raw HTML string or bytes.
 */
export function extractStructuredData(html: Uint8Array | string): StructuredDataResult {
  const text = typeof html === "string" ? html : new TextDecoder().decode(html);
  const dom = parseDocument(text);

  const jsonLd: unknown[] = [];
  const microdata: Record<string, string> = {};

  for (const node of DomUtils.findAll((n) => n.type === "tag", dom.children)) {
    const el = node as Element;

    // JSON-LD blocks
    if (
      el.name === "script" &&
      (el.attribs["type"] ?? "").toLowerCase() === "application/ld+json"
    ) {
      const content = DomUtils.getText(el).trim();
      if (content) {
        try {
          const parsed = JSON.parse(content);
          // @graph arrays contain multiple entities — flatten them.
          if (parsed && typeof parsed === "object" && "@graph" in (parsed as object)) {
            const graph = (parsed as Record<string, unknown>)["@graph"];
            if (Array.isArray(graph)) {
              jsonLd.push(...graph);
            }
          } else {
            jsonLd.push(parsed);
          }
        } catch {
          // Malformed JSON-LD — skip silently (§59, parser hardening).
        }
      }
    }

    // Microdata: itemprop attributes
    const itemprop = el.attribs["itemprop"];
    if (itemprop) {
      const value =
        el.attribs["content"] ??
        el.attribs["href"] ??
        el.attribs["src"] ??
        DomUtils.getText(el).trim();
      if (value && !microdata[itemprop]) {
        microdata[itemprop] = value;
      }
    }

    // RDFa: property attributes (e.g. property="schema:name")
    const property = el.attribs["property"];
    if (property) {
      const value =
        el.attribs["content"] ??
        el.attribs["href"] ??
        DomUtils.getText(el).trim();
      if (value && !microdata[property]) {
        microdata[property] = value;
      }
    }
  }

  return { jsonLd, microdata };
}

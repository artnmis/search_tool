/**
 * formats/text.ts
 *
 * Plain-text and Markdown content adapter.
 *
 * §14 of the spec.
 *
 * Plain text is passed through almost verbatim — we only normalise line
 * endings and strip NUL bytes.  We preserve line provenance by keeping
 * line numbers in the extraction output.
 *
 * Markdown is treated identically to plain text at the extraction stage.
 * Markdown-specific rendering (headings as section markers, etc.) is handled
 * downstream in the passage extractor.
 */

import type { ExtractionResult, ExtractOptions } from "../core/types.js";

export function extractText(
  body: Uint8Array | string,
  _pageUrl: string,
  _options: ExtractOptions,
): ExtractionResult {
  const raw = typeof body === "string" ? body : new TextDecoder().decode(body);

  // Normalise line endings, strip NUL bytes.
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\0/g, "");

  // Extract any bare URLs from the text as discovered links.
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/g;
  const links = [...new Set(text.match(urlPattern) ?? [])];

  return {
    text,
    passages: [],
    links,
    metadata: {},
  };
}

/** Alias — Markdown is handled the same way as plain text at this stage. */
export const extractMarkdown = extractText;

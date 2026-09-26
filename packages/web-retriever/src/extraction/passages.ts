/**
 * extraction/passages.ts
 *
 * Passage extraction — slices a document's text into scored passages and
 * returns the top-k most relevant ones.
 *
 * §32 of the spec.
 *
 * Algorithm:
 *   1. Split the document text into candidate windows (overlapping sentences
 *      or fixed-size character chunks).
 *   2. Score each window with BM25 against the query.
 *   3. Return the top-k non-overlapping windows above a minimum score.
 *
 * Each returned passage carries:
 *   - the text content
 *   - a section label (nearest heading, or "[Page N]" for PDFs)
 *   - a relevance score in [0, 1]
 *   - a byte offset (approximate)
 */

import { BM25Index } from "../ranking/bm25.js";
import type { Passage } from "../core/types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Approximate character width of each passage window. */
const WINDOW_CHARS = 800;
/** Overlap between adjacent windows (helps avoid splitting a key sentence). */
const OVERLAP_CHARS = 150;
/** Maximum passages to return per document. */
const MAX_PASSAGES = 8;
/** Minimum BM25 score required to include a passage. */
const MIN_SCORE = 0.05;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts and scores passages from a document.
 *
 * @param text      Full document text (plain text or Markdown).
 * @param query     The retrieval query.
 * @param sourceUrl Source URL for provenance tracking.
 */
export function extractPassages(text: string, query: string, sourceUrl: string): Passage[] {
  if (!text.trim()) return [];

  const windows = buildWindows(text);
  if (windows.length === 0) return [];

  // Build a BM25 index over the windows.
  const docs = windows.map((w, i) => ({ id: String(i), text: w.text }));
  const index = new BM25Index(docs);
  const ranked = index.rank(query);

  // Take top MAX_PASSAGES windows that clear the minimum score.
  const selected = ranked.filter((r) => r.score >= MIN_SCORE).slice(0, MAX_PASSAGES);

  const passages: Passage[] = selected.map((r) => {
    const window = windows[Number(r.id)]!;
    return {
      text: window.text.trim(),
      section: window.section,
      relevance: r.score,
      byteOffset: window.charOffset,
      sourceUrl,
    } satisfies Passage & { sourceUrl: string };
  });

  // Remove passages whose relevance is 0 (shouldn't happen, but guard anyway).
  return passages.filter((p) => p.relevance > 0);
}

// ---------------------------------------------------------------------------
// Window builder
// ---------------------------------------------------------------------------

interface TextWindow {
  text: string;
  /** Nearest section heading above this window, if any. */
  section?: string | undefined;
  /** Character offset of the window start in the original text. */
  charOffset: number;
}

/**
 * Splits text into overlapping character windows.
 *
 * For Markdown / plain text with headings, we try to honour paragraph
 * and heading boundaries so that passages start at natural break points.
 */
function buildWindows(text: string): TextWindow[] {
  const windows: TextWindow[] = [];

  // Try splitting on paragraph boundaries first (blank lines).
  const paragraphs = text.split(/\n{2,}/);
  let offset = 0;
  let currentSection: string | undefined;
  let buffer = "";
  let bufferStart = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();

    // Detect Markdown headings or PDF page markers for section tracking.
    const headingMatch = trimmed.match(/^(#{1,4}\s+.+|={3,}|\-{3,}|\[Page \d+\])/);
    if (headingMatch) {
      // Flush the current buffer before starting a new section.
      if (buffer.trim()) {
        for (const w of chunkText(buffer, bufferStart, currentSection)) {
          windows.push(w);
        }
      }
      currentSection = trimmed.replace(/^#+\s*/, "").replace(/^\[|\]$/g, "");
      buffer = "";
      bufferStart = offset;
    } else {
      buffer += (buffer ? "\n\n" : "") + trimmed;
    }

    offset += para.length + 2; // +2 for the separator
  }

  // Flush remaining buffer.
  if (buffer.trim()) {
    for (const w of chunkText(buffer, bufferStart, currentSection)) {
      windows.push(w);
    }
  }

  return windows;
}

/**
 * Chunks a text block into overlapping WINDOW_CHARS-wide windows.
 */
function chunkText(text: string, baseOffset: number, section?: string): TextWindow[] {
  const windows: TextWindow[] = [];
  let pos = 0;

  while (pos < text.length) {
    const end = Math.min(pos + WINDOW_CHARS, text.length);
    windows.push({
      text: text.slice(pos, end),
      section,
      charOffset: baseOffset + pos,
    });
    if (end >= text.length) break;
    pos += WINDOW_CHARS - OVERLAP_CHARS;
  }

  return windows;
}

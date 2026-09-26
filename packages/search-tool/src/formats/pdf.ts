/**
 * formats/pdf.ts
 *
 * PDF content adapter — bundled in the core package but only invoked when
 * the caller sets `enablePdf: true`.
 *
 * §19 (PDF pipeline), §20 (scanned PDF detection), §129.5 (PDF is a
 * runtime-flag feature) of the spec.
 *
 * Uses `unpdf` which has zero runtime dependencies and runs in Node and
 * Edge runtimes.  The import is dynamic so that tree-shakers can omit it
 * when PDF support is not needed.
 *
 * Safety:
 *   - Size cap enforced by the fetcher (maxPdfBytes); we do not re-check here.
 *   - Page cap: never process more than MAX_PAGES per document.
 *   - Emit SCANNED_PDF signal when no text layer is found.
 */

import type { ExtractionResult, ExtractOptions } from "../core/types.js";

/** Maximum pages to extract text from in a single PDF. */
const MAX_PAGES = 100;

export async function extractPdf(
  body: Uint8Array,
  pageUrl: string,
  _options: ExtractOptions,
): Promise<ExtractionResult> {
  // Dynamic import keeps unpdf out of the module graph when PDF is disabled.
  let unpdf: typeof import("unpdf");
  try {
    unpdf = await import("unpdf");
  } catch {
    return {
      text: "",
      passages: [],
      links: [],
      metadata: {},
      requiresOcr: false,
    };
  }

  let pdf: Awaited<ReturnType<typeof unpdf.getDocumentProxy>>;
  try {
    pdf = await unpdf.getDocumentProxy(body);
  } catch {
    return emptyResult("PDF parse error");
  }

  const pageCount = pdf.numPages;
  const pagesToProcess = Math.min(pageCount, MAX_PAGES);

  const pageTexts: string[] = [];
  let totalTextLength = 0;

  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // getTextContent returns an array of text items.
    const pageText = content.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ")
      .trim();

    if (pageText) {
      // Prefix each page with a marker so passage extraction can reference page numbers.
      pageTexts.push(`[Page ${pageNum}] ${pageText}`);
      totalTextLength += pageText.length;
    }
  }

  // Scanned PDF detection: if no text was found at all, flag for OCR.
  const requiresOcr = totalTextLength === 0;

  // Extract PDF metadata.
  const rawMeta = await pdf.getMetadata().catch(() => null);
  const metadata: Record<string, string> = {};
  if (rawMeta?.info) {
    const info = rawMeta.info as Record<string, unknown>;
    for (const [k, v] of Object.entries(info)) {
      if (typeof v === "string" && v.trim()) {
        metadata[k.toLowerCase()] = v.trim();
      }
    }
  }

  return {
    text: pageTexts.join("\n\n"),
    title: metadata["title"],
    passages: [],
    links: [],
    metadata,
    requiresOcr,
  };
}

function emptyResult(reason: string): ExtractionResult {
  return { text: reason, passages: [], links: [], metadata: {} };
}

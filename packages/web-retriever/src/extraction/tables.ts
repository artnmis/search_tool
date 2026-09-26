/**
 * extraction/tables.ts
 *
 * HTML table extraction as row-oriented structured evidence.
 *
 * §23 of the spec.
 *
 * Tables are a common container for structured data (pricing, comparisons,
 * reference docs, schedules).  Standard Readability strips them; this
 * extractor preserves them as pipe-delimited Markdown so the AI can read
 * the structure.
 *
 * We only include tables that have both a header row and at least one
 * data row.  Single-column tables and layout tables are skipped.
 */

import { parseDocument, DomUtils } from "htmlparser2";
import type { Element } from "domhandler";

export interface ExtractedTable {
  /** Markdown-formatted table string. */
  markdown: string;
  /** Caption text, if the table has a <caption>. */
  caption?: string | undefined;
}

/**
 * Extracts tables from raw HTML as Markdown-formatted strings.
 *
 * @param html     Raw HTML string or bytes.
 * @param maxTables  Maximum number of tables to extract (default: 10).
 */
export function extractTables(
  html: Uint8Array | string,
  maxTables = 10,
): ExtractedTable[] {
  const text = typeof html === "string" ? html : new TextDecoder().decode(html);
  const dom = parseDocument(text);

  const tableEls = DomUtils.findAll(
    (n) => n.type === "tag" && (n as Element).name === "table",
    dom.children,
  ).slice(0, maxTables);

  const results: ExtractedTable[] = [];

  for (const tableEl of tableEls) {
    const el = tableEl as Element;
    const caption = extractCaption(el);
    const rows = extractRows(el);

    // Need at least a header + one data row and at least 2 columns.
    if (rows.length < 2 || (rows[0]?.length ?? 0) < 2) continue;

    const markdown = toMarkdown(rows);
    if (markdown) results.push({ markdown, caption });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCaption(tableEl: Element): string | undefined {
  const captionEl = DomUtils.findOne(
    (n) => n.type === "tag" && (n as Element).name === "caption",
    tableEl.children,
  ) as Element | null;
  return captionEl ? DomUtils.getText(captionEl).trim() || undefined : undefined;
}

function extractRows(tableEl: Element): string[][] {
  // Gather all <tr> elements, regardless of whether they're in <thead>/<tbody>/<tfoot>.
  const trEls = DomUtils.findAll(
    (n) => n.type === "tag" && (n as Element).name === "tr",
    tableEl.children,
  );

  return trEls.map((trEl) => {
    // Get all <th> and <td> cells.
    const cellEls = DomUtils.findAll(
      (n) =>
        n.type === "tag" &&
        ((n as Element).name === "td" || (n as Element).name === "th"),
      (trEl as Element).children,
    );
    return cellEls.map((c) => DomUtils.getText(c as Element).trim().replace(/\s+/g, " "));
  }).filter((row) => row.length > 0);
}

function toMarkdown(rows: string[][]): string {
  if (rows.length === 0) return "";

  const header = rows[0]!;
  const separator = header.map(() => "---");
  const body = rows.slice(1);

  const formatRow = (cells: string[]) => `| ${cells.join(" | ")} |`;

  return [
    formatRow(header),
    formatRow(separator),
    ...body.map(formatRow),
  ].join("\n");
}

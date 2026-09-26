/**
 * formats/json.ts
 *
 * JSON content adapter.
 *
 * §14 (JSON adapter) and §61 (JSON security) of the spec.
 *
 * Security concerns:
 *   - Depth-limit parsing to prevent stack overflow on deeply nested input.
 *   - Length cap on individual string values.
 *   - No eval() or Function() — plain JSON.parse() only.
 *
 * Provenance tracking: every extracted text fragment carries a field-path
 * string (e.g. "data.items[0].description") so the evidence layer can
 * attribute passages to their source location inside the document.
 */

import type { ExtractionResult, ExtractOptions } from "../core/types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum nesting depth to recurse into. Deeper structures are ignored. */
const MAX_DEPTH = 12;
/** Maximum length of an individual string value to include in output. */
const MAX_STRING_LENGTH = 4_000;
/** Maximum number of array items to process per array. */
const MAX_ARRAY_ITEMS = 200;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractJson(
  body: Uint8Array | string,
  _pageUrl: string,
  _options: ExtractOptions,
): ExtractionResult {
  const text = typeof body === "string" ? body : new TextDecoder().decode(body);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyResult(`JSON parse error`);
  }

  const fragments: Array<{ path: string; text: string }> = [];
  const links: string[] = [];

  walkJson(parsed, "", 0, fragments, links);

  const fullText = fragments.map((f) => `[${f.path}] ${f.text}`).join("\n");

  return {
    text: fullText,
    passages: [],
    links: [...new Set(links)],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Recursive walker
// ---------------------------------------------------------------------------

function walkJson(
  value: unknown,
  path: string,
  depth: number,
  out: Array<{ path: string; text: string }>,
  links: string[],
): void {
  if (depth > MAX_DEPTH) return;

  if (typeof value === "string") {
    if (value.length > 0 && value.length <= MAX_STRING_LENGTH) {
      out.push({ path, text: value });
    }
    // Collect URLs found in string values.
    if (value.startsWith("http://") || value.startsWith("https://")) {
      links.push(value);
    }
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    out.push({ path, text: String(value) });
    return;
  }

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, MAX_ARRAY_ITEMS);
    for (let i = 0; i < limit; i++) {
      walkJson(value[i], `${path}[${i}]`, depth + 1, out, links);
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      walkJson(child, childPath, depth + 1, out, links);
    }
  }
}

function emptyResult(reason?: string): ExtractionResult {
  return {
    text: reason ?? "",
    passages: [],
    links: [],
    metadata: {},
  };
}

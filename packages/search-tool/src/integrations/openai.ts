/**
 * integrations/openai.ts
 *
 * OpenAI function-calling adapter.
 *
 * §42 and §43 of the spec.
 *
 * Exports:
 *   - `webRetrieverTool`  — the JSON Schema tool definition to pass to the
 *     OpenAI Chat Completions API in the `tools` array.
 *   - `handleToolCall()`  — converts an OpenAI tool_call object into one or
 *     more retrieve() calls and returns the results formatted for the API.
 *
 * Key change: the AI now provides a list of candidate URLs (up to
 * `maxCandidateUrls`, default 10) rather than a single URL.  The tool fetches
 * as many as it can within the per-call budget, in order, and returns all
 * evidence found.  This is more reliable because the AI's first guess may be
 * a hallucinated URL — having alternatives lets the tool recover without a
 * second round-trip.
 *
 * This module imports from the core only through the public index.ts.
 * It does NOT import OpenAI's SDK — callers are expected to have it
 * installed independently.
 */

import { retrieve } from "../core/retrieve.js";
import type { RetrieveOptions, RetrieveResult } from "../core/types.js";

// ---------------------------------------------------------------------------
// Tool definition (JSON Schema)
// ---------------------------------------------------------------------------

/**
 * The tool definition to include in an OpenAI Chat Completions request.
 *
 * Usage:
 *   const response = await openai.chat.completions.create({
 *     model: "gpt-4o",
 *     tools: [webRetrieverTool],
 *     messages: [...]
 *   });
 */
export const webRetrieverTool = {
  type: "function" as const,
  function: {
    name: "web_retrieve",
    description:
      "Retrieves factual evidence from one or more URLs on a website. " +
      "Provide up to 10 candidate URLs in order of preference — the tool will " +
      "attempt each one until it finds relevant evidence. " +
      "This handles hallucinated or slightly-wrong URLs: if your first URL " +
      "returns 404, the tool uses sitemap/link discovery to find the correct page. " +
      "No search API is used — all discovery is site-local.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description:
            "Ordered list of HTTP/HTTPS URLs to try, starting with the most likely " +
            "candidate.  All must be on the same site.  The tool fetches as many " +
            "as needed within its request budget.",
        },
        query: {
          type: "string",
          description: "Natural-language description of the information you need from this site.",
        },
        mode: {
          type: "string",
          enum: ["fast", "balanced", "deep"],
          description:
            "Retrieval depth. 'fast' = root page only; 'balanced' = default; 'deep' = exhausts full budget.",
        },
        enablePdf: {
          type: "boolean",
          description: "Set true to extract text from PDF documents found at or linked from the URL.",
        },
      },
      required: ["urls", "query"],
      additionalProperties: false,
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------

/**
 * Handles a raw OpenAI tool_call arguments object and returns a formatted
 * string result suitable for the `tool` role message content.
 *
 * Accepts both the new `urls` (array) field and the legacy `url` (string)
 * field for backward compatibility.
 *
 * Usage (after receiving a tool_call from the API):
 *
 *   const result = await handleToolCall(JSON.parse(tool_call.function.arguments));
 *   messages.push({ role: "tool", tool_call_id: tool_call.id, content: result });
 */
export async function handleToolCall(
  args: Record<string, unknown>,
  overrides?: Partial<RetrieveOptions>,
): Promise<string> {
  // Accept both `urls` (new) and `url` (legacy).
  const urlList = normaliseUrlArgs(args);
  if (urlList.length === 0) {
    return "ERROR: no URL provided";
  }

  const baseOptions: Partial<RetrieveOptions> = {
    query: String(args["query"] ?? ""),
    mode: (args["mode"] as RetrieveOptions["mode"]) ?? "balanced",
    enablePdf: Boolean(args["enablePdf"] ?? false),
    ...overrides,
  };

  return retrieveMultiple(urlList, baseOptions);
}

// ---------------------------------------------------------------------------
// Multi-URL retrieval
// ---------------------------------------------------------------------------

/**
 * Attempts retrieval from each URL in `urls` in order, returning as soon as
 * it finds a successful result.  If all URLs fail or return not_found, returns
 * the best partial result with the most evidence.
 *
 * This is the core of the "AI provides candidate URL list" requirement:
 * the tool doesn't block on a single URL — it moves through alternatives
 * until evidence is found.
 */
async function retrieveMultiple(
  urls: string[],
  options: Partial<RetrieveOptions>,
): Promise<string> {
  const results: RetrieveResult[] = [];
  let bestSuccess: RetrieveResult | null = null;

  for (const url of urls) {
    const result = await retrieve({
      url,
      query: options.query ?? "",
      ...options,
    });

    results.push(result);

    if (result.status === "success") {
      bestSuccess = result;
      // Got good evidence — no need to try more URLs.
      break;
    }

    // If the URL repair found a match during not_found handling, the
    // evidence may still have been retrieved from the repaired URL.
    if (result.status === "partial" && result.evidence.length > 0) {
      bestSuccess = result;
      break;
    }

    // blocked / failed / js_required — try next URL.
  }

  const chosen = bestSuccess ?? results.reduce((best, r) =>
    r.evidence.length > best.evidence.length ? r : best,
    results[0]!,
  );

  return formatResult(chosen, results.length > 1 ? results : undefined);
}

// ---------------------------------------------------------------------------
// Result formatter
// ---------------------------------------------------------------------------

/**
 * Converts a RetrieveResult into a compact string for the AI to read.
 *
 * Format:
 *   STATUS: success
 *   SOURCES: 3
 *   ---
 *   [source URL] | title
 *   ...evidence passages...
 */
function formatResult(result: RetrieveResult, allResults?: RetrieveResult[]): string {
  const lines: string[] = [];

  lines.push(`STATUS: ${result.status.toUpperCase()}`);
  lines.push(`QUERY: ${result.query}`);
  lines.push(`SOURCES FETCHED: ${result.sources.length}`);
  lines.push(`EVIDENCE PASSAGES: ${result.evidence.length}`);

  if (allResults && allResults.length > 1) {
    const tried = allResults.map((r) => `${r.startingUrl} → ${r.status}`).join(", ");
    lines.push(`URLS TRIED: ${tried}`);
  }

  if (result.navigation.resolved && result.navigation.resolvedUrl &&
      result.navigation.resolvedUrl !== result.startingUrl) {
    lines.push(`URL REPAIRED: ${result.startingUrl} → ${result.navigation.resolvedUrl} (via ${result.navigation.method})`);
  }

  if (result.status === "js_required") {
    lines.push("\nNOTE: This page requires JavaScript execution to access its content.");
    lines.push("Static metadata only:");
    for (const [k, v] of Object.entries(result.shellMeta ?? {})) {
      lines.push(`  ${k}: ${v}`);
    }
    return lines.join("\n");
  }

  if (result.evidence.length === 0) {
    lines.push(`\nNo relevant evidence found. Navigation: ${result.navigation.method} (resolved: ${result.navigation.resolved})`);
    if (result.navigation.reason) lines.push(`Reason: ${result.navigation.reason}`);
    return lines.join("\n");
  }

  lines.push("\n--- EVIDENCE ---");

  for (const item of result.evidence) {
    const source = result.sources.find((s) => s.url === item.sourceUrl);
    const title = source?.title ?? item.sourceUrl;
    lines.push(`\n[${item.sourceUrl}] ${title}`);
    if (item.section) lines.push(`Section: ${item.section}`);
    lines.push(item.text);
    lines.push(`(relevance: ${item.relevance.toFixed(2)})`);
  }

  lines.push(`\n--- DIAGNOSTICS ---`);
  lines.push(`HTTP requests: ${result.diagnostics.httpRequests}, Pages fetched: ${result.diagnostics.pagesFetched}, Duration: ${result.diagnostics.durationMs}ms`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseUrlArgs(args: Record<string, unknown>): string[] {
  // New field: urls (array)
  const urls = args["urls"];
  if (Array.isArray(urls) && urls.length > 0) {
    return urls.filter((u) => typeof u === "string" && u.length > 0) as string[];
  }
  // Legacy field: url (string)
  const url = args["url"];
  if (typeof url === "string" && url.length > 0) {
    return [url];
  }
  return [];
}

/**
 * integrations/anthropic.ts
 *
 * Anthropic Claude tool_use adapter.
 *
 * §42 of the spec.
 *
 * Exports a `webRetrieverTool` definition compatible with Anthropic's
 * Messages API `tools` array, and a `handleToolUse()` handler.
 */

import { retrieve } from "../core/retrieve.js";
import type { RetrieveOptions } from "../core/types.js";

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/**
 * Anthropic tool definition.
 *
 * Usage:
 *   const message = await anthropic.messages.create({
 *     model: "claude-3-5-sonnet-20241022",
 *     tools: [webRetrieverTool],
 *     messages: [...]
 *   });
 */
export const webRetrieverTool = {
  name: "web_retrieve",
  description:
    "Retrieves factual evidence from one or more URLs on a website. " +
    "Provide up to 10 candidate URLs in order of preference — the tool tries each one " +
    "until it finds relevant evidence.  Handles slightly-wrong URLs via site-local discovery. " +
    "No search API, no LLM, no external service required.",
  input_schema: {
    type: "object" as const,
    properties: {
      urls: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Ordered list of HTTP/HTTPS URLs to try (up to 10), most likely first.",
      },
      query: {
        type: "string" as const,
        description: "Natural-language description of the information needed.",
      },
      mode: {
        type: "string" as const,
        enum: ["fast", "balanced", "deep"],
        description: "Retrieval depth. Default: 'balanced'.",
      },
      enablePdf: {
        type: "boolean" as const,
        description: "Enable PDF extraction. Default: false.",
      },
    },
    required: ["urls", "query"],
  },
} as const;

// ---------------------------------------------------------------------------
// Tool use handler
// ---------------------------------------------------------------------------

/**
 * Handles an Anthropic tool_use block and returns a string suitable for
 * the `tool_result` content block.
 *
 * Usage:
 *   // After receiving a tool_use block from the API:
 *   const content = await handleToolUse(block.input as Record<string, unknown>);
 *   messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: block.id, content }] });
 */
export async function handleToolUse(
  input: Record<string, unknown>,
  overrides?: Partial<RetrieveOptions>,
): Promise<string> {
  const urlList = normaliseAnthropicUrls(input);
  if (urlList.length === 0) return "ERROR: no URL provided";

  const baseOpts: Partial<RetrieveOptions> = {
    query: String(input["query"] ?? ""),
    mode: (input["mode"] as RetrieveOptions["mode"]) ?? "balanced",
    enablePdf: Boolean(input["enablePdf"] ?? false),
    ...overrides,
  };

  // Try each URL; stop on first success.
  let bestResult = await retrieve({ url: urlList[0]!, ...baseOpts } as RetrieveOptions);
  for (let i = 1; i < urlList.length; i++) {
    if (bestResult.status === "success" || bestResult.evidence.length > 0) break;
    const r = await retrieve({ url: urlList[i]!, ...baseOpts } as RetrieveOptions);
    if (r.evidence.length > bestResult.evidence.length) bestResult = r;
  }

  const result = bestResult;

  // Format as a compact readable block for Claude.
  const lines: string[] = [
    `Status: ${result.status}`,
    `Sources fetched: ${result.sources.length}`,
    `Evidence passages: ${result.evidence.length}`,
  ];

  if (result.navigation.resolved && result.navigation.resolvedUrl &&
      result.navigation.resolvedUrl !== result.startingUrl) {
    lines.push(`URL repaired: ${result.startingUrl} → ${result.navigation.resolvedUrl}`);
  }

  if (result.evidence.length === 0) {
    lines.push("No relevant evidence found.");
    if (!result.navigation.resolved) {
      lines.push(`URL could not be resolved: ${result.navigation.reason ?? "unknown"}`);
    }
  } else {
    lines.push("");
    for (const item of result.evidence) {
      lines.push(`Source: ${item.sourceUrl}`);
      if (item.section) lines.push(`Section: ${item.section}`);
      lines.push(item.text);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function normaliseAnthropicUrls(input: Record<string, unknown>): string[] {
  const urls = input["urls"];
  if (Array.isArray(urls)) return urls.filter((u) => typeof u === "string") as string[];
  const url = input["url"];
  if (typeof url === "string") return [url];
  return [];
}

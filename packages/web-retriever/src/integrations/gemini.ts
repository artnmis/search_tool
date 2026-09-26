/**
 * integrations/gemini.ts
 *
 * Google Gemini function-declaration adapter.
 *
 * §44 of the spec.
 *
 * Exports a `webRetrieverFunctionDeclaration` compatible with the
 * Google Generative AI SDK's `tools` array, and a `handleFunctionCall()`
 * to process the model's response.
 */

import { retrieve } from "../core/retrieve.js";
import type { RetrieveOptions } from "../core/types.js";

// ---------------------------------------------------------------------------
// Function declaration
// ---------------------------------------------------------------------------

/**
 * Gemini function declaration.
 *
 * Usage:
 *   const model = genAI.getGenerativeModel({
 *     model: "gemini-1.5-pro",
 *     tools: [{ functionDeclarations: [webRetrieverFunctionDeclaration] }],
 *   });
 */
export const webRetrieverFunctionDeclaration = {
  name: "web_retrieve",
  description:
    "Retrieves factual evidence from one or more URLs on a website. " +
    "Provide up to 10 candidate URLs in order of preference — the tool tries each one " +
    "until it finds relevant evidence.  Handles hallucinated URLs via site-local discovery. " +
    "No search API or LLM required.",
  parameters: {
    type: "OBJECT",
    properties: {
      urls: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "Ordered list of HTTP/HTTPS URLs to try (up to 10), most likely first.",
      },
      query: {
        type: "STRING",
        description: "Natural-language description of the information needed.",
      },
      mode: {
        type: "STRING",
        description: "'fast', 'balanced', or 'deep'. Default: 'balanced'.",
      },
      enablePdf: {
        type: "BOOLEAN",
        description: "Enable PDF extraction. Default: false.",
      },
    },
    required: ["urls", "query"],
  },
} as const;

// ---------------------------------------------------------------------------
// Function call handler
// ---------------------------------------------------------------------------

/**
 * Handles a Gemini FunctionCall response part and returns a FunctionResponse
 * args object.
 *
 * Usage:
 *   const part = response.candidates[0].content.parts[0]; // functionCall part
 *   const result = await handleFunctionCall(part.functionCall.args);
 *   // Pass result back as a FunctionResponse message.
 */
export async function handleFunctionCall(
  args: Record<string, unknown>,
  overrides?: Partial<RetrieveOptions>,
): Promise<Record<string, unknown>> {
  const urlList = normaliseGeminiUrls(args);
  if (urlList.length === 0) return { status: "failed", error: "no URL provided" };

  const baseOpts: Partial<RetrieveOptions> = {
    query: String(args["query"] ?? ""),
    mode: (args["mode"] as RetrieveOptions["mode"]) ?? "balanced",
    enablePdf: Boolean(args["enablePdf"] ?? false),
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

  // Return the result as a plain object — Gemini expects a JSON-serialisable
  // object for the FunctionResponse, not a string.
  return {
    status: result.status,
    query: result.query,
    evidenceCount: result.evidence.length,
    navigation: result.navigation,
    evidence: result.evidence.slice(0, 5).map((e) => ({
      sourceUrl: e.sourceUrl,
      text: e.text,
      section: e.section,
      relevance: e.relevance,
    })),
  };
}

function normaliseGeminiUrls(args: Record<string, unknown>): string[] {
  const urls = args["urls"];
  if (Array.isArray(urls)) return urls.filter((u) => typeof u === "string") as string[];
  const url = args["url"];
  if (typeof url === "string") return [url];
  return [];
}

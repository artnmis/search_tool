/**
 * integrations/mcp.ts
 *
 * MCP (Model Context Protocol) stdio adapter.
 *
 * §45 of the spec.
 *
 * This is an optional entry point that exposes the retriever as an MCP tool
 * server over stdio.  It has zero effect on the core bundle when not used —
 * callers import from "web-retriever/mcp" explicitly.
 *
 * MCP protocol: https://modelcontextprotocol.io/docs/concepts/tools
 *
 * Usage (as a standalone process):
 *   node dist/integrations/mcp.js
 *
 * Or registered in an MCP host config:
 *   {
 *     "mcpServers": {
 *       "web-retriever": { "command": "node", "args": ["./node_modules/web-retriever/dist/integrations/mcp.js"] }
 *     }
 *   }
 */

import { retrieve } from "../core/retrieve.js";
import type { RetrieveOptions } from "../core/types.js";

// ---------------------------------------------------------------------------
// MCP message types (minimal subset — avoids depending on an MCP SDK)
// ---------------------------------------------------------------------------

interface McpRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

// ---------------------------------------------------------------------------
// Tool definitions exposed to MCP hosts
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: "web_retrieve",
    description:
      "Retrieves factual evidence from one or more URLs on a website. " +
      "Provide up to 10 candidate URLs in order of preference — the tool tries " +
      "each one until it finds relevant evidence.  Handles hallucinated or " +
      "slightly-wrong URLs via site-local sitemap/link discovery. " +
      "No search API, no LLM, no external service required.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description: "Ordered list of HTTP/HTTPS URLs to try.",
        },
        query: { type: "string", description: "What information you need." },
        mode: { type: "string", enum: ["fast", "balanced", "deep"] },
        enablePdf: { type: "boolean" },
      },
      required: ["urls", "query"],
    },
  },
];

// ---------------------------------------------------------------------------
// Stdio server loop
// ---------------------------------------------------------------------------

/**
 * Starts the MCP stdio server.  Reads line-delimited JSON-RPC 2.0 messages
 * from stdin and writes responses to stdout.
 *
 * This function never returns in normal operation.
 */
export function startMcpServer(): void {
  process.stdin.setEncoding("utf8");

  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      handleLine(trimmed).catch(() => {});
    }
  });

  process.stdin.on("end", () => {
    process.exit(0);
  });
}

async function handleLine(line: string): Promise<void> {
  let req: McpRequest;
  try {
    req = JSON.parse(line) as McpRequest;
  } catch {
    sendError(null, -32700, "Parse error");
    return;
  }

  if (req.method === "tools/list") {
    send({ jsonrpc: "2.0", id: req.id, result: { tools: MCP_TOOLS } });
    return;
  }

  if (req.method === "tools/call") {
    const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (params?.name !== "web_retrieve") {
      sendError(req.id, -32601, `Unknown tool: ${params?.name}`);
      return;
    }

    const args = params.arguments ?? {};

    // Accept both `urls` (array) and legacy `url` (string).
    const urlList = normaliseMcpUrls(args);
    if (urlList.length === 0) {
      sendError(req.id, -32602, "No URL provided — pass `urls` (array) or `url` (string)");
      return;
    }

    const baseOptions: RetrieveOptions = {
      url: urlList[0]!,
      query: String(args["query"] ?? ""),
      mode: (args["mode"] as RetrieveOptions["mode"]) ?? "balanced",
      enablePdf: Boolean(args["enablePdf"] ?? false),
    };

    try {
      // Try each URL in order; return on first success.
      let bestResult: Awaited<ReturnType<typeof retrieve>> | null = null;
      for (const url of urlList) {
        const result = await retrieve({ ...baseOptions, url });
        if (result.status === "success" || (result.evidence.length > 0)) {
          bestResult = result;
          break;
        }
        if (!bestResult || result.evidence.length > (bestResult.evidence.length)) {
          bestResult = result;
        }
      }

      send({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(bestResult, null, 2),
            },
          ],
        },
      });
    } catch (err) {
      sendError(req.id, -32603, String(err));
    }
    return;
  }

  sendError(req.id, -32601, `Method not found: ${req.method}`);
}

function normaliseMcpUrls(args: Record<string, unknown>): string[] {
  const urls = args["urls"];
  if (Array.isArray(urls) && urls.length > 0) {
    return urls.filter((u) => typeof u === "string" && u.length > 0) as string[];
  }
  const url = args["url"];
  if (typeof url === "string" && url.length > 0) return [url];
  return [];
}

function send(msg: McpResponse): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendError(id: number | string | null, code: number, message: string): void {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }) + "\n",
  );
}

// Auto-start when run directly.
if (process.argv[1]?.endsWith("mcp.js") || process.argv[1]?.endsWith("mcp.ts")) {
  startMcpServer();
}

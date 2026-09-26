<div align="center">

<pre>
     ░░▄▄▄▄▄▄░░
   ░▄██████████▄░
   ██░░░░░░░░░░██
   ██░░░░░░░░░░██
   ██░░░░░░░░░░██
   ░▀██████████▀░
     ░░▀▀▀▀▀▀░░
           ░░▄▄░
             ░▄▄░
               ▀▀
</pre>

# search-tool

**A deterministic web retriever for AI agents.**
No search API. No external service. No AI inside the retriever itself.

[![npm version](https://img.shields.io/npm/v/search-tool.svg)](https://www.npmjs.com/package/search-tool)
[![license](https://img.shields.io/npm/l/search-tool.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/search-tool.svg)](https://nodejs.org)
[![GitHub](https://img.shields.io/badge/source-github-black.svg)](https://github.com/artnmis/search_tool)

</div>

---

Give it a URL and a question. It reads the page — HTML, PDF, JSON, XML, feeds — navigates the site's structure, repairs broken or invented URLs, and hands back ranked, source-backed passages your AI can answer from. One call is usually enough; the model doesn't need to loop.

`search-tool` doesn't discover the open web for you — it's the reliable second half of a search pipeline, not the first. Point it at a page and it will read that site better than almost anything else out there.

## Contents

- [Why this exists](#why-this-exists)
- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [AI provider integrations](#ai-provider-integrations)
- [MCP server](#mcp-server)
- [Controlling which sites are allowed](#controlling-which-sites-are-allowed)
- [Retrieval depth](#retrieval-depth)
- [Rate limits](#rate-limits)
- [Optional features](#optional-features)
- [Limitations](#limitations)
- [Contributing](#contributing)

---

## Why this exists

Most "AI web search" tools are just a thin wrapper around a paid search vendor. `search-tool` solves the other half of the problem — the part that's actually free forever: taking a URL your agent already has (from the user, from a citation, from a prior search call) and turning it into clean, ranked, trustworthy text, safely.

- **Zero hosted infrastructure.** No Docker, no database, no server to keep alive.
- **Zero API keys required** for the core retrieval path.
- **Runs anywhere Node or Edge runtimes run** — including serverless platforms with short execution windows, since nothing here needs a persistent process.
- **Deterministic.** No LLM call inside the retriever. Ranking is local (BM25), not a model guessing at relevance.

## Install

**Requirements:** Node.js 20+

```bash
npm install search-tool
# or
pnpm add search-tool
# or
yarn add search-tool
```

## Quick start

```ts
import { retrieve } from "search-tool";

const result = await retrieve({
  url: "https://example.com/docs/getting-started",
  query: "how do I configure authentication",
});

console.log(result.status);    // "success" | "partial" | "not_found" | "blocked" | ...
console.log(result.evidence);  // ranked text passages, ready to hand to your model
```

## How it works

1. Your AI provides a URL (or up to 10 candidates, most likely first).
2. `search-tool` validates the URL, checks `robots.txt`, and fetches the page.
3. If the URL is wrong or invented, it checks the site's sitemap and link structure for the closest real match — self-healing instead of failing outright.
4. Content is parsed — HTML, JSON, XML, RSS/Atom, plain text, Markdown, CSV, and optionally PDF — and split into passages.
5. Passages are scored against the query locally with BM25. No embeddings, no external model.
6. The top-ranked passages come back as evidence.

**Built-in protection:** SSRF and private-network blocking, redirect-loop and DNS-rebinding defense, response size caps, malformed HTML/XML handling.

## AI provider integrations

Each provider has its own sub-import so the core stays lean.

<details>
<summary><strong>OpenAI</strong></summary>

```ts
import { webRetrieverTool, handleToolCall } from "search-tool/openai";

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  tools: [webRetrieverTool],
  messages: [...],
});

const content = await handleToolCall(JSON.parse(toolCall.function.arguments));
messages.push({ role: "tool", tool_call_id: toolCall.id, content });
```
</details>

<details>
<summary><strong>Anthropic Claude</strong></summary>

```ts
import { webRetrieverTool, handleToolUse } from "search-tool/anthropic";

const message = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  tools: [webRetrieverTool],
  messages: [...],
});

const content = await handleToolUse(block.input);
messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: block.id, content }] });
```
</details>

<details>
<summary><strong>Google Gemini</strong></summary>

```ts
import { webRetrieverFunctionDeclaration, handleFunctionCall } from "search-tool/gemini";

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-pro",
  tools: [{ functionDeclarations: [webRetrieverFunctionDeclaration] }],
});

const result = await handleFunctionCall(part.functionCall.args);
```
</details>

All three adapters accept up to 10 candidate URLs per call. If the first one fails, the next is tried automatically — no extra round-trip back to the model.

## MCP server

Run `search-tool` as a standalone [Model Context Protocol](https://modelcontextprotocol.io) server so any compatible host (Claude Desktop, Cursor, Continue, and others) can call `web_retrieve` directly.

```bash
node ./node_modules/search-tool/dist/integrations/mcp.js
```

```json
{
  "mcpServers": {
    "search-tool": {
      "command": "node",
      "args": ["./node_modules/search-tool/dist/integrations/mcp.js"]
    }
  }
}
```

| Parameter | Required | Description |
|---|---|---|
| `urls` | Yes | One to ten URLs to try, most likely first |
| `query` | Yes | What you want to find on the page |
| `mode` | No | `fast`, `balanced` (default), or `deep` |
| `enablePdf` | No | Set `true` to read PDF files (default: `false`) |

## Controlling which sites are allowed

**Allow-list** — restrict to specific domains. Recommended when you want `search-tool` to act as a focused index over known sites; the AI can't stray outside it, even with an invented URL.

```ts
await retrieve({
  url: "https://docs.mycompany.com/api",
  query: "authentication",
  allowDomains: ["docs.mycompany.com", "api.mycompany.com"],
});
```

**Deny-list** — block specific domains while allowing everything else.

```ts
await retrieve({
  url: "https://some-site.com/page",
  query: "pricing",
  denyDomains: ["ads.tracker.com"],
});
```

## Retrieval depth

| Mode | Behavior |
|---|---|
| `fast` | The given page plus one sitemap candidate. Fewest requests. |
| `balanced` | Default. Up to 6 pages, stops as soon as there's enough evidence. |
| `deep` | Uses the full request budget. Best for large sites. |

```ts
await retrieve({ url, query, mode: "fast" | "balanced" | "deep" });
```

## Rate limits

Polite by default — at least 500ms between requests to the same domain, and respects `Crawl-delay` from `robots.txt`. Tunable per call:

```ts
await retrieve({
  url: "https://example.com",
  query: "...",
  maxPages: 3,               // default: 6
  maxInternalRequests: 5,    // default: 8
  timeoutMs: 5_000,          // default: 8000
  maxResponseBytes: 524288,  // default: 2 MiB
});
```

Global defaults live in [`src/core/defaults.ts`](./src/core/defaults.ts).

## Optional features

**PDF reading** — off by default (`enablePdf: true`). Uses `unpdf`, a dependency-free parser that runs in Node and Edge runtimes — no native binaries, safe for serverless.

**OCR for scanned documents** — when a PDF has no text layer, `search-tool` flags `requiresOcr: true` rather than guessing. Plug your own OCR/vision step in on that signal (a multimodal model call works well here).

**External search as a URL source** — `search-tool` doesn't discover the open web itself, but you can plug in a `discoveryProvider` to feed it candidate URLs from a search backend:

```ts
import { createSearxngProvider } from "search-tool-searxng";

await retrieve({
  url,
  query,
  discoveryProvider: createSearxngProvider("https://your-searxng-instance"),
});
```

**Custom cache** — in-memory by default; implement `CacheProvider` to plug in Redis, filesystem, etc.

## Limitations

Being upfront about scope beats a surprise in production:

- **Not a search engine.** It reads pages you point it at — it doesn't crawl the open web or maintain an index.
- **One site per call.** Multiple sites means multiple calls.
- **No JavaScript rendering** in the core. Pages that render entirely client-side need a separate browser adapter (non-serverless).
- **No login/session support.** No authentication, cookies, or logged-in access.
- **Scanned PDFs return no text** without an OCR step you provide.
- **Respects `robots.txt`** by default; disallowed sites return `blocked` (overridable, carefully).
- **Returns what pages say, not what's true.** Ranking is by relevance, not by accuracy.

## Contributing

Source lives at [github.com/artnmis/search_tool](https://github.com/artnmis/search_tool). Issues and PRs welcome. Please run `pnpm test` and `pnpm typecheck` before opening a pull request.

## License

None
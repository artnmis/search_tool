No 1 most important rule : The whole architecture has to be consistent, easily maintainable and human readable without weird robot / ai like vague writings . Comments should tell what does what and why that was done instead of technical review that goes throw the code structures. Follow all the possible efficiency , best practices, latest documentations and best methods.
# Deterministic Web Retriever for AI Agents

> **Project status:** architecture / implementation specification
>
> **Primary goal:** a tiny, self-contained Node.js package that lets an AI agent retrieve factual evidence from a website by starting from a URL, without requiring a search index, search API, login, API key, secondary server, Docker, database, LLM, embeddings, or hosted infrastructure.
>
> **Core principle:** the model supplies a starting URL and a natural-language retrieval objective; the package performs deterministic site discovery, URL resolution, fetching, extraction, ranking, and evidence selection locally.

---

## 1. What this project is

This project is a **web retrieval helper for AI agents**, not a global search engine.

The package is designed for an agent that already has, or can reasonably infer, a starting URL such as:

```text
https://example.com
https://docs.example.com
https://chorcha.net
https://example.org/report.pdf
```

The agent then calls one deterministic tool:

```ts
await retrieve({
  url: "https://docs.example.com",
  query: "How does authentication middleware work?"
})
```

The package attempts to answer the retrieval part of the problem without another model call:

```text
starting URL
   ↓
validate URL
   ↓
fetch robots.txt
   ↓
discover sitemap(s)
   ↓
fetch the starting resource
   ↓
detect actual content type
   ↓
extract metadata / links / structured data / application data
   ↓
build a small temporary site-local candidate set
   ↓
rank candidate URLs locally
   ↓
fetch only the most promising resources
   ↓
extract text/data/media evidence
   ↓
rank passages locally
   ↓
return compact source-backed evidence to the AI
```

The package is intentionally **not** responsible for generating the final natural-language answer. The AI model remains responsible for interpreting the evidence and answering the user's question.

---

## 2. The non-negotiable product requirements

These requirements are part of the architecture, not suggestions.

### 2.1 No secondary hosting

A normal installation must run entirely inside the host Node.js application.

It must **not** require:

- SearXNG
- a separate crawler service
- Docker
- Docker Compose
- Python
- Redis / Valkey
- Postgres
- SQLite running as a service
- Elasticsearch
- OpenSearch
- a hosted search index
- a hosted embedding database
- a hosted proxy
- a browser-rendering service

A persistent local cache or local crawl index may be used **only when the host application explicitly enables it**.

### 2.2 No search API is required

The core package must work without:

- Google Search API
- Brave Search API
- Bing Search API
- SerpAPI
- Tavily
- Exa
- Perplexity
- other paid search providers

Optional provider adapters may exist in separate packages, but they must never be required by the core package.

### 2.3 No login and no API key

A developer must be able to do:

```bash
npm install @yourorg/web-retriever
```

and use the core package immediately.

### 2.4 No LLM inside the retriever

The package must not make OpenAI, Gemini, Claude, local-LLM, embedding, or reranking-model calls as part of normal retrieval.

All core ranking, URL repair, source selection, and passage selection must be deterministic.

### 2.5 AI-provider agnostic

The retrieval function must expose provider-neutral TypeScript types and JSON Schema-compatible tool definitions.

Thin adapters may be provided for:

- OpenAI function/custom tools
- Google Gemini function calling
- Anthropic tool use
- MCP
- generic JSON Schema tool ecosystems

The core package must not depend on any of those SDKs.

### 2.6 One AI tool call should normally be enough

The AI should preferably make one call like:

```ts
retrieve({
  url,
  query,
  options
})
```

The package may perform multiple ordinary HTTP requests internally. This is intentional.

The goal is to minimize **AI conversation/tool-call round trips**, while remaining conservative with the number of website HTTP requests.

---

## 3. What this project is NOT

Do not accidentally turn this project into something else.

### It is not a global search engine

There is intentionally no Google-like global inverted index of the Internet.

Do not build:

```text
crawler → billions of pages → global index → distributed ranking system
```

That would violate the lightweight, no-hosting requirements.

### It is not a search engine scraper

The core project must not depend on scraping Google, Bing, DuckDuckGo, Brave, or another search engine's result page.

A public search page being technically accessible does not establish permission for an arbitrary automated product to use it. The core architecture therefore does not require a search engine at all.

### It is not a headless browser

Do not put Chromium/Playwright/Puppeteer in the core package.

A browser adapter may be added separately for difficult client-rendered sites, but normal retrieval must work over ordinary HTTP requests whenever the site exposes usable public data over HTTP.

### It is not a web archive

The package does not continuously crawl or preserve the Internet.

### It is not an answer generator

It returns evidence and source information. The model generates the final answer.

---

## 4. Why starting from a URL works

The agent does not need a global search index if it already has a likely source domain.

The package treats the starting URL as the root of a **site-local retrieval problem**.

From that root, it can discover additional resources using multiple mechanisms:

```text
robots.txt
sitemap.xml
sitemap indexes
RSS / Atom
plain-text sitemap files
HTML links
canonical links
hreflang links
OpenGraph metadata
Schema.org / JSON-LD
application manifests
embedded application state
public API links referenced by the page
same-origin assets and data endpoints when safely discoverable
```

The sitemap protocol itself supports sitemap indexes and allows sitemap index entries to point to XML sitemaps, Atom/RSS feeds, or simple text sitemaps. The protocol also defines `loc` and optional `lastmod` information. See the official sitemap protocol: https://www.sitemaps.org/protocol.html

This means the package can create a **temporary, site-local URL candidate set** without owning a global index.

---

## 5. Legal/compliance posture

### Important: do not claim universal “100% legal compliance”

No generic crawler library can truthfully guarantee legal compliance in every country, for every website, for every use case, or under every contract.

The package must instead implement a conservative compliance posture and make its behavior explicit.

Robots Exclusion Protocol rules are intended for crawlers to honor, but RFC 9309 explicitly states that robots.txt is **not an authorization mechanism**. See: https://www.rfc-editor.org/rfc/rfc9309.html

Therefore:

```text
robots.txt compliance
        ≠
legal permission for every possible use
```

The package should be designed to minimize risk and avoid circumvention, while the application/operator remains responsible for its own use case, jurisdiction, contracts, retention rules, and output policy.

### Required crawler behavior

By default, the crawler should:

1. Use HTTP(S) only.
2. Identify itself with a descriptive User-Agent.
3. Fetch and respect robots.txt before crawling same-site resources.
4. Respect per-request and per-domain budgets.
5. Avoid authentication bypass.
6. Avoid paywall bypass.
7. Avoid CAPTCHA solving or bypass.
8. Avoid anti-bot circumvention.
9. Avoid stealth browser fingerprinting.
10. Never attempt to access private networks or cloud instance metadata.
11. Follow redirects only after re-validating the destination.
12. Limit response sizes.
13. Stop on repeated failures / throttling.
14. Avoid downloading unnecessary assets such as video, fonts, tracking pixels, and analytics bundles.
15. Return limited relevant excerpts by default rather than mirroring an entire site.
16. Provide domain allow/deny controls to the host application.

### robots.txt sources

The implementation may use RFC 9309 as the normative crawler reference and Google Search Central's crawler guidance as practical supplementary documentation:

- RFC 9309: https://www.rfc-editor.org/rfc/rfc9309.html
- Google robots.txt guidance: https://developers.google.com/search/docs/crawling-indexing/robots/intro

The package must not tell users that robots.txt provides legal authorization. It does not.

---

## 6. Core architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    Host Application                         │
│                                                             │
│  Next.js / Node / Bun / other Node-compatible server       │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              @yourorg/web-retriever                  │  │
│  │                                                       │  │
│  │  Tool interface                                       │  │
│  │       ↓                                               │  │
│  │  Request planner                                      │  │
│  │       ↓                                               │  │
│  │  URL / SSRF validator                                 │  │
│  │       ↓                                               │  │
│  │  robots.txt                                           │  │
│  │       ↓                                               │  │
│  │  site discovery                                       │  │
│  │       ↓                                               │  │
│  │  sitemap / feed / link collection                    │  │
│  │       ↓                                               │  │
│  │  content-type detector                               │  │
│  │       ↓                                               │  │
│  │  format adapter                                       │  │
│  │       ↓                                               │  │
│  │  URL candidate ranking                                │  │
│  │       ↓                                               │  │
│  │  targeted fetching                                    │  │
│  │       ↓                                               │  │
│  │  content extraction                                   │  │
│  │       ↓                                               │  │
│  │  passage ranking                                      │  │
│  │       ↓                                               │  │
│  │  evidence formatter                                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Optional: user-provided cache/index                      │
└─────────────────────────────────────────────────────────────┘
```

There is no central project server in this architecture.

---

## 7. Main API

The public API should remain intentionally small.

### Recommended primary function

```ts
export interface RetrieveOptions {
  url: string;
  query: string;

  maxPages?: number;
  maxDepth?: number;
  maxInternalRequests?: number;

  timeoutMs?: number;
  maxResponseBytes?: number;
  maxPdfBytes?: number;

  respectRobots?: boolean;
  followSitemaps?: boolean;
  followFeeds?: boolean;
  followSameOriginLinks?: boolean;

  allowDomains?: string[];
  denyDomains?: string[];

  enablePdf?: boolean;
  enableOcr?: boolean;
  enableBrowser?: boolean;

  cache?: CacheAdapter;
  index?: SiteIndexAdapter;
}

export async function retrieve(
  options: RetrieveOptions
): Promise<RetrieveResult>;
```

### Important API invariant

`url` is the **starting point**, not necessarily the final page.

For example:

```ts
retrieve({
  url: "https://example.com",
  query: "2026 annual revenue report"
})
```

may return:

```text
https://example.com/investors/reports/2026-annual-report.pdf
```

The model does not have to discover that second URL itself.

---

## 8. Result structure

The result must be compact and useful to an LLM.

Recommended shape:

```ts
export interface RetrieveResult {
  status:
    | "success"
    | "partial"
    | "not_found"
    | "blocked"
    | "unsupported"
    | "failed";

  query: string;
  startingUrl: string;

  sources: SourceResult[];
  evidence: Evidence[];

  navigation: NavigationResult;
  diagnostics: RetrievalDiagnostics;
}
```

Example:

```json
{
  "status": "success",
  "query": "How does authentication middleware work?",
  "startingUrl": "https://docs.example.com",
  "sources": [
    {
      "url": "https://docs.example.com/auth/middleware",
      "title": "Authentication Middleware",
      "type": "html",
      "relevance": 0.94
    }
  ],
  "evidence": [
    {
      "sourceUrl": "https://docs.example.com/auth/middleware",
      "text": "...relevant passage...",
      "section": "Middleware",
      "relevance": 0.97
    }
  ],
  "navigation": {
    "resolved": true,
    "method": "sitemap_match"
  },
  "diagnostics": {
    "httpRequests": 5,
    "pagesFetched": 3,
    "documentsParsed": 3,
    "durationMs": 1840
  }
}
```

### Never return a fabricated source URL

Every returned URL must be one of:

- the original requested URL;
- a URL observed in a server response;
- a URL present in a sitemap/feed/structured document;
- a URL obtained through a standards-based redirect/canonical relation;
- a URL returned by an explicitly configured provider.

The implementation must not invent a URL solely because it “looks plausible.”

---

## 9. URL resolution and hallucination repair

This is a core feature.

The AI may produce a plausible but nonexistent URL:

```text
https://example.com/docs/auth/security/middleware
```

The actual site may have:

```text
https://example.com/docs/authentication/middleware
```

The package must resolve this deterministically when enough site evidence exists.

### Resolution order

Use this order:

1. Exact URL match.
2. Exact normalized URL match.
3. Canonical URL match.
4. Redirect destination.
5. Exact path found in sitemap/feed.
6. Exact path found in discovered links.
7. Deterministic path-token similarity against known site URLs.
8. Reject unresolved guess if confidence is below a strict threshold.

### Critical constraint

A “corrected” URL must come from observed site data.

Do not manufacture:

```text
https://example.com/docs/foo/bar
```

because a language model or heuristic thinks the path probably exists.

Instead:

```text
requested URL
     ↓
not found
     ↓
site URL candidate set
     ↓
closest observed URL
     ↓
strict threshold
     ↓
resolved or rejected
```

### Deterministic similarity signals

Use lightweight, deterministic signals such as:

- exact path segment overlap;
- normalized token overlap;
- filename similarity;
- extension match;
- parent-path overlap;
- title-to-path term overlap;
- sitemap `lastmod` freshness when relevant;
- same-origin requirement;
- query-token coverage.

Do not require embeddings or an LLM.

### Example

```text
Requested:
/docs/auth/security/middleware

Observed candidates:
/docs/authentication
/docs/authentication/middleware
/docs/security/auth
/docs/middleware
```

The candidate scorer may select `/docs/authentication/middleware` only if the score clears the resolver threshold.

If no candidate clears the threshold:

```json
{
  "resolved": false,
  "reason": "no_safe_url_match"
}
```

Do not guess further.

---

## 10. Site discovery pipeline

The discovery process should be shallow and query-directed.

### Phase A — root validation

Validate the starting URL before any network request.

Reject:

- non-http(s) schemes;
- `file:`
- `data:`
- `blob:`
- `javascript:`
- localhost/private/link-local destinations;
- malformed URLs;
- unsafe ports if policy disallows them.

### Phase B — robots.txt

For a normal web origin:

```text
https://example.com/robots.txt
```

Parse:

- User-agent groups;
- Allow;
- Disallow;
- Crawl-delay when present/meaningful;
- Sitemap directives.

Cache robots rules for a configurable period.

The package should not assume that only `/robots.txt` can be relevant after redirects or origin changes; always bind rules to the correct origin.

### Phase C — sitemap discovery

Try, in order as appropriate:

```text
robots.txt Sitemap directives
/sitemap.xml
/sitemap_index.xml
/sitemap-index.xml
common discovered sitemap locations
```

Do not generate an uncontrolled list of guessed paths. Keep the built-in list tiny.

### Phase D — feed discovery

Look for:

```html
<link rel="alternate" type="application/rss+xml" ...>
<link rel="alternate" type="application/atom+xml" ...>
```

Feeds are often much cheaper and more current than crawling navigation pages on blogs/news sites.

### Phase E — root response parsing

Parse the starting resource and collect:

- title;
- metadata;
- canonical URL;
- alternate languages;
- links;
- structured data;
- JSON-LD;
- `og:*` data;
- embedded application state;
- obvious public API links;
- downloadable documents;
- images with meaningful alt text;
- feed links;
- manifest links.

### Phase F — candidate selection

Create a local candidate set but do not create a persistent global index.

Score candidates against the query.

### Phase G — targeted fetch

Fetch only the highest-value candidates within the request budget.

---

## 11. Sitemap handling is a first-class feature

A sitemap is effectively a **free, site-provided URL index**.

The package should support:

- standard XML sitemaps;
- sitemap index files;
- plain-text URL lists;
- RSS/Atom sitemap-like URL sources where explicitly supported;
- nested sitemap indexes;
- `lastmod` parsing;
- compressed sitemap HTTP responses;
- safe handling of very large sitemap files.

See the official sitemap protocol: https://www.sitemaps.org/protocol.html

### Do not fully materialize huge sitemap indexes if unnecessary

For a 200,000 URL site:

```text
200,000 URLs
```

does not mean:

```text
fetch all 200,000 pages
```

The sitemap is used only for URL discovery.

The package should:

1. parse URL locations;
2. score URLs locally;
3. fetch only top candidates;
4. stop when evidence is sufficient.

### `lastmod` handling

`lastmod` should be treated as a freshness hint, not proof that the page content is current or accurate.

Never assume:

```text
lastmod = truth
```

---

## 12. Do not assume the web is HTML

This is a strict requirement.

The web-retrieval layer is **HTTP + content interpretation**, not “download HTML and strip tags.”

Many modern sites are applications where the visible content is assembled from:

- JSON APIs;
- GraphQL;
- embedded JSON state;
- framework payloads;
- XML;
- RSS/Atom;
- plain text;
- Markdown;
- CSV;
- PDF;
- image resources;
- server components / streamed application payloads;
- other structured HTTP responses.

Google itself documents that JavaScript applications can use client-side rendering and that some sites initially return an app shell before content is made available to a renderer. Search engines may therefore process HTML, rendered content, and discovered HTTP resources differently. See:

- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering

Your package must therefore make content-type detection a separate subsystem.

---

## 13. Content-type detection

Determine document type using **both HTTP metadata and content signatures**.

Do not trust `Content-Type` blindly.

### Primary source

```http
Content-Type: text/html; charset=utf-8
```

### Secondary source

Inspect magic bytes / file signatures when useful.

Examples:

```text
%PDF-        → PDF
PK....       → ZIP-based formats such as DOCX/XLSX/EPUB (inspect container before deciding)
{            → possible JSON
[            → possible JSON
<rss         → RSS
<feed        → Atom
<?xml        → XML
<html        → HTML
```

The implementation must avoid reading unbounded bodies merely to detect a format.

### Normalize MIME types

Normalize parameters:

```text
application/json; charset=utf-8
```

to:

```text
application/json
```

---

## 14. Required format adapters

The project should be adapter-driven.

Recommended conceptual interface:

```ts
export interface ContentAdapter {
  canHandle(input: DetectedResource): boolean;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}
```

### Core / strongly recommended

#### HTML / XHTML

Support:

- links;
- headings;
- paragraphs;
- lists;
- tables where recoverable;
- title;
- metadata;
- JSON-LD;
- canonical;
- robots meta where relevant;
- `noscript` text;
- image alt text;
- embedded JSON state;
- script URLs;
- link rels.

#### XML

Support generic XML extraction sufficient for:

- sitemaps;
- feeds;
- simple document XML;
- application XML when structure is understandable.

Do not require a general-purpose XML database.

#### JSON

Support structured traversal with configurable depth/size limits.

Use JSON for:

- REST responses;
- embedded data;
- application configuration;
- public data APIs;
- API search results;
- JSON manifests.

Preserve key paths where possible:

```text
results[3].title
results[3].content
question.data.answer
```

This allows evidence to reference structured fields.

#### Plain text

Support:

- `text/plain`;
- simple log/text responses;
- robots.txt;
- plain-text sitemap lists.

#### Markdown

Where a server returns Markdown directly, preserve headings, lists, links, code blocks and tables in a way that supports local ranking.

### Strongly recommended

#### RSS / Atom

Use feeds as efficient discovery sources for blogs, news sites, update streams and documentation changelogs.

#### CSV / TSV

Support bounded parsing for structured tabular responses.

The parser must enforce size/row limits.

### Optional / separate packages

- PDF
- OCR
- DOCX
- XLSX
- EPUB
- browser-rendered DOM
- audio/video transcription
- advanced image understanding

---

## 15. HTML extraction

For normal document pages, the extraction pipeline should look like:

```text
raw HTML
   ↓
HTML parser
   ↓
remove obvious non-content nodes
   ↓
metadata extraction
   ↓
main-content extraction
   ↓
heading-aware segmentation
   ↓
passage chunks
```

A lightweight parser such as `htmlparser2` is appropriate; the current package advertises fast/forgiving HTML/XML parsing and supports XML mode. See https://www.npmjs.com/package/htmlparser2

Mozilla Readability is also an appropriate content-extraction component. The current npm package has zero runtime dependencies and is designed around Firefox Reader View-style article extraction. See https://www.npmjs.com/package/@mozilla/readability

### Important

Readability must not be the only extraction path.

Many pages are not articles:

- documentation;
- product listings;
- exam questions;
- dashboards;
- reference tables;
- directories;
- FAQ pages;
- public data pages.

Therefore the extractor needs at least two modes:

```text
article/content mode
structured/application mode
```

If Readability returns poor/empty content, fall back to structural extraction instead of declaring the page useless.

---

## 16. Modern application / SPA support

This is one of the most important parts of the implementation.

Do not assume:

```text
HTTP GET page
→ visible text is in HTML
```

A modern app may return:

```text
HTML shell
+
JSON state
+
JavaScript references
+
API data
```

or an application-specific streamed payload.

### The baseline strategy

Before introducing a browser:

1. Parse the HTML shell.
2. Parse `<script type="application/ld+json">`.
3. Detect common embedded state objects.
4. Inspect `script[src]` and link relations.
5. Inspect forms and explicit API/document links.
6. Look for same-origin public data URLs explicitly referenced by page content.
7. If a framework-specific payload is present and a safe adapter exists, parse it.
8. Rank discovered data resources against the query.
9. Fetch only the most relevant public resources.

### Framework-specific adapters

Framework-specific adapters may be added, but must not become mandatory dependencies.

Examples of useful adapter targets include:

- Next.js application payloads;
- Nuxt payloads;
- standard JSON REST endpoints;
- GraphQL responses when the public endpoint is explicitly discoverable and usable without authentication;
- other common SSR/SPA data payloads.

### Do not rely on undocumented private endpoints as a requirement

The crawler may use a publicly exposed HTTP resource discovered from the site, but it must not:

- bypass authentication;
- forge credentials;
- bypass authorization;
- defeat anti-bot controls;
- access hidden/private backend endpoints;
- exploit internal framework behavior to reach data the site does not publicly expose.

### Why this matters for exam platforms and application sites

A site such as an online exam/question platform may show a rich interface while the actual questions arrive from JSON or another HTTP data endpoint. The retrieval engine must therefore treat the browser-facing page as a **discovery surface**, not necessarily the source of truth.

The goal is:

```text
page shell
   ↓
discover public data representation
   ↓
fetch data representation
   ↓
extract question / explanation / metadata
```

not:

```text
page shell
   ↓
strip HTML
   ↓
"no useful text"
```

---

## 17. Public API discovery without a browser

The package should support a conservative form of public API discovery.

Possible signals:

- JSON URLs present in HTML;
- `<link>` and `<script>` references;
- form actions;
- `href` links;
- JSON-LD `mainEntity`, `sameAs`, `url`, or related properties;
- public API links in documentation;
- obvious `application/json` resources linked from the page;
- same-origin URLs explicitly present in embedded state.

### Do not perform arbitrary JavaScript execution in core

Executing arbitrary page JavaScript greatly increases:

- bundle size;
- memory usage;
- attack surface;
- latency;
- deployment difficulty;
- serverless incompatibility.

The default strategy is static/HTTP extraction first.

---

## 18. Optional browser mode

A browser renderer may be provided as a separate package or adapter.

Example:

```text
@yourorg/web-retriever
@yourorg/web-retriever-browser
```

The browser adapter is only for sites where:

```text
HTTP fetch
+
static extraction
+
public data discovery
```

are insufficient.

### Browser mode must be opt-in

Never make Chromium a mandatory dependency of the base installation.

### Browser mode must keep the same safety policy

A browser must not be used to:

- bypass login;
- bypass paywalls;
- bypass CAPTCHA;
- circumvent robots policy;
- evade anti-bot protections;
- access private network targets.

The browser is an extraction fallback, not a circumvention mechanism.

---

## 19. PDF support

PDF is a first-class document format, but PDF processing should be isolated so that users who never process PDFs do not carry unnecessary code.

Recommended architecture:

```text
@yourorg/web-retriever
        │
        └── optional PDF adapter
              └── unpdf / PDF.js
```

`unpdf` currently provides PDF text extraction, links, images, page-aware structured text, and a serverless PDF.js build, with zero runtime dependencies according to its npm package metadata. See https://www.npmjs.com/package/unpdf

### PDF pipeline

```text
HTTP response
   ↓
PDF signature / MIME check
   ↓
size limit
   ↓
page-count limit
   ↓
PDF metadata
   ↓
text extraction
   ↓
page-aware chunks
   ↓
query relevance ranking
   ↓
relevant passages
```

### Preserve page numbers

Every PDF evidence item must be able to say:

```json
{
  "sourceUrl": "https://example.com/report.pdf",
  "page": 17,
  "text": "...",
  "relevance": 0.95
}
```

Do not flatten a PDF into one anonymous blob if page-level information is available.

### PDF metadata

Extract when available:

- title;
- author;
- subject;
- keywords;
- creator;
- producer;
- creation date;
- modification date;
- page count.

Treat metadata as metadata, not proof of content.

### PDF safety

The PDF adapter must enforce:

- maximum file size;
- maximum page count;
- maximum decoded image dimensions;
- timeout;
- extraction cancellation;
- memory-conscious processing.

The `unpdf` documentation itself calls out page fan-out, image-size limits, and timeout concerns when processing untrusted PDFs. See https://www.npmjs.com/package/unpdf

---

## 20. Scanned PDF detection

A PDF may contain almost no extractable text because its pages are images.

Do not immediately OCR every PDF.

Use a cheap detection heuristic:

```text
extracted characters per page
+
ratio of text-bearing pages
+
presence of embedded images
```

Example policy:

```text
normal text density
→ regular extraction only

very low text density
→ candidate scanned document

only then
→ optional OCR path
```

Thresholds must be configurable and must not be treated as universal truth.

---

## 21. OCR is optional

OCR is useful, but it should never be a core dependency.

Recommended optional package:

```text
@yourorg/web-retriever-ocr
```

Tesseract.js currently runs in Node.js and browsers and wraps a WebAssembly port of Tesseract. It does **not** directly solve PDF processing; PDF pages should be rendered/extracted first and then passed to OCR when appropriate. See:

- https://www.npmjs.com/package/tesseract.js
- https://www.npmjs.com/package/unpdf

### OCR pipeline

```text
scanned PDF page
      ↓
render page to image
      ↓
OCR
      ↓
text + confidence
      ↓
query relevance
      ↓
retain only useful passages
```

### OCR requirements

- language packs must be loaded only when requested;
- OCR must be bounded by page count/time;
- OCR output must carry lower-confidence metadata when applicable;
- do not OCR irrelevant pages;
- do not OCR every image found on the page by default.

---

## 22. Raw image support

Raw images should be recognized as resources, not automatically treated as text documents.

For ordinary retrieval, collect:

- image URL;
- alt text;
- title attribute;
- surrounding heading/paragraph;
- OpenGraph metadata;
- figure caption;
- structured-data context.

This often provides enough semantic information without OCR.

### OCR an image only when justified

OCR may be used when:

```text
query strongly implies image text
OR
image is the primary candidate evidence
OR
alt/caption/context is insufficient
```

Never OCR every image on a site by default.

---

## 23. Tables and structured data

AI questions often target tables rather than prose.

The extractor should preserve tables where practical.

For HTML:

```text
<table>
  <tr><th>Year</th><th>Revenue</th></tr>
  <tr><td>2025</td><td>...</td></tr>
</table>
```

should become a structured representation such as:

```json
{
  "type": "table",
  "headers": ["Year", "Revenue"],
  "rows": [
    ["2025", "..."]
  ]
}
```

For PDFs, positioned text can be used to infer basic tabular structures, but the parser must not claim perfect table reconstruction.

---

## 24. Metadata extraction

Metadata should be extracted independently of the main-text parser.

At minimum:

```text
<title>
<meta name="description">
<meta name="author">
<meta property="og:title">
<meta property="og:description">
<meta property="og:image">
<meta property="article:published_time">
<meta property="article:modified_time">
<link rel="canonical">
<link rel="alternate">
JSON-LD / Schema.org
```

Recommended normalized type:

```ts
export interface PageMetadata {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  author?: string;
  publishedAt?: string;
  modifiedAt?: string;
  imageUrl?: string;
  siteName?: string;
  language?: string;
  contentType?: string;
  schemaTypes?: string[];
}
```

Metadata can help ranking, but should not silently override page content.

---

## 25. Link extraction

Links are a primary navigation mechanism.

Extract:

```text
<a href>
<link href>
<img src>
<iframe src>
<script src>
<source src>
<form action>
```

However, **not all discovered URLs are crawl candidates**.

Default to:

- same-origin HTTP(S) pages;
- same-site documents;
- explicit user-configured related domains;
- PDFs and structured resources;
- feeds/sitemaps;
- high-value linked assets.

Do not automatically crawl:

- every JS bundle;
- every image;
- fonts;
- analytics;
- advertisements;
- tracking URLs;
- infinite calendar/query parameter combinations;
- logout/authentication links;
- action endpoints that mutate state.

---

## 26. URL normalization

URL normalization must preserve semantics.

Safe normalization may include:

- lowercasing hostname;
- removing default HTTP/HTTPS ports;
- resolving relative URLs;
- removing fragments for resource identity when the fragment does not identify server content;
- punycode normalization where appropriate;
- normalizing path dot-segments.

Tracking parameters may be removed from the **deduplication key**, but do not blindly remove all query parameters.

Potential tracking parameters include:

```text
utm_source
utm_medium
utm_campaign
utm_term
utm_content
fbclid
gclid
msclkid
```

But query parameters such as:

```text
?page=2
?id=123
?lang=bn
?section=chemistry
```

may be semantically meaningful and must be preserved.

---

## 27. Deduplication

The system should deduplicate at multiple levels.

### URL-level

Normalize URLs first.

### Canonical-level

If multiple pages declare the same canonical URL, treat them as a logical source group.

### Content-level

Use lightweight fingerprints such as:

- normalized title hash;
- normalized text hash;
- shingles / simhash-like signatures;
- obvious boilerplate similarity.

Do not use embeddings merely for deduplication.

---

## 28. Query planning without AI

The package should not spend an LLM call deciding how to retrieve a page.

Use deterministic query classification.

Potential signals:

```text
latest
current
today
recent
version
release
news
price
specification
documentation
API
error
paper
research
report
exam
question
solution
```

Classifiers can set retrieval behavior:

```ts
interface QueryIntent {
  freshness: "low" | "medium" | "high";
  technical: boolean;
  scholarly: boolean;
  newsLike: boolean;
  documentLike: boolean;
  structuredDataLike: boolean;
}
```

This is heuristic guidance, not a truth classifier.

---

## 29. Query expansion without AI

Generate only a small number of deterministic variants.

Example:

```text
original:
How does Next.js caching work?

variants:
How does Next.js caching work
"Next.js" caching
Next.js caching documentation
Next.js caching middleware
```

Do not generate dozens of variants.

The package is intentionally request-budget constrained.

The host may disable query expansion entirely when a single URL is already highly authoritative.

---

## 30. Candidate URL scoring

URL discovery and content ranking are separate stages.

A candidate URL can be scored with a lightweight deterministic function.

Example conceptual score:

```text
urlScore =
    pathTokenMatch
  + titleMatch
  + queryCoverage
  + extensionPrior
  + sitemapFreshness
  + parentPathRelevance
  + sameOriginBonus
  - boilerplatePenalty
  - duplicatePenalty
```

Do not hard-code the example weights as immutable truth. They must be benchmarked and tuned against evaluation data.

---

## 31. Local text ranking

The package should use an inexpensive deterministic text-ranking mechanism such as BM25 or a similarly lightweight term-frequency/inverse-document-frequency method.

Recommended field weighting:

```text
title       × high weight
headings    × high weight
metadata    × medium weight
body        × normal weight
URL tokens  × low/medium weight
```

The implementation should preserve term positions when possible for phrase-aware matching.

### No embedding model required

Do not download or execute a semantic embedding model merely to rank ordinary website passages.

This is one of the largest ways to preserve package lightweightness.

---

## 32. Passage extraction

The AI should not receive an entire 100 KB page if only one paragraph matters.

Pipeline:

```text
clean document
   ↓
heading-aware sections
   ↓
paragraph/list/table chunks
   ↓
local query scoring
   ↓
top passages
```

Each passage should carry provenance.

Example:

```json
{
  "sourceUrl": "https://example.com/docs/cache",
  "title": "Caching",
  "section": "Request Memoization",
  "text": "...",
  "relevance": 0.97
}
```

For PDF:

```json
{
  "sourceUrl": "https://example.com/report.pdf",
  "page": 17,
  "section": "Revenue",
  "text": "...",
  "relevance": 0.95
}
```

---

## 33. Source quality and diversity

Do not make a universal ranking such as:

```text
.gov = always good
.com = always bad
```

Instead use contextual heuristics.

Examples:

- official documentation is especially valuable for API behavior;
- government sources can be primary sources for government statistics;
- original research papers are valuable for scientific claims;
- the original publisher is preferable to copied summaries when available;
- a community forum can be valuable for practical troubleshooting;
- a search result aggregator may be weaker than the underlying source.

### Source diversity

Do not return five near-identical mirrors when three independent source domains are available.

Use a diversity penalty/boost based on hostname/domain grouping.

Do not treat source agreement as proof of truth. It is only an evidence-quality signal.

---

## 34. Evidence agreement without an LLM

The system may compute basic agreement signals.

Example:

```text
Source A → release date = July 4
Source B → release date = July 4
Source C → release date = July 5
```

Return something like:

```json
{
  "agreement": "mixed"
}
```

Do not infer the correct date purely from frequency.

The AI receives the competing evidence and can explain the conflict.

---

## 35. Freshness handling

Freshness matters for queries such as:

```text
latest release
current price
today's news
current documentation
recent announcement
```

Use available signals:

- HTTP `Last-Modified`;
- `ETag` / conditional requests;
- sitemap `lastmod`;
- page published/modified metadata;
- RSS/Atom timestamps;
- visible article dates.

Never treat any single timestamp as guaranteed truth.

---

## 36. HTTP fetching pipeline

The fetch layer is a security boundary.

```text
URL
 ↓
parse
 ↓
validate scheme
 ↓
resolve hostname
 ↓
check IP safety
 ↓
robots policy
 ↓
request budget
 ↓
timeout controller
 ↓
fetch
 ↓
response-size limit
 ↓
content-type detector
 ↓
adapter
```

### Recommended default budgets

These are initial engineering defaults, not universal constants:

```text
max internal HTTP requests: 8
max concurrent requests:    3
max pages fetched:          6
max traversal depth:        1
standard HTML size:         2 MiB
PDF size:                   15 MiB
request timeout:            8 s
connection timeout:         3 s where separately controllable
max redirects:              5
```

The limits must be configurable.

### Adaptive budgets

A future enhancement may increase/decrease the budget based on retrieval quality, but the logic must remain deterministic.

Example:

```text
first pass
 ↓
retrieval evidence strong
 ↓
STOP
```

versus:

```text
first pass
 ↓
no relevant evidence
 ↓
search sitemap candidate set more deeply
 ↓
fetch one additional candidate
```

Do not automatically escalate to large-scale crawling.

---

## 37. HTTP conditional requests and caching

Use caching to reduce both latency and website load.

The fetch layer should understand:

```text
ETag
If-None-Match
Last-Modified
If-Modified-Since
Cache-Control
Expires
```

Where appropriate, a later request may use a conditional request and receive `304 Not Modified`.

The package should expose a generic cache adapter rather than requiring Redis/SQLite.

Example:

```ts
export interface CacheAdapter {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry, ttlMs?: number): Promise<void>;
  delete?(key: string): Promise<void>;
}
```

Default cache:

```text
in-memory only
```

Optional host cache:

```text
filesystem
SQLite
Redis
KV store
Postgres
```

The core package must not require any of them.

---

## 38. Site-local crawl index

A persistent site index is optional and should be created by the host application when useful.

Example concept:

```ts
const index = await buildSiteIndex("https://docs.example.com");
```

It stores metadata such as:

```text
URL
canonical URL
title
description
headings
content type
lastmod
content hash
language
```

It does **not** need to store the complete body of every page.

The purpose is primarily:

1. deterministic URL correction;
2. candidate URL ranking;
3. repeated retrieval over the same site;
4. reduced HTTP requests on subsequent queries.

### Important distinction

This is:

```text
site-local index
```

not:

```text
global Internet search index
```

That distinction must remain explicit throughout the project.

---

## 39. Optional offline indexing

A useful CLI mode may be added:

```bash
npx web-retriever index https://docs.example.com
```

Then:

```ts
const index = await loadIndex("./docs-example.index");
const results = await searchIndex(index, "authentication middleware");
```

This is useful for:

- documentation sites;
- knowledge bases;
- exam/question banks;
- product catalogs;
- frequently queried public websites.

The local index should remain optional and portable.

---

## 40. Next.js integration

The package is intended to run in the Node/server side of Next.js applications.

Current Next.js documentation lists Node.js 20.9+ as a baseline requirement. See: https://nextjs.org/learn/react-foundations/installation

As of September 2026, Node.js 24 and 22 are LTS release lines. The Node.js release documentation currently lists Node.js 24 and 22 as LTS and Node.js 26 as Current. See: https://nodejs.org/en/about/previous-releases

### Recommended package target

Use:

```json
{
  "engines": {
    "node": ">=20.9"
  }
}
```

or choose a narrower LTS baseline if implementation/testing requires it.

Do not make Edge runtime compatibility a requirement for every feature.

PDF parsing, OCR, filesystem-backed caches, and browser adapters can require Node runtime features.

---

## 41. Edge runtime strategy

The core interfaces should remain as runtime-neutral as reasonably possible, but feature support may differ.

### Core should prefer

- `fetch`;
- `URL`;
- `AbortController`;
- Web-standard streams where practical;
- `crypto` APIs only where needed;
- no filesystem requirement.

### Node-only / optional features may include

- persistent filesystem cache;
- native DNS/IP inspection;
- browser automation;
- heavyweight PDF/OCR operations.

Do not force an Edge-specific implementation onto all deployments merely to claim universal runtime support.

---

## 42. AI tool schema

The model should receive one high-level tool.

Recommended schema:

```json
{
  "name": "web_retrieve",
  "description": "Retrieve relevant public web evidence starting from a supplied URL. The tool may navigate within the site using robots.txt, sitemaps, feeds, links, structured data, and public document/data resources. It returns source-backed passages and never requires a search API.",
  "parameters": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "Starting public HTTP(S) URL. This may be a site root, documentation root, document URL, or likely page URL."
      },
      "query": {
        "type": "string",
        "description": "What information should be retrieved from or within the site."
      },
      "max_pages": {
        "type": "integer",
        "minimum": 1,
        "maximum": 10
      }
    },
    "required": ["url", "query"]
  }
}
```

The exact schema may be simplified further depending on the provider.

OpenAI's current API documentation supports custom function tools and JSON-schema-described parameters; Gemini's current documentation supports function calling where the application executes the function and returns its result. See:

- OpenAI tools/function calling: https://developers.openai.com/api/docs/guides/tools
- OpenAI function calling: https://developers.openai.com/api/docs/guides/function-calling
- Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling

---

## 43. OpenAI integration philosophy

The package does not need the OpenAI SDK.

The application can expose the JSON Schema as a custom function/tool.

Conceptually:

```text
OpenAI model
   ↓
web_retrieve({url, query})
   ↓
host Node process
   ↓
@yourorg/web-retriever
   ↓
compact evidence JSON
   ↓
OpenAI model
```

The package should never require users to route through your service.

---

## 44. Gemini integration philosophy

Same architecture:

```text
Gemini model
   ↓
function call
   ↓
host application executes retrieve()
   ↓
returns JSON
   ↓
Gemini continues
```

No Gemini SDK dependency belongs in the core package.

Gemini's official function-calling documentation explicitly places function execution responsibility on the application, which maps directly to this architecture: https://ai.google.dev/gemini-api/docs/function-calling

---

## 45. MCP integration

An optional MCP adapter can expose:

```text
web_retrieve
```

without modifying the retrieval core.

MCP should be treated as an integration layer, not the implementation of the crawler.

The core package remains:

```text
retrieve()
```

and MCP is:

```text
MCP server → retrieve()
```

---

## 46. Determinism requirements

Given the same:

```text
URL
query
configuration
site responses
cache state
```

the algorithm should produce the same result ordering, unless an upstream response itself changes.

Do not use:

- random sampling;
- model-generated ranking;
- temperature-based decisions;
- hidden telemetry services;
- time-based randomization.

Time-dependent signals such as freshness are allowed, but they must be explicit and deterministic.

---

## 47. What “accurate” means in this project

The package should optimize for:

1. finding the correct source;
2. finding the correct page/document within that source;
3. extracting the actual source content;
4. selecting the most relevant passages;
5. preserving provenance;
6. avoiding invented URLs;
7. surfacing conflicts rather than silently resolving them.

The package must not claim that deterministic retrieval proves that a statement is true.

A retrieved source can itself be wrong.

Therefore the result object should describe **retrieval confidence/evidence quality**, not a fabricated “truth score.”

---

## 48. What to return when evidence is weak

Do not manufacture an answer.

Return:

```json
{
  "status": "partial",
  "evidence": [],
  "navigation": {
    "resolved": false
  },
  "diagnostics": {
    "reason": "no_relevant_public_resource_found"
  }
}
```

The AI can then decide whether to tell the user that the source was insufficient or request another starting URL.

---

## 49. What to do with a 404

A 404 is not necessarily the end of retrieval.

Attempt safe deterministic correction using:

```text
canonical
redirect history
sitemap
feed
links
site-local index
path similarity
```

But only return a corrected URL when it is observed in site data and passes the strict threshold.

Never perform speculative path construction beyond the configured safe rules.

---

## 50. What to do with a JavaScript-heavy page

Preferred sequence:

```text
1. HTTP response
2. metadata
3. embedded state
4. linked public JSON/XML/data
5. sitemap/feed
6. related pages
7. optional browser adapter
```

Do not jump directly from:

```text
HTML shell
```

to:

```text
Chromium
```

The browser is the last-resort extraction mechanism.

---

## 51. What not to fetch

The crawler should aggressively avoid irrelevant resources.

Default skip candidates:

```text
analytics
tracking pixels
advertisement URLs
fonts
large video files
maps tiles
CSS
source maps
third-party scripts
social widgets
websocket endpoints
binary assets unrelated to the query
```

Possible exceptions:

```text
image relevant to query
PDF relevant to query
JSON data resource relevant to query
```

The crawler is a **retriever**, not a browser simulator.

---

## 52. Robots and indexing directives

The implementation should understand, where practical:

- robots.txt;
- `<meta name="robots">`;
- `X-Robots-Tag`;
- `nofollow`/link relationship hints;
- `noarchive` where relevant to behavior;
- `nosnippet`/snippet controls when deciding what to return.

Do not equate every indexing directive with crawling prohibition.

For example, Google Search Central notes that robots.txt and indexing controls have different purposes. See https://developers.google.com/search/docs/crawling-indexing/robots/intro

The project should document its exact interpretation instead of pretending all crawlers behave identically.

---

## 53. SSRF protection

This is mandatory.

An AI-controlled URL is untrusted input.

Reject or carefully control destinations in private, loopback, link-local, and reserved address ranges.

At minimum consider:

```text
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
100.64.0.0/10
::1/128
fc00::/7
fe80::/10
```

and cloud metadata endpoints such as the common link-local metadata address.

### DNS rebinding defense

Perform destination validation close to connection time and revalidate after redirects.

Do not trust the hostname string alone.

### Redirect safety

Every redirect destination is a new security decision.

```text
public URL
 ↓
redirect
 ↓
validate destination again
 ↓
fetch only if safe
```

---

## 54. Request method safety

The default retrieval operation should prefer:

```text
GET
HEAD where genuinely useful
```

Avoid automatically issuing state-changing methods such as:

```text
POST
PUT
PATCH
DELETE
```

unless a separately designed adapter explicitly requires a safe public data API operation and the host opts into it.

The generic crawler must never accidentally trigger state changes.

---

## 55. Query parameters and state-changing URLs

Be careful with URLs such as:

```text
/delete?id=123
/logout
/checkout
/cart/add
/subscribe
```

These may look like ordinary links but can trigger actions in poorly designed sites.

The crawler should maintain a conservative denylist / heuristic classifier for likely action URLs.

When uncertain, do not follow automatically.

---

## 56. Rate limiting and politeness

The package must have:

```ts
maxConcurrentRequests
maxRequestsPerOrigin
minDelayMs
maxRequestsTotal
timeoutMs
```

and should support backoff on:

```text
429
503
408
connection resets
explicit crawl-delay
```

Do not hammer a site simply because a sitemap lists thousands of pages.

---

## 57. Response size limits

The package should reject or truncate oversized resources before allocating excessive memory.

Recommended conceptual limits:

```text
HTML:      2 MiB
JSON:      4 MiB
XML:       4 MiB
PDF:      15 MiB
Image:     8 MiB
Other:     reject unless explicitly allowed
```

These are starting defaults and must be configurable.

For streaming responses:

```text
read chunk
→ increment byte counter
→ abort when limit exceeded
```

Do not read an entire unbounded response into memory first.

---

## 58. Compression bombs and hostile documents

Do not assume a compressed response is safe because its transfer size is small.

Track effective decompressed size where possible.

For PDFs and archive-based formats, enforce both:

```text
compressed/input size
+
decoded/output size
```

and terminate processing when limits are exceeded.

---

## 59. HTML parser hardening

The parser should avoid:

- executing scripts;
- evaluating inline JS;
- network-loading arbitrary nested resources;
- traversing unbounded DOMs;
- processing huge inline SVG trees unnecessarily.

HTML parsing is for extraction, not execution.

---

## 60. XML security

Do not enable dangerous XML entity expansion or external entity resolution.

Sitemap/feed parsing should be hardened against:

- entity-expansion attacks;
- external entity access;
- recursive structures;
- oversized nesting.

The project does not need a generalized XML execution environment.

---

## 61. JSON security

Do not execute JSON as JavaScript.

Do not use:

```js
eval(json)
```

or equivalent behavior.

Parse JSON structurally.

Limit:

- body size;
- nesting depth;
- array sizes where needed.

---

## 62. Browser adapter security

If a browser adapter is added:

- keep network access constrained;
- disable dangerous local-file capabilities;
- maintain SSRF checks before navigation;
- revalidate redirects;
- limit downloads;
- never expose browser debugging ports externally by default.

The browser process must not silently become a new server or sidecar requirement.

---

## 63. Package structure

Recommended repository:

```text
packages/
  web-retriever/
    src/
      core/
        retrieve.ts
        planner.ts
        types.ts

      security/
        ssrf.ts
        redirect.ts
        ports.ts

      fetch/
        fetcher.ts
        limits.ts
        headers.ts
        retry.ts

      robots/
        parser.ts
        policy.ts

      discovery/
        sitemap.ts
        feeds.ts
        links.ts
        metadata.ts
        structured-data.ts
        application-data.ts

      formats/
        html.ts
        xml.ts
        json.ts
        text.ts
        markdown.ts
        pdf.ts          # optional adapter boundary
        image.ts

      extraction/
        readability.ts
        structured.ts
        passages.ts
        tables.ts

      ranking/
        tokenizer.ts
        bm25.ts
        url-score.ts
        source-score.ts
        dedupe.ts

      resolution/
        canonical.ts
        sitemap-resolver.ts
        url-repair.ts

      cache/
        interface.ts
        memory.ts

      index/
        interface.ts
        ephemeral.ts

      integrations/
        openai.ts
        gemini.ts
        mcp.ts

      index.ts

  web-retriever-pdf/

  web-retriever-ocr/

  web-retriever-browser/
```

Do not put optional dependencies in the core dependency graph merely because the source tree contains adapters.

---

## 64. Dependency strategy

The package should be deliberately boring.

### Likely core dependencies

- a small HTML/XML parser such as `htmlparser2`;
- Mozilla Readability or equivalent content extractor;
- minimal utility code owned by the project.

`htmlparser2` currently reports a small dependency footprint and MIT licensing. See https://www.npmjs.com/package/htmlparser2

`@mozilla/readability` currently reports zero runtime dependencies. See https://www.npmjs.com/package/@mozilla/readability

### PDF

Use an optional PDF package such as `unpdf`. Its current npm release reports zero runtime dependencies. See https://www.npmjs.com/package/unpdf

### OCR

Use optional Tesseract.js or another OCR package. Tesseract.js currently runs on Node.js and browser environments and wraps Tesseract via WebAssembly. See https://www.npmjs.com/package/tesseract.js

### Do not add dependencies for things Node already provides

Prefer built-ins for:

- HTTP fetch;
- URL parsing;
- AbortController;
- timers;
- hashing;
- basic collections;
- concurrency primitives where simple enough to implement locally.

---

## 65. Package size goals

The exact installed size must be measured from the actual lockfile and platform.

Target goals:

```text
core package:
  as small as reasonably possible

PDF support:
  opt-in

OCR support:
  opt-in

browser support:
  opt-in
```

Do not claim a specific MB value until CI measures:

```bash
npm pack
npm install --omit=dev
```

and the repository records the result.

The goal is not merely “small npm tarball.”

Also measure:

- installed dependency tree;
- cold start time;
- memory during retrieval;
- first-request latency;
- typical page-processing CPU time.

---

## 66. No telemetry by default

The package must not silently send telemetry to a project-owned server.

A basic installation should make outbound network requests only to:

- the requested target site;
- resources legitimately discovered from that site;
- explicitly configured providers/services.

Do not add:

```text
phone-home analytics
anonymous usage tracking
remote configuration
central crawl registry
license heartbeat
```

---

## 67. No hidden dependency on a project-owned service

A very important acceptance criterion:

> A developer should be able to disconnect every server controlled by the package author and still use the package for direct public web retrieval.

The package must not fail because:

```text
https://yourproject.com/service
```

is unavailable.

---

## 68. Caching philosophy

Caching is a performance feature and a politeness feature.

Default in-memory cache should be enough for small deployments.

Recommended conceptual TTLs:

```text
robots.txt       1 day
sitemap          1–6 hours
normal pages     15–60 minutes
PDF              1–6 hours
metadata         1 hour
```

The host can override these values.

Do not treat TTLs as guarantees about freshness.

---

## 69. AI conversation budget

The design should assume AI tool calls are expensive or rate-limited.

### Desired interaction

```text
User question
   ↓
AI decides retrieval is needed
   ↓
one web_retrieve tool call
   ↓
retriever performs internal HTTP navigation
   ↓
compact evidence returned
   ↓
AI answers
```

### Avoid

```text
AI → root fetch
AI → sitemap fetch
AI → page 1
AI → page 2
AI → PDF
AI → correction
AI → final answer
```

That is precisely the back-and-forth this project is meant to eliminate.

---

## 70. Internal request budget vs AI request budget

These are different.

### AI budget

Usually the host should target:

```text
1 retrieval tool call per research need
```

### HTTP budget

Inside that tool call:

```text
several small HTTP requests
```

may be acceptable.

The package should expose diagnostics so hosts can understand both.

---

## 71. Example end-to-end retrieval

### Input

```ts
await retrieve({
  url: "https://docs.example.com",
  query: "How is authentication middleware configured?"
});
```

### Internal behavior

```text
1. validate URL
2. fetch robots.txt
3. discover sitemap.xml
4. fetch root page
5. extract root metadata and links
6. parse sitemap URL list
7. score URLs containing authentication/middleware-related terms
8. fetch top candidate(s)
9. extract headings/body/metadata
10. rank passages with BM25
11. return top evidence
```

### Output

```json
{
  "status": "success",
  "sources": [
    {
      "url": "https://docs.example.com/auth/middleware",
      "title": "Authentication Middleware",
      "type": "html",
      "relevance": 0.94
    }
  ],
  "evidence": [
    {
      "sourceUrl": "https://docs.example.com/auth/middleware",
      "section": "Middleware",
      "text": "...",
      "relevance": 0.97
    }
  ]
}
```

---

## 72. Example: hallucinated child URL

### AI input

```ts
await retrieve({
  url: "https://example.com/docs/auth/security/middleware",
  query: "middleware configuration"
});
```

### Site says

```text
404
```

### Sitemap contains

```text
https://example.com/docs/authentication/middleware
```

### Retriever

```text
requested URL
   ↓
404
   ↓
sitemap
   ↓
candidate match
   ↓
strict URL similarity threshold
   ↓
fetch observed candidate
```

### Output

```json
{
  "navigation": {
    "requested": "https://example.com/docs/auth/security/middleware",
    "resolved": "https://example.com/docs/authentication/middleware",
    "method": "sitemap_match",
    "confidence": 0.94
  }
}
```

No LLM correction call is required.

---

## 73. Example: exam/question platform

A modern exam platform may return:

```text
HTML shell
+
JavaScript application
+
JSON question data
```

The retriever should attempt:

```text
1. root HTML
2. embedded JSON state
3. public JSON resources referenced by the page
4. same-origin public endpoints explicitly exposed by the page
5. sitemap / URL discovery
6. related question URLs
7. optional browser fallback
```

For a query such as:

```text
"What is the correct answer to question 42?"
```

the package may discover:

```text
/questions/42
/api/questions/42
exam/question/42
```

Only URLs actually observed or safely resolved from site-provided structures should be followed.

The package must not attempt to access hidden answer keys, authenticated endpoints, administrative APIs, or other data not publicly exposed.

---

## 74. Example: blog site

For a blog:

```text
root
 ↓
robots.txt
 ↓
RSS feed
 ↓
recent article URLs
 ↓
query match
 ↓
fetch article
 ↓
Readability
 ↓
passages
```

The feed may be a better discovery route than crawling category pages.

---

## 75. Example: PDF-heavy documentation site

```text
root
 ↓
robots.txt
 ↓
sitemap
 ↓
PDF URL candidates
 ↓
query match
 ↓
PDF text extraction
 ↓
page-specific ranking
 ↓
passage output with page number
```

OCR is only activated for likely scanned pages when explicitly enabled.

---

## 76. Example: JSON API site

For a public structured-data site:

```text
root page
 ↓
application data discovery
 ↓
public JSON endpoint
 ↓
JSON parser
 ↓
field-aware ranking
 ↓
evidence
```

The output can reference the JSON path:

```text
results[4].question
results[4].answer
```

This is preferable to forcing the AI to infer semantics from a rendered browser screenshot.

---

## 77. Example: site with no sitemap

No sitemap is not a failure.

Use:

```text
root page
 ↓
links
 ↓
feeds
 ↓
canonical/alternate resources
 ↓
structured data
 ↓
related same-origin pages
```

If the site gives the crawler no discoverable navigation path, return a partial/insufficient result instead of launching an uncontrolled crawl.

---

## 78. Example: site blocks crawling

If robots.txt or server behavior clearly blocks the configured crawler policy:

```text
status = blocked
```

Do not:

- change User-Agent to impersonate a search engine;
- rotate IP addresses through a proxy network;
- solve CAPTCHA;
- use a browser solely to evade the block;
- try alternate private endpoints.

Return the block state and let the host decide what to do.

---

## 79. Search index: explicit non-goal

The project should repeatedly state this in documentation because it is easy for future contributors/AI coding agents to misunderstand.

### We intentionally do NOT provide

```text
Internet-wide keyword index
Google-like ranking
global page database
continuous web crawl
hosted discovery engine
```

### We DO provide

```text
starting-URL retrieval
site-local discovery
targeted crawling
sitemap navigation
feed navigation
link navigation
public application-data discovery
local deterministic ranking
URL hallucination correction
PDF/text/image extraction
source-backed evidence
```

---

## 80. Why not build a global search index?

Because doing so conflicts with the product requirements.

A global index requires:

- continuous crawling;
- storage;
- distributed indexing;
- ranking computation;
- freshness management;
- duplicate detection at web scale;
- enormous bandwidth;
- abuse prevention;
- hosting.

None of that belongs in an npm helper package whose purpose is to sit inside a normal Next.js application.

---

## 81. Optional external search providers

The architecture may allow optional providers later:

```text
@yourorg/web-retriever-brave
@yourorg/web-retriever-mojeek
```

but they must be clearly marked as:

```text
optional
external
potentially paid
provider-specific
```

The base package must remain fully usable without them.

The core README should never imply that an external search API is required.

---

## 82. Why direct web retrieval is preferable here

The package author controls:

```text
fetching
parsing
ranking
deduplication
URL resolution
PDF handling
OCR decisions
security
request budgets
```

The package author does **not** need to control:

```text
global search index
```

This dramatically reduces infrastructure.

---

## 83. Failure model

Every stage should fail independently where possible.

Example:

```text
robots fetch failed
   ↓
may still fetch root under configured policy

sitemap unavailable
   ↓
fall back to links/feeds

Readability failed
   ↓
fall back to structural extraction

HTML empty
   ↓
inspect structured/application data

PDF text empty
   ↓
optional OCR

one page 403
   ↓
use other site candidates
```

Do not allow one parser/provider failure to collapse the entire retrieval process unless the missing stage is essential for safety.

---

## 84. Error taxonomy

Use machine-readable errors.

Recommended codes:

```text
INVALID_URL
UNSUPPORTED_SCHEME
SSRF_BLOCKED
ROBOTS_BLOCKED
RATE_LIMITED
DNS_FAILURE
TIMEOUT
HTTP_ERROR
REDIRECT_LIMIT
RESPONSE_TOO_LARGE
UNSUPPORTED_MEDIA_TYPE
PARSER_FAILED
PDF_LIMIT_EXCEEDED
OCR_DISABLED
BROWSER_DISABLED
NO_CANDIDATE
NO_RELEVANT_EVIDENCE
SITE_UNAVAILABLE
```

Do not expose raw stack traces to the LLM tool output by default.

---

## 85. Diagnostics

Diagnostics should be available separately from the evidence text.

Example:

```ts
interface RetrievalDiagnostics {
  durationMs: number;
  httpRequests: number;
  httpSuccesses: number;
  httpFailures: number;
  pagesFetched: number;
  candidateUrls: number;
  sitemapUrlsSeen: number;
  pdfsProcessed: number;
  ocrPages: number;
  cacheHits: number;
  cacheMisses: number;
  bytesDownloaded: number;
}
```

This is valuable for debugging and performance tuning.

---

## 86. Logging

Logging must be opt-in or minimal by default.

Useful events:

```text
retrieval started
URL validated
robots fetched
sitemap discovered
candidate selected
resource fetched
parser selected
URL resolved
retrieval completed
```

Never log full document bodies by default.

Never log secrets/cookies/auth headers.

---

## 87. Headers and identity

Send a descriptive user agent, for example:

```text
YourOrgWebRetriever/0.1 (+https://github.com/yourorg/web-retriever)
```

The final project URL can be chosen later.

If a host application needs to customize the User-Agent to identify its own product, support a configuration override while retaining a clear product identifier when practical.

---

## 88. Cookies and authentication

The default crawler should be **stateless and unauthenticated**.

Do not automatically reuse arbitrary browser cookies.

Do not ask users for website passwords.

If a host application intentionally wants authenticated retrieval for its own private content, that should be a separate explicitly designed feature and should not be mixed into the public-web default security model.

---

## 89. Content licensing and output limits

The retriever should favor:

```text
relevant excerpt
+
source URL
+
metadata
+
location/provenance
```

over returning the entire source.

This is both better for LLM context usage and safer from a content-reproduction standpoint.

The exact legal treatment of excerpts varies by jurisdiction and use case, so do not advertise a universal copyright exemption.

---

## 90. No claim of truth or legal permission

The package documentation must avoid claims such as:

```text
"Every result is true"
"Robots.txt makes crawling legal"
"Anything public can legally be scraped"
"The package is guaranteed legal worldwide"
```

Use precise language:

```text
"designed for conservative public-web retrieval"
"honors robots.txt by default"
"does not bypass access controls"
"returns source-backed evidence"
```

---

## 91. Recommended defaults

A first release can start with approximately:

```ts
const DEFAULTS = {
  maxPages: 6,
  maxDepth: 1,
  maxInternalRequests: 8,
  maxConcurrentRequests: 3,

  timeoutMs: 8000,
  maxHtmlBytes: 2 * 1024 * 1024,
  maxJsonBytes: 4 * 1024 * 1024,
  maxXmlBytes: 4 * 1024 * 1024,
  maxPdfBytes: 15 * 1024 * 1024,

  respectRobots: true,
  followSitemaps: true,
  followFeeds: true,
  followSameOriginLinks: true,

  enablePdf: false,
  enableOcr: false,
  enableBrowser: false,

  returnPassages: 5,
  returnSources: 5
} as const;
```

Treat these as initial defaults for benchmarking, not sacred constants.

---

## 92. Adaptive retrieval policy

An efficient implementation should not always consume its full budget.

### Fast stop

Stop when:

```text
at least one high-relevance authoritative passage exists
AND
source extraction succeeded
AND
no obvious contradiction requires additional coverage
```

### Escalation

Continue when:

```text
candidate pages are weak
OR
starting page is only a shell
OR
query terms do not appear in discovered content
OR
sources disagree
OR
a likely PDF/data resource has not been inspected
```

All escalation decisions should remain deterministic.

---

## 93. Retrieval modes

Optional convenience modes:

### `fast`

```text
1 discovery path
few pages
no OCR
no browser
```

### `balanced`

```text
sitemap/feed + links
several candidates
PDF when enabled
passage extraction
```

### `deep`

```text
broader candidate set
more pages
more structured-data inspection
optional PDF/OCR
optional browser fallback
```

The core algorithm remains the same; only budgets change.

---

## 94. Source-first evidence model

Every evidence item should map back to a source.

Recommended interface:

```ts
interface Evidence {
  sourceId: string;
  sourceUrl: string;
  title?: string;
  text: string;

  page?: number;
  section?: string;
  jsonPath?: string;

  relevance: number;
  sourceType: string;
}
```

This lets the LLM cite:

```text
According to the documentation...
```

without the package having to generate the final prose.

---

## 95. Evidence ordering

Recommended ordering:

```text
1. strongest relevant passage
2. strongest source
3. diverse confirming source
4. conflicting source if material
```

Do not over-return evidence.

The AI should receive enough to answer, not every retrieved token.

---

## 96. Handling multilingual pages

Do not hard-code English assumptions into the parser.

The package should preserve Unicode and normalize text without destroying scripts such as:

```text
বাংলা
العربية
中文
日本語
हिन्दी
русский
```

The tokenizer should support Unicode reasonably well.

Language-specific tokenization may be added later as optional adapters.

Do not silently transliterate all text to English.

---

## 97. Search terms in URLs

URL paths frequently contain useful semantics:

```text
/docs/react-server-components
/exams/hsc-physics/chapter-4
/reports/annual-report-2026.pdf
```

Use URL tokens in candidate ranking, but never assume that a meaningful URL guarantees meaningful content.

---

## 98. Structured data

Parse common Schema.org JSON-LD types such as:

```text
Article
NewsArticle
TechArticle
Product
FAQPage
Question
Answer
Course
Dataset
Event
HowTo
WebPage
```

The implementation should not hard-code correctness assumptions from schema type names.

Treat structured data as another source of navigation and metadata.

---

## 99. Feeds as a low-cost freshness layer

Blogs and news sites often expose RSS/Atom.

A feed can provide:

```text
title
URL
published time
updated time
summary
```

This is often enough to select the correct article before downloading multiple category pages.

Use feed URLs as candidate discovery, not necessarily as the final full-text source.

---

## 100. Public manifests and application metadata

Where present, inspect:

```text
manifest.json
site.webmanifest
OpenGraph
JSON-LD
alternate links
```

These can provide:

- canonical URLs;
- locale variants;
- icons/images;
- related URLs;
- application information.

Do not crawl every referenced asset.

---

## 101. Same-origin preference

By default, stay on the starting site's origin/domain.

External links may be returned as references but should not automatically trigger multi-domain crawling.

If the query clearly requires an external source and the host explicitly allows it, the application can pass:

```ts
allowDomains: ["example.org", "example.net"]
```

This keeps traversal predictable.

---

## 102. Cross-domain source policy

If a page links to:

```text
https://cdn.example.com/report.pdf
```

the package may need to fetch it even though it is a different host.

Therefore domain policy should distinguish:

```text
same origin
same registrable site
explicitly allowed external host
untrusted external host
```

A safe default is to allow a directly referenced document/resource on the same registrable site, subject to SSRF and robots policy, while requiring explicit configuration for broad external-domain traversal.

The exact implementation should be tested against legitimate CDN/document-hosting patterns.

---

## 103. Canonical and alternate URLs

When a document includes:

```html
<link rel="canonical" href="...">
```

record it.

For language alternatives:

```html
<link rel="alternate" hreflang="bn" href="...">
```

store them as related resources.

The query language can influence candidate ranking later, but the package should preserve all discovered language variants.

---

## 104. HTTP status handling

Meaningful statuses should be handled explicitly.

```text
200 → parse
204 → empty success
301/302/307/308 → validate redirect and follow within limit
304 → use cache
403 → blocked/forbidden
404 → try deterministic resolution
408 → timeout-like retry within strict policy
429 → rate-limited / backoff
5xx → temporary server failure
```

Do not blindly retry all errors.

---

## 105. Retry policy

Keep retries rare.

Recommended:

```text
1 retry for transient network failure
1 bounded retry for 503/429 after backoff if permitted
0 retries for 400/401/403/404 by default
```

Do not retry forever.

---

## 106. Concurrency policy

Use a small concurrency pool.

Default:

```text
3
```

The goal is not maximum throughput.

The goal is:

```text
fast enough
+
small resource footprint
+
polite retrieval
```

---

## 107. Memory policy

Avoid storing every fetched resource simultaneously.

Prefer:

```text
fetch candidate
→ extract
→ rank
→ retain only useful normalized representation
→ release raw body
```

When possible, process large files page-by-page/chunk-by-chunk.

---

## 108. Token efficiency for the AI

The package should optimize the response for LLM context.

Do not return:

```text
entire HTML
CSS
JavaScript
tracking markup
navigation boilerplate
```

Return:

```text
source metadata
relevant passages
locations
confidence/evidence fields
```

This keeps downstream token use low.

---

## 109. No hidden AI summarization

The retriever should not summarize a page with an LLM.

It may perform deterministic transformations such as:

- boilerplate removal;
- whitespace normalization;
- heading extraction;
- list normalization;
- table normalization;
- passage selection.

But semantic summarization belongs to the AI agent.

---

## 110. No hidden embedding model

Do not ship a transformer/embedding model in the core package.

Local lexical retrieval is sufficient for the base system.

A future optional semantic ranker can be added as:

```text
@yourorg/web-retriever-semantic
```

but it must not become a default requirement.

---

## 111. Acceptance criteria for v1

The v1 implementation should not be considered complete until all of the following work.

### Installation

```bash
npm install @yourorg/web-retriever
```

works with no extra service.

### Retrieval

```ts
retrieve({url, query})
```

can retrieve from a normal public site.

### Sitemap navigation

If a site exposes a sitemap, the retriever can use it to find relevant child URLs.

### No sitemap

If a site does not expose a sitemap, links/feed/metadata navigation still works.

### HTML

Normal article/docs pages produce useful passages.

### Non-article HTML

Reference pages, tables, directories, exam pages, and structured pages do not require Readability to succeed.

### JSON

A public JSON response can be parsed into evidence.

### XML/feed

RSS/Atom/XML resources can be parsed.

### PDF

Optional PDF module extracts page-aware text.

### Scanned PDF

Optional OCR can process selected pages.

### URL correction

A hallucinated URL can be corrected only to an observed site URL.

### SSRF

Private/internal destinations are rejected.

### Robots

Robots policy is enforced according to the configured crawler policy.

### AI compatibility

The same `retrieve()` result can be exposed to OpenAI, Gemini, Anthropic, or MCP without changing retrieval logic.

### No global index

The package operates without an Internet-wide search index.

---

## 112. Required automated test categories

The test suite should include:

### URL tests

- malformed URLs;
- relative URLs;
- fragments;
- tracking parameters;
- encoded paths;
- unicode URLs;
- punycode domains.

### SSRF tests

- localhost;
- loopback;
- private IPv4;
- private IPv6;
- link-local;
- metadata address;
- DNS rebinding simulation;
- redirects to private IPs.

### Robots tests

- allow;
- disallow;
- wildcard paths;
- multiple user-agent groups;
- sitemap directives;
- malformed robots files.

### Sitemap tests

- sitemap XML;
- sitemap index;
- nested indexes;
- plain-text sitemap;
- RSS/Atom;
- invalid XML;
- very large sitemap.

### HTML tests

- article;
- docs;
- tables;
- SPA shell;
- JSON-LD;
- canonical;
- broken HTML;
- huge script blocks.

### JSON tests

- nested objects;
- arrays;
- malformed JSON;
- huge nesting;
- field-path provenance.

### PDF tests

- normal text PDF;
- multi-page PDF;
- metadata;
- image-heavy PDF;
- scanned PDF;
- huge PDF;
- malformed PDF.

### URL repair tests

- exact match;
- canonical match;
- sitemap match;
- link match;
- strong path similarity;
- weak path similarity must reject.

### Rate-limit tests

- 429;
- repeated 503;
- timeout;
- concurrency exhaustion.

---

## 113. Evaluation dataset

Accuracy should be evaluated with a fixed benchmark set rather than intuition.

Create a test corpus across:

```text
technical docs
blogs
news
research papers
PDF reports
government sites
product docs
reference sites
JSON-backed apps
exam/question sites
multilingual sites
sites with/without sitemaps
sites with JS shells
sites with tables
```

For each case record:

```text
starting URL
query
expected source URL
acceptable alternative URLs
expected passage(s)
expected document type
```

Track:

```text
URL recall
source precision
passage precision
URL correction accuracy
false-correction rate
request count
latency
memory
bytes downloaded
```

A key metric is **false URL correction rate**. It should be extremely low.

---

## 114. Retrieval stopping criteria

A retrieval attempt should stop when:

```text
useful evidence found
OR
request budget exhausted
OR
no safe candidates remain
OR
site explicitly blocks retrieval
OR
all remaining candidates score below threshold
```

Do not crawl indefinitely because “more evidence might exist.”

---

## 115. What users should realistically expect

Users can expect:

- zero-key installation;
- targeted retrieval from a starting URL;
- sitemap-aware navigation;
- feed-aware navigation;
- HTML extraction;
- structured JSON/XML extraction;
- PDF support when installed/enabled;
- optional OCR;
- deterministic URL correction from site-provided evidence;
- compact source-backed passages;
- no required hosted search engine;
- no required LLM inside the package.

Users should **not** expect:

- Google-quality global discovery from arbitrary natural-language queries with no starting URL;
- guaranteed access to every website;
- content from pages behind authentication;
- bypass of paywalls/CAPTCHAs/anti-bot systems;
- browser-perfect rendering in the core package;
- perfect extraction from every custom web application;
- guaranteed legal permission for every imaginable use;
- a permanent Internet-wide index.

---

## 116. The most important limitation

The absence of a global index is deliberate.

If the AI starts with:

```text
https://example.com
```

this package can do an excellent job of navigating **example.com**.

If the AI has absolutely no clue which domain contains the answer, the package cannot magically know which site to query without some discovery source.

That is a fundamental information-retrieval limitation, not an implementation bug.

The correct solution is to allow the host application to optionally provide a discovery provider later, without making it required for the core package.

---

## 117. Optional discovery provider interface

If the host already has a legal/authorized search provider, allow:

```ts
interface DiscoveryProvider {
  search(
    query: string,
    options?: DiscoveryOptions
  ): Promise<DiscoveryResult[]>;
}
```

Then:

```ts
retrieve({
  url,
  query,
  discoveryProvider
})
```

can use external discovery only when the developer deliberately configures it.

This keeps the architecture extensible without making the core depend on a paid index.

---

## 118. Recommended implementation phases

### Phase 1 — core retrieval

Implement:

```text
fetcher
URL validation
SSRF protection
robots
HTML parser
metadata
links
sitemaps
feeds
URL normalization
BM25
passage extraction
result schema
```

### Phase 2 — application data

Implement:

```text
JSON
XML
JSON-LD
embedded application data
public endpoint discovery
structured tables
```

### Phase 3 — PDF

Add:

```text
PDF text
PDF metadata
PDF links
PDF page-aware ranking
```

### Phase 4 — OCR

Add optional:

```text
PDF page rendering
image OCR
language pack selection
```

### Phase 5 — site-local persistent index

Add:

```text
index builder
incremental updates
query-aware URL resolution
cache persistence
```

### Phase 6 — optional browser

Only after static retrieval is strong.

---

## 119. Recommended implementation order inside the codebase

Do not start with PDF or browser support.

Start with:

```text
1. URL/security layer
2. HTTP fetcher
3. robots
4. sitemap/feed discovery
5. HTML/JSON/XML extraction
6. URL normalization
7. candidate ranking
8. passage ranking
9. compact result formatting
10. tests
11. PDF
12. OCR
13. browser
```

Security and fetching must exist before crawler breadth.

---

## 120. Engineering principles for AI coding agents

Any AI agent modifying this repository must follow these rules:

### Rule 1
Never introduce a hosted service merely to solve a local retrieval problem.

### Rule 2
Never add an LLM call when deterministic parsing/ranking can solve the task.

### Rule 3
Never add a large dependency to the core package when the feature can be optional.

### Rule 4
Never assume HTML contains the actual application data.

### Rule 5
Never invent URLs.

### Rule 6
Never bypass robots, authentication, paywalls, CAPTCHA, or anti-bot controls.

### Rule 7
Never fetch untrusted AI-provided URLs without SSRF protection.

### Rule 8
Never turn the package into a global crawler/index.

### Rule 9
Never return an entire page when a few evidence passages are sufficient.

### Rule 10
Never silently add telemetry or a remote dependency.

### Rule 11
Never add browser automation to the core dependency graph.

### Rule 12
Preserve source provenance at every extraction stage.

---

## 121. Code review checklist for AI-generated changes

Before accepting a change, ask:

```text
Does this add a new network dependency?
Does this add a required service?
Does this increase core package size unnecessarily?
Does this make retrieval less deterministic?
Does this require an LLM?
Does this weaken SSRF protections?
Does this bypass a site's access controls?
Does this assume HTML instead of the actual response format?
Does this invent URLs?
Does this increase HTTP requests without measurable retrieval benefit?
Does this discard provenance?
Does this make Edge/Node compatibility worse without clear reason?
```

A “yes” should require explicit architectural justification.

---

## 122. Definition of done for a release

A release is ready only when:

- `npm install` works with no service setup;
- core retrieval works with no API key;
- no project-owned server is required;
- SSRF tests pass;
- robots tests pass;
- sitemap tests pass;
- HTML/JSON/XML extraction tests pass;
- PDF tests pass for the optional module;
- deterministic URL repair tests pass;
- no hallucinated URL is fabricated;
- request and response-size budgets are enforced;
- tool output is compact;
- source provenance is preserved;
- OpenAI/Gemini JSON schemas are generated from the same core tool definition;
- no hidden telemetry exists;
- no paid service is silently required.

---

## 123. Suggested README quick-start section once implementation exists

The final published README should eventually include a minimal usage section such as:

```bash
npm install @yourorg/web-retriever
```

```ts
import { retrieve } from "@yourorg/web-retriever";

const result = await retrieve({
  url: "https://docs.example.com",
  query: "How does authentication middleware work?"
});

console.log(result.sources);
console.log(result.evidence);
```

Optional PDF support:

```bash
npm install @yourorg/web-retriever-pdf
```

Optional OCR:

```bash
npm install @yourorg/web-retriever-ocr
```

Optional browser fallback:

```bash
npm install @yourorg/web-retriever-browser
```

The package should still be useful after installing only the core package.

---

## 124. Reference implementation philosophy

A future contributor should be able to understand the entire normal request path from a few files:

```text
retrieve.ts
fetcher.ts
robots.ts
sitemap.ts
html.ts
json.ts
bm25.ts
url-repair.ts
```

The architecture is intentionally small enough that the core algorithm remains auditable.

Avoid framework-sized abstractions for simple tasks.

---

## 125. What success looks like

The project succeeds if this is possible:

```text
Developer
   ↓
npm install
   ↓
Next.js app
   ↓
AI agent receives web_retrieve tool
   ↓
AI supplies main URL + question
   ↓
retriever performs deterministic navigation
   ↓
retriever discovers sitemap / feed / links / data
   ↓
retriever resolves bad URLs
   ↓
retriever handles HTML / JSON / XML / PDF / image evidence
   ↓
retriever ranks useful passages locally
   ↓
one compact tool result returns to the AI
   ↓
AI answers with citations/evidence
```

All without:

```text
search API
API key
login
SearXNG
Docker
secondary server
global index
LLM call inside the retriever
embedding model
```

---

## 126. The architectural one-liner

> **Give the AI a safe, deterministic web retriever that starts from a URL, navigates only as far as necessary, understands more than HTML, fixes URLs only from observed site data, and returns compact source-backed evidence—without requiring a search engine or a hosted service.**

---

## 127. Current verification references

These references were checked while preparing this specification. They are implementation/legal context, not guarantees that a future site, package, provider, or law will behave the same way.

### Web crawling / robots

- RFC 9309 — Robots Exclusion Protocol: https://www.rfc-editor.org/rfc/rfc9309.html
- Google Search Central — robots.txt: https://developers.google.com/search/docs/crawling-indexing/robots/intro
- Google Search Central — JavaScript SEO: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- Google Search Central — Dynamic rendering: https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering

### Sitemaps / feeds

- Sitemaps.org protocol: https://www.sitemaps.org/protocol.html

### AI tool calling

- OpenAI tools documentation: https://developers.openai.com/api/docs/guides/tools
- OpenAI function calling: https://developers.openai.com/api/docs/guides/function-calling
- Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling

### Parsing / extraction

- htmlparser2: https://www.npmjs.com/package/htmlparser2
- Mozilla Readability: https://www.npmjs.com/package/@mozilla/readability
- unpdf: https://www.npmjs.com/package/unpdf
- Tesseract.js: https://www.npmjs.com/package/tesseract.js

### Runtime

- Next.js / Node requirement reference: https://nextjs.org/learn/react-foundations/installation
- Node.js release schedule: https://nodejs.org/en/about/previous-releases

---

## 128. Final product boundary

Keep this boundary intact:

```text
                  INTERNET
                      │
                      │ public HTTP(S)
                      ▼
        ┌──────────────────────────────┐
        │       WEB RETRIEVER          │
        │                              │
        │  discover                    │
        │  fetch                       │
        │  parse                       │
        │  resolve                     │
        │  rank                        │
        │  extract evidence            │
        └──────────────┬───────────────┘
                       │
                       ▼
                 compact JSON
                       │
                       ▼
                     AI
```

The package does not become:

```text
Internet crawler company
search engine
proxy network
browser farm
AI answer service
hosted index provider
```

That boundary is what keeps the project lightweight, free to install, portable, and suitable for embedding directly into an application's existing runtime.
***********************************************
Important optional feature :
The search tool will be able to include https://search.parallel.ai/mcp and https://lite.duckduckgo.com/lite/ and https://html.duckduckgo.com/html/ and other tools including paid search indexes like google, brave etc which will be optional and user opt in. 
My version must be 100 % legally compliant and legal liability should fall on the implementation. They will be allowed to have lists of whitelisting or blacklisting or combination to prevent or allow going to some sites .
Not all apps rely on sitemap.xml only or even sitemap only. Make sure to account for all the ways pages in sites can be smartly invoked . And as for dynamically generated sites , which will have random strings in the url, account for that too . 

---

## 129. Confirmed architectural decisions (post-grilling session)

These decisions were settled during design review and are now non-negotiable constraints alongside the rules in §120.

---

### 129.1 URL guessing is Model A — the AI's responsibility

The library does **not** attempt to discover a starting domain from a raw natural-language query.

The AI model — using its own training knowledge or the optional `domainHints` config — is responsible for supplying a starting URL before calling `retrieve()`.

```ts
// AI resolves "react docs" → "https://react.dev" from its own knowledge
await retrieve({ url: "https://react.dev", query: "how does useEffect work?" })
```

The library's job begins at the URL. It does not end there — it performs full site-local discovery, ranking, and evidence extraction — but it does not invent or guess the starting domain.

**Why:** Keeps the core deterministic and dependency-free. Search-based discovery (SearXNG, Brave, DDG) remains available as optional `DiscoveryProvider` add-ons (§117) for applications that want it.

---

### 129.2 Domain hints config (v1 enhancement)

Developers may register known domain shortcuts at init time:

```ts
const retriever = createRetriever({
  domainHints: {
    "stripe": "https://stripe.com/docs",
    "react":  "https://react.dev",
    "nextjs": "https://nextjs.org/docs",
  }
})
```

The AI can consult this map before guessing blindly. This is a plain config object — not a database, not a crawl index. It may be expanded in later versions but must remain a simple key→URL map in v1.

---

### 129.3 Browser mode is a separate optional package — NOT for Vercel Free / serverless

Browser automation (Playwright/Puppeteer) is available only as the separate `web-retriever-browser` package.

It is explicitly **incompatible** with:

- Vercel Serverless Functions (50 MB bundle limit; Chromium is ~200–300 MB)
- Vercel Edge Functions (V8 isolate; no Node.js APIs)
- AWS Lambda default configuration
- Cloudflare Workers
- Any platform with a binary execution sandbox or a <60 s execution budget

It is **only supported** in long-running Node.js environments: VPS, Docker, Railway, Render, dedicated servers.

The core `web-retriever` package has zero browser dependency and runs correctly on Vercel Free tier, as it uses only `fetch()` and CPU-bound text processing.

```
web-retriever          ← works everywhere, including Vercel Free
web-retriever-browser  ← self-hosted Node.js only, not serverless
```

Any developer who installs `web-retriever-browser` in a Vercel Serverless or Edge deployment does so at their own risk. The package README must carry a prominent incompatibility warning.

**Why:** Chromium binary size, subprocess spawning, and cold-start latency make browser automation structurally incompatible with serverless infrastructure. This is an infrastructure constraint, not an implementation bug.

---

### 129.4 For pure client-side SPA pages with no extractable static data

When the core fetcher receives an HTML shell with no server-rendered content, no `__NEXT_DATA__`, no embedded JSON, no sitemap-linked static artifacts, and no accessible JSON API:

- Return a `JS_REQUIRED` typed error in the result
- Include the URL and whatever metadata was extractable (title, canonical, Open Graph)
- Do **not** silently return empty evidence

```ts
// Result shape when a page requires JavaScript execution
{
  status: "JS_REQUIRED",
  url: "https://example.com/dashboard",
  meta: { title: "...", canonical: "..." },
  evidence: []
}
```

This gives the calling AI enough information to tell the user why retrieval was partial, and optionally to escalate to the `web-retriever-browser` adapter if available.

---

### 129.5 PDF is a runtime-flag feature in the core package; OCR is a peer package

| Feature | Packaging | Activation |
|---------|-----------|------------|
| PDF text extraction (`unpdf`, ~0 runtime deps) | Ships inside `web-retriever` | `options: { pdf: true }` |
| OCR (`tesseract.js`, ~30 MB WASM) | Separate `web-retriever-ocr` package | Install + register as `OcrProvider` |

PDF is included in core because `unpdf` has zero runtime dependencies and PDF retrieval is broadly useful. OCR is separated because Tesseract.js is large and only needed for scanned documents.

---

### 129.6 Four stable plugin interfaces (required for add-on ecosystem)

These interfaces must be defined in v1 and treated as semver-stable. Breaking them is a major version bump.

```ts
/** Replace or augment the HTTP fetch layer (e.g. browser adapter) */
interface FetchOverride {
  fetch(url: string, options: FetchOptions): Promise<FetchResponse>
}

/** Register a content extractor for a MIME type (e.g. PDF, DOCX) */
interface ContentExtractor {
  mimeTypes: string[]
  extract(response: FetchResponse, options: ExtractOptions): Promise<ExtractionResult>
}

/** Provide candidate URLs from an external search index */
interface DiscoveryProvider {
  search(query: string, options?: DiscoveryOptions): Promise<DiscoveryResult[]>
}

/** Replace the default BM25 ranker (e.g. embedding-based reranker) */
interface RankingOverride {
  rank(candidates: Candidate[], query: string): Promise<Candidate[]>
}
```

No add-on package may bypass these interfaces to reach internal library state directly.

---

### 129.7 Complete implementation task list

These tasks were derived from §118 (recommended phases) and §119 (recommended implementation order) and are the authoritative execution plan for v1.

**PHASE 0 — Repo & tooling bootstrap**
- [ ] 0.1 Init monorepo (pnpm workspaces): `packages/web-retriever`, `packages/web-retriever-pdf`, `packages/web-retriever-ocr`
- [ ] 0.2 Configure TypeScript (strict), ESLint, Prettier, Vitest across all packages
- [ ] 0.3 Set up CI pipeline (lint → typecheck → test on every push)
- [ ] 0.4 Write `CONTRIBUTING.md` with the 12 engineering rules from §120 as a mandatory checklist

**PHASE 1 — Security & fetch layer** *(must be implemented before all other phases)*
- [ ] 1.1 `security/ssrf.ts` — block private IPv4, IPv6, loopback, link-local, metadata IPs (§53)
- [ ] 1.2 `security/redirect.ts` — re-validate destination IP on every redirect hop; DNS rebinding defence (§53)
- [ ] 1.3 `security/ports.ts` — allowlist safe ports only (§54)
- [ ] 1.4 `fetch/fetcher.ts` — Node native `fetch`, User-Agent, timeout, AbortController, response size cap (§36, §57)
- [ ] 1.5 `fetch/limits.ts` — per-request byte limit, compression bomb detection (§57, §58)
- [ ] 1.6 `fetch/headers.ts` — canonical request headers, identity string (§87)
- [ ] 1.7 `fetch/retry.ts` — 429/503 back-off, max retry budget (§105)
- [ ] 1.8 Write SSRF test suite (localhost, loopback, private IPv4/IPv6, link-local, metadata, DNS rebind simulation, redirect-to-private) (§112)

**PHASE 2 — Robots & politeness**
- [ ] 2.1 `robots/parser.ts` — parse allow/disallow/wildcard/crawl-delay/sitemap directives (§52)
- [ ] 2.2 `robots/policy.ts` — enforce rules per configured User-Agent; cache robots per domain per session (§52)
- [ ] 2.3 `fetch/rate-limiter.ts` — per-domain request queue, crawl-delay respect, concurrency cap (§56, §106)
- [ ] 2.4 Write robots test suite (allow, disallow, wildcard, multi-agent, sitemap directive, malformed) (§112)
- [ ] 2.5 Write rate-limit test suite (429, repeated 503, timeout, concurrency exhaustion) (§112)

**PHASE 3 — URL layer**
- [ ] 3.1 `resolution/canonical.ts` — resolve relative URLs, strip tracking params, normalise trailing slash, handle punycode (§26)
- [ ] 3.2 `resolution/url-repair.ts` — repair hallucinated AI URLs using observed site URL set only; never invent (§9)
- [ ] 3.3 `resolution/sitemap-resolver.ts` — match candidate URL against sitemap entries using deterministic similarity signals (§9)
- [ ] 3.4 Write URL normalisation test suite (malformed, relative, fragments, tracking params, encoded paths, unicode, punycode) (§112)
- [ ] 3.5 Write URL repair test suite (exact match, canonical match, sitemap match, link match, strong path sim, weak path sim must reject) (§112)

**PHASE 4 — Content-type detection & core format adapters**
- [ ] 4.1 `formats/detect.ts` — MIME detection from Content-Type header first, magic bytes second, normalise aliases (§13)
- [ ] 4.2 `formats/html.ts` — parse with `htmlparser2`; Readability for articles; structured fallback for non-article pages (§15)
- [ ] 4.3 `formats/xml.ts` — generic XML parse; detect and route RSS/Atom to feed adapter (§14)
- [ ] 4.4 `formats/json.ts` — safe depth-limited parse, field-path provenance tracking (§14, §61)
- [ ] 4.5 `formats/text.ts` — plain text and Markdown passthrough with line provenance (§14)
- [ ] 4.6 `formats/feed.ts` — RSS/Atom item extraction with `pubDate`/`updated` freshness (§99)
- [ ] 4.7 Write HTML test suite (article, docs, tables, SPA shell, JSON-LD, canonical, broken HTML, huge script blocks) (§112)
- [ ] 4.8 Write JSON test suite (nested objects, arrays, malformed, huge nesting, field-path provenance) (§112)

**PHASE 5 — Discovery pipeline**
- [ ] 5.1 `discovery/sitemap.ts` — fetch sitemap from robots + well-known paths; handle sitemap index (lazy — never fully materialise huge indexes); parse `lastmod` (§10, §11)
- [ ] 5.2 `discovery/feeds.ts` — discover RSS/Atom via `<link>` tags and well-known paths (§10)
- [ ] 5.3 `discovery/links.ts` — extract same-origin links from HTML; deduplicate; normalise (§25)
- [ ] 5.4 `discovery/metadata.ts` — extract `<title>`, `<meta>` description, Open Graph, Twitter Card, `<link rel="canonical">` (§24)
- [ ] 5.5 `discovery/structured-data.ts` — extract JSON-LD, microdata, RDFa (§98)
- [ ] 5.6 `discovery/application-data.ts` — extract `__NEXT_DATA__`, `__NUXT__`, embedded JSON blobs, `<script type="application/json">` (§16)
- [ ] 5.7 Write sitemap test suite (sitemap XML, sitemap index, nested index, plain-text sitemap, RSS/Atom, invalid XML, very large sitemap) (§112)

**PHASE 6 — Ranking & passage extraction**
- [ ] 6.1 `ranking/tokenizer.ts` — whitespace + punctuation tokenizer, stopword list, stemming (§31)
- [ ] 6.2 `ranking/bm25.ts` — BM25 over the candidate URL set; no embedding model (§31)
- [ ] 6.3 `ranking/url-score.ts` — deterministic URL relevance signals: path tokens, depth, `lastmod`, file type (§30)
- [ ] 6.4 `ranking/source-score.ts` — source quality and diversity scoring (§33)
- [ ] 6.5 `ranking/dedupe.ts` — URL-level, canonical-level, and content-level deduplication (§27)
- [ ] 6.6 `extraction/passages.ts` — extract top-k scored passages with byte offsets and source URL provenance (§32)
- [ ] 6.7 `extraction/tables.ts` — extract tables as row-oriented structured evidence (§23)
- [ ] 6.8 `extraction/structured.ts` — non-Readability structured page extraction (reference pages, directories, exam pages) (§15)

**PHASE 7 — Query planning (no AI)**
- [ ] 7.1 `core/planner.ts` — expand query into tokens + synonyms deterministically (§28, §29)
- [ ] 7.2 `core/planner.ts` — select retrieval mode (`fast` / `balanced` / `deep`) based on query signal (§93)
- [ ] 7.3 `core/planner.ts` — stopping criteria: enough evidence, budget exhausted, or no new candidates (§114)

**PHASE 8 — Core `retrieve()` orchestrator**
- [ ] 8.1 `core/types.ts` — define all public TypeScript types: `RetrieveInput`, `RetrieveResult`, `Evidence`, `SourceRef`, `RetrieveError`, `DiscoveryProvider`, `FetchOverride`, `ContentExtractor`, `RankingOverride` (§7, §8, §129.6)
- [ ] 8.2 `core/retrieve.ts` — wire the full pipeline: validate → SSRF check → robots → sitemap/feed/link discovery → fetch root → detect type → extract → build candidate set → rank → fetch top candidates → extract passages → dedupe → return result (§6)
- [ ] 8.3 `core/retrieve.ts` — implement `domainHints: Record<string, string>` at init (§129.2)
- [ ] 8.4 `core/retrieve.ts` — return `JS_REQUIRED` typed signal for SPA-shell pages with no extractable data (§129.4)
- [ ] 8.5 `cache/memory.ts` — in-process ephemeral cache scoped to a single retrieve session (§68)
- [ ] 8.6 `cache/interface.ts` — stable `CacheProvider` interface for host-injected persistent cache (§68)
- [ ] 8.7 Write end-to-end retrieval tests covering the canonical examples in §71–§78

**PHASE 9 — AI adapter layer**
- [ ] 9.1 `integrations/openai.ts` — JSON Schema tool definition + response formatter for OpenAI function calling (§42, §43)
- [ ] 9.2 `integrations/gemini.ts` — Gemini function declaration adapter (§44)
- [ ] 9.3 `integrations/anthropic.ts` — Anthropic tool_use adapter (§42)
- [ ] 9.4 `integrations/mcp.ts` — optional MCP stdio adapter; separate entry point; zero effect on core bundle (§45)
- [ ] 9.5 `index.ts` — public package exports; core must not pull in any AI SDK (§2.5)

**PHASE 10 — PDF (ships in core, opt-in at runtime)**
- [ ] 10.1 `formats/pdf.ts` — integrate `unpdf`; extract text with page numbers; extract metadata and links (§19)
- [ ] 10.2 `formats/pdf.ts` — scanned PDF detection (image-only page heuristic) → emit `SCANNED_PDF` signal (§20)
- [ ] 10.3 `formats/pdf.ts` — safety: size cap, page cap, deflate-bomb protection (§19)
- [ ] 10.4 Register PDF extractor via `ContentExtractor` interface so core invokes it only when `pdf: true` (§129.5)
- [ ] 10.5 Write PDF test suite (text PDF, multi-page, metadata, image-heavy, scanned, huge, malformed) (§112)

**PHASE 11 — OCR (separate `web-retriever-ocr` package)**
- [ ] 11.1 Integrate `tesseract.js` (WASM); expose `OcrProvider` interface (§21)
- [ ] 11.2 Scanned PDF OCR pipeline: render selected pages → OCR → rejoin with page provenance (§21)
- [ ] 11.3 Raw image OCR: only when content-type is image and no text was extractable (§22)
- [ ] 11.4 Language pack selection config (§21)

**PHASE 12 — Optional discovery add-on packages**
- [ ] 12.1 `web-retriever-searxng` — implements `DiscoveryProvider`; takes SearXNG base URL (§117)
- [ ] 12.2 `web-retriever-brave` — implements `DiscoveryProvider`; Brave Search API (§117)
- [ ] 12.3 `web-retriever-ddg` — implements `DiscoveryProvider`; DuckDuckGo HTML/lite scraper, best-effort (§117)
- [ ] 12.4 `web-retriever-parallel-ai` — implements `DiscoveryProvider`; wraps https://search.parallel.ai/mcp (§117)

**PHASE 13 — Site-local persistent index (opt-in)**
- [ ] 13.1 `index/interface.ts` — stable `IndexProvider` interface (§38)
- [ ] 13.2 `index/ephemeral.ts` — in-memory session index (default, zero config) (§38)
- [ ] 13.3 Optional file-backed index: incremental update, query-aware URL pre-selection (§39)

**PHASE 14 — Observability & diagnostics**
- [ ] 14.1 `diagnostics/logger.ts` — structured logger, off by default, no telemetry, no remote calls (§66, §86)
- [ ] 14.2 `diagnostics/errors.ts` — full error taxonomy as typed discriminated union (§84)
- [ ] 14.3 `diagnostics/trace.ts` — per-retrieve trace object: every URL tried, result, timing, reason dropped (§85)

**PHASE 15 — Acceptance criteria verification (§111)**
- [ ] 15.1 `npm install` works with zero extra services
- [ ] 15.2 `retrieve({url, query})` succeeds on a real public site
- [ ] 15.3 Sitemap navigation works
- [ ] 15.4 Fallback link/feed navigation works when no sitemap
- [ ] 15.5 HTML article produces useful passages
- [ ] 15.6 Non-article HTML (tables, reference, structured) works without Readability
- [ ] 15.7 JSON response produces evidence
- [ ] 15.8 RSS/Atom/XML parses correctly
- [ ] 15.9 PDF module extracts page-aware text
- [ ] 15.10 OCR module processes scanned PDFs
- [ ] 15.11 Hallucinated URL is corrected to an observed site URL only
- [ ] 15.12 SSRF: private/internal destinations are rejected
- [ ] 15.13 Robots policy is enforced
- [ ] 15.14 Same `retrieve()` result works with OpenAI, Gemini, Anthropic adapters
- [ ] 15.15 Package operates with no global search index

**PHASE 16 — Release**
- [ ] 16.1 Measure and document actual installed size per package (§65)
- [ ] 16.2 Audit all dependencies for license compatibility (§89)
- [ ] 16.3 Write public README quick-start section (§123)
- [ ] 16.4 Tag v1.0.0; publish `web-retriever` to npm; publish optional packages separately

---

### 129.8 Browser mode — final decision

Browser mode (`web-retriever-browser`) is **deprioritised for v1** and must never be added to the core package.

**Serverless/Vercel Free incompatibility is permanent:**

| Constraint | Detail |
|---|---|
| Vercel Free bundle limit | 50 MB compressed — Chromium is ~200–300 MB |
| Vercel Free execution timeout | 10 s — browser cold start alone is 3–8 s |
| Binary execution | Sandboxed on all serverless platforms; Chromium spawns subprocesses that are blocked |
| Edge Functions | V8 isolate only; no Node.js APIs at all |

The correct handling for JavaScript-heavy pages in v1 is the `JS_REQUIRED` signal (§129.4). A developer who needs browser rendering for a self-hosted Node.js deployment can install `web-retriever-browser` separately when it becomes available, and register it as a `FetchOverride`. It will never work in serverless.

**Sites that require a browser are mostly:**
- Authenticated dashboards (not retrievable anyway)
- Infinite-scroll SPAs with no SSR (niche)
- Cloudflare JS-challenge protected pages (not retrievable anyway)

The core library handles ~85–90% of real public websites without a browser.


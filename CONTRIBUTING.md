# CONTRIBUTING.md

## Engineering Rules (mandatory checklist for every change)

Every contribution — human or AI — must satisfy all 12 rules from §120 of
the specification before a change is accepted.  Check each one before
opening a PR.

---

### Rule 1 — No hosted services
Never introduce a hosted service (Docker container, Redis, Postgres, search
index, embedding API) to solve a local retrieval problem.  The retriever
must run inside the host Node.js process with zero external dependencies.

### Rule 2 — No LLM calls
Never add an LLM call when deterministic parsing, scoring, or ranking can
solve the task.  Every ranking and extraction step in this library is
intentionally LLM-free.

### Rule 3 — No large core dependencies
Never add a large dependency to the core package when the feature can be
optional.  PDF support uses `unpdf` (zero runtime deps).  OCR belongs in the
separate `web-retriever-ocr` package.  Browser automation belongs in
`web-retriever-browser`.

### Rule 4 — Do not assume HTML contains the data
Always run content-type detection before parsing.  The actual data may be
in a JSON API, embedded `__NEXT_DATA__`, XML feed, or PDF.

### Rule 5 — Never invent URLs
Every URL returned to the AI must come from one of:
- the original requested URL
- a URL observed in a server response
- a URL in a sitemap / feed / structured document
- a redirect or canonical relation from the server

No URL may be fabricated because a heuristic or language model thinks it
"probably exists".

### Rule 6 — Never bypass robots, auth, or anti-bot controls
Always fetch and cache `robots.txt` before crawling a domain.  Never impersonate
a browser User-Agent to bypass bot detection.  Never attempt to retrieve
content behind a login or CAPTCHA.

### Rule 7 — Always validate URLs before fetching
Every URL — including those from AI tool calls, sitemaps, feeds, and links —
must pass SSRF validation (`security/ssrf.ts`) before any network I/O.
Redirect destinations must be re-validated on every hop.

### Rule 8 — Never become a global crawler
The retriever is site-local.  It does not maintain a global URL index.  The
ephemeral candidate set is discarded at the end of each `retrieve()` call.

### Rule 9 — Never return a whole page
Return only the top-k most relevant evidence passages, not the full document.
The passage extractor in `extraction/passages.ts` enforces this.

### Rule 10 — No telemetry
Never add remote logging, analytics, error reporting, or usage tracking.
The logger (`diagnostics/logger.ts`) is off by default and only writes to
stderr — never to an external service.

### Rule 11 — No browser in core
Browser automation (`Playwright`, `Puppeteer`, `Chromium`) must never appear
in the `web-retriever` package dependency tree.  It lives in the separate
`web-retriever-browser` package, which is not compatible with serverless.

### Rule 12 — Preserve source provenance
Every extracted passage, table, or structured data item must carry the source
URL it came from.  Never discard provenance during extraction, ranking, or
result formatting.

---

## Code style

- TypeScript strict mode (`"strict": true`, `"exactOptionalPropertyTypes": true`,
  `"noUncheckedIndexedAccess": true`).
- No `any` casts.
- Comments explain *why* a decision was made, not *what* the code does
  line-by-line.
- All public functions and classes have JSDoc comments.
- Tests live alongside source in `tests/`.

## Before opening a PR

```
pnpm typecheck
pnpm lint
pnpm test
```

All three must pass with zero new warnings.

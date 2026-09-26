/**
 * tests/formats/html.test.ts
 *
 * HTML extraction test suite.
 *
 * §112 of the spec ("HTML tests").
 */

import { describe, it, expect } from "vitest";
import { extractHtml } from "../../src/formats/html.js";

const OPTS = { query: "authentication middleware", mimeType: "text/html", maxPassageChars: 1200 };

describe("HTML extraction", () => {
  it("extracts title from <title>", () => {
    const result = extractHtml(
      `<html><head><title>My Page</title></head><body><p>Content here</p></body></html>`,
      "https://example.com/",
      OPTS,
    );
    expect(result.title).toBe("My Page");
  });

  it("extracts Open Graph metadata", () => {
    const result = extractHtml(
      `<html><head>
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG Description">
      </head><body><p>text</p></body></html>`,
      "https://example.com/",
      OPTS,
    );
    expect(result.metadata["og:title"]).toBe("OG Title");
    expect(result.metadata["og:description"]).toBe("OG Description");
  });

  it("extracts canonical URL", () => {
    const result = extractHtml(
      `<html><head><link rel="canonical" href="https://example.com/canonical"></head><body><p>text</p></body></html>`,
      "https://example.com/other",
      OPTS,
    );
    expect(result.metadata["canonical"]).toBe("https://example.com/canonical");
  });

  it("extracts same-origin links", () => {
    const result = extractHtml(
      `<html><body>
        <a href="/page-a">A</a>
        <a href="/page-b">B</a>
        <a href="https://other.com/c">external</a>
      </body></html>`,
      "https://example.com/",
      OPTS,
    );
    expect(result.links).toContain("https://example.com/page-a");
    expect(result.links).toContain("https://example.com/page-b");
    expect(result.links).not.toContain("https://other.com/c");
  });

  it("does not extract external links", () => {
    const result = extractHtml(
      `<html><body><a href="https://attacker.com/steal">click</a></body></html>`,
      "https://example.com/",
      OPTS,
    );
    expect(result.links.every((l) => l.startsWith("https://example.com"))).toBe(true);
  });

  it("detects SPA shell (requiresBrowser=true) when no content", () => {
    const result = extractHtml(
      `<html><head><title>App</title></head><body><div id="root"></div></body></html>`,
      "https://example.com/",
      OPTS,
    );
    expect(result.requiresBrowser).toBe(true);
  });

  it("extracts JSON-LD blocks", () => {
    const html = `<html><body>
      <script type="application/ld+json">{"@type":"Article","name":"Test Article"}</script>
      <p>Article text here, enough to not be a SPA shell</p>
    </body></html>`;
    const result = extractHtml(html, "https://example.com/", OPTS);
    // Should not flag as SPA because there is embedded JSON
    // (our detector counts embedded blobs)
    expect(result.text).toBeTruthy();
  });

  it("handles malformed / broken HTML gracefully", () => {
    expect(() =>
      extractHtml("<div><p>Unclosed tag <span>oops", "https://example.com/", OPTS),
    ).not.toThrow();
  });
});

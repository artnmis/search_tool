/**
 * tests/resolution/canonical.test.ts
 *
 * URL normalisation test suite.
 *
 * §112 ("URL tests") of the spec.
 */

import { describe, it, expect } from "vitest";
import { normaliseUrl, isSameOrigin, isSameUrl } from "../../src/resolution/canonical.js";

describe("URL normalisation", () => {
  it("strips URL fragments", () => {
    expect(normaliseUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("removes default HTTP port 80", () => {
    expect(normaliseUrl("http://example.com:80/page")).toBe("http://example.com/page");
  });

  it("removes default HTTPS port 443", () => {
    expect(normaliseUrl("https://example.com:443/page")).toBe("https://example.com/page");
  });

  it("removes UTM tracking parameters", () => {
    const url = "https://example.com/page?utm_source=twitter&utm_medium=social&content=real";
    const result = normaliseUrl(url);
    expect(result).toContain("content=real");
    expect(result).not.toContain("utm_source");
    expect(result).not.toContain("utm_medium");
  });

  it("removes fbclid", () => {
    expect(normaliseUrl("https://example.com/?fbclid=abc123")).toBe("https://example.com/");
  });

  it("sorts remaining query parameters", () => {
    const a = normaliseUrl("https://example.com/?z=1&a=2");
    const b = normaliseUrl("https://example.com/?a=2&z=1");
    expect(a).toBe(b);
  });

  it("normalises bare domain with no path", () => {
    expect(normaliseUrl("https://example.com")).toBe("https://example.com/");
  });

  it("resolves a relative URL against a base", () => {
    expect(normaliseUrl("../other", "https://example.com/docs/page")).toBe(
      "https://example.com/other",
    );
  });

  it("returns null for non-http schemes", () => {
    expect(normaliseUrl("ftp://example.com/")).toBeNull();
    expect(normaliseUrl("javascript:void(0)")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(normaliseUrl("not a url at all")).toBeNull();
  });
});

describe("isSameOrigin()", () => {
  it("returns true for same origin", () => {
    expect(isSameOrigin("https://example.com/a", "https://example.com/b")).toBe(true);
  });

  it("returns false for different origin", () => {
    expect(isSameOrigin("https://other.com/a", "https://example.com/b")).toBe(false);
  });

  it("returns false for same host but different protocol", () => {
    expect(isSameOrigin("http://example.com/", "https://example.com/")).toBe(false);
  });
});

describe("isSameUrl()", () => {
  it("treats trailing slash and no trailing slash as the same", () => {
    expect(isSameUrl("https://example.com/page/", "https://example.com/page")).toBe(true);
  });

  it("treats UTM-stripped URLs as the same", () => {
    expect(
      isSameUrl(
        "https://example.com/page?utm_source=email",
        "https://example.com/page",
      ),
    ).toBe(true);
  });
});

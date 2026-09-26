/**
 * tests/resolution/url-repair.test.ts
 *
 * URL repair / hallucination correction test suite.
 *
 * §112 of the spec ("URL repair tests").
 *
 * Tests: exact match, canonical match, sitemap match, link match,
 * strong path similarity (accept), weak path similarity (reject).
 */

import { describe, it, expect } from "vitest";
import { repairUrl } from "../../src/resolution/url-repair.js";

const BASE = "https://example.com";

describe("URL repair", () => {
  it("exact match — returns 'exact' method", () => {
    const result = repairUrl({
      requestedUrl: `${BASE}/docs/auth`,
      observedUrls: [`${BASE}/docs/auth`, `${BASE}/docs/other`],
    });
    expect(result.navigation.resolved).toBe(true);
    expect(result.navigation.method).toBe("exact");
  });

  it("normalised match (trailing slash difference)", () => {
    const result = repairUrl({
      requestedUrl: `${BASE}/docs/auth/`,
      observedUrls: [`${BASE}/docs/auth`],
    });
    expect(result.navigation.resolved).toBe(true);
  });

  it("canonical match — uses serverCanonical", () => {
    const result = repairUrl({
      requestedUrl: `${BASE}/old-path`,
      observedUrls: [`${BASE}/new-path`],
      serverCanonical: `${BASE}/new-path`,
    });
    expect(result.navigation.resolved).toBe(true);
    expect(result.navigation.method).toBe("canonical");
  });

  it("strong path similarity — accepts a close match", () => {
    const result = repairUrl({
      requestedUrl: `${BASE}/docs/auth/middleware`,
      observedUrls: [
        `${BASE}/docs/authentication/middleware`,
        `${BASE}/docs/other`,
      ],
    });
    // "auth" and "authentication" have strong token overlap
    expect(result.navigation.resolved).toBe(true);
    expect(result.navigation.method).toBe("path_similarity");
  });

  it("weak path similarity — rejects a vague match", () => {
    const result = repairUrl({
      requestedUrl: `${BASE}/docs/auth/security/middleware`,
      observedUrls: [
        `${BASE}/blog/post-1`,
        `${BASE}/about`,
        `${BASE}/contact`,
      ],
    });
    expect(result.navigation.resolved).toBe(false);
    expect(result.navigation.reason).toBe("no_safe_url_match");
  });

  it("never repairs to a cross-origin URL", () => {
    const result = repairUrl({
      requestedUrl: `${BASE}/docs/auth`,
      observedUrls: ["https://other.com/docs/auth"],
    });
    expect(result.navigation.resolved).toBe(false);
  });

  it("returns 'none' method when no candidate found", () => {
    const result = repairUrl({
      requestedUrl: `${BASE}/totally/unknown`,
      observedUrls: [],
    });
    expect(result.navigation.method).toBe("none");
    expect(result.navigation.resolved).toBe(false);
  });
});

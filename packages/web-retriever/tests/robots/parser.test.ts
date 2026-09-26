/**
 * tests/robots/parser.test.ts
 *
 * robots.txt parser test suite.
 *
 * §112 of the spec ("Robots tests").
 */

import { describe, it, expect } from "vitest";
import { parseRobots } from "../../src/robots/parser.js";

describe("robots.txt parser", () => {
  it("parses a basic allow/disallow group", () => {
    const result = parseRobots(`
User-agent: *
Disallow: /private/
Allow: /public/
    `);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.agents).toContain("*");
    expect(result.groups[0]!.rules).toContainEqual({ pattern: "/private/", allow: false });
    expect(result.groups[0]!.rules).toContainEqual({ pattern: "/public/", allow: true });
  });

  it("parses multiple user-agent groups", () => {
    const result = parseRobots(`
User-agent: Googlebot
Disallow: /nogoogle/

User-agent: *
Disallow: /private/
    `);
    expect(result.groups).toHaveLength(2);
    const googlebotGroup = result.groups.find((g) => g.agents.includes("googlebot"));
    expect(googlebotGroup).toBeDefined();
  });

  it("parses sitemap directives", () => {
    const result = parseRobots(`
User-agent: *
Disallow:

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap2.xml
    `);
    expect(result.sitemaps).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap2.xml",
    ]);
  });

  it("parses crawl-delay", () => {
    const result = parseRobots(`
User-agent: *
Crawl-delay: 5
    `);
    expect(result.groups[0]!.crawlDelay).toBe(5);
  });

  it("handles empty Disallow (means allow all)", () => {
    const result = parseRobots(`
User-agent: *
Disallow:
    `);
    expect(result.groups[0]!.rules[0]!.pattern).toBe("");
  });

  it("ignores comments", () => {
    const result = parseRobots(`
# This is a comment
User-agent: * # inline comment
Disallow: /admin/ # another comment
    `);
    expect(result.groups[0]!.rules[0]!.pattern).toBe("/admin/");
  });

  it("handles malformed lines gracefully", () => {
    expect(() =>
      parseRobots(`
User-agent: *
this line has no colon
Disallow: /ok/
      `),
    ).not.toThrow();
  });

  it("handles CRLF line endings", () => {
    const result = parseRobots("User-agent: *\r\nDisallow: /admin/\r\n");
    expect(result.groups[0]!.rules[0]!.pattern).toBe("/admin/");
  });
});

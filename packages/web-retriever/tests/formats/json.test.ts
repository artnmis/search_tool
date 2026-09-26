/**
 * tests/formats/json.test.ts
 *
 * JSON extraction test suite.
 *
 * §112 of the spec ("JSON tests").
 */

import { describe, it, expect } from "vitest";
import { extractJson } from "../../src/formats/json.js";

const OPTS = { query: "product price", mimeType: "application/json", maxPassageChars: 1200 };

describe("JSON extraction", () => {
  it("extracts top-level string values with field paths", () => {
    const json = JSON.stringify({ name: "Widget", description: "A useful widget" });
    const result = extractJson(json, "https://api.example.com/product", OPTS);
    expect(result.text).toContain("[name] Widget");
    expect(result.text).toContain("[description] A useful widget");
  });

  it("extracts nested object values with dot-path provenance", () => {
    const json = JSON.stringify({ product: { price: "9.99", currency: "USD" } });
    const result = extractJson(json, "https://api.example.com/", OPTS);
    expect(result.text).toContain("[product.price] 9.99");
    expect(result.text).toContain("[product.currency] USD");
  });

  it("extracts array items with index provenance", () => {
    const json = JSON.stringify({ items: ["alpha", "beta", "gamma"] });
    const result = extractJson(json, "https://example.com/", OPTS);
    expect(result.text).toContain("[items[0]] alpha");
    expect(result.text).toContain("[items[1]] beta");
  });

  it("collects URLs found in string values as links", () => {
    const json = JSON.stringify({ url: "https://example.com/resource" });
    const result = extractJson(json, "https://example.com/", OPTS);
    expect(result.links).toContain("https://example.com/resource");
  });

  it("handles malformed JSON gracefully", () => {
    const result = extractJson("{not valid json", "https://example.com/", OPTS);
    expect(result.text).toContain("JSON parse error");
    expect(result.links).toHaveLength(0);
  });

  it("does not exceed MAX_DEPTH", () => {
    // Build a deeply nested object
    let deep: Record<string, unknown> = { value: "bottom" };
    for (let i = 0; i < 20; i++) {
      deep = { nested: deep };
    }
    expect(() => extractJson(JSON.stringify(deep), "https://example.com/", OPTS)).not.toThrow();
  });

  it("handles an empty JSON object", () => {
    const result = extractJson("{}", "https://example.com/", OPTS);
    expect(result.text).toBe("");
  });

  it("handles a JSON array at root", () => {
    const json = JSON.stringify([{ name: "item1" }, { name: "item2" }]);
    const result = extractJson(json, "https://example.com/", OPTS);
    expect(result.text).toContain("item1");
    expect(result.text).toContain("item2");
  });
});

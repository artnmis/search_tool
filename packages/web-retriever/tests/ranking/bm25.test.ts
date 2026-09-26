/**
 * tests/ranking/bm25.test.ts
 *
 * BM25 ranking test suite.
 */

import { describe, it, expect } from "vitest";
import { BM25Index } from "../../src/ranking/bm25.js";

describe("BM25Index", () => {
  const docs = [
    { id: "1", text: "authentication middleware handles login and session management" },
    { id: "2", text: "database connection pooling for postgres and mysql" },
    { id: "3", text: "how authentication and authorisation work in the API" },
    { id: "4", text: "completely unrelated document about cooking recipes" },
  ];

  it("ranks authentication-related docs highest for an auth query", () => {
    const index = new BM25Index(docs);
    const results = index.rank("authentication middleware");

    expect(results[0]!.id).toMatch(/[13]/); // doc 1 or 3 should be top
    const authDocIds = results.slice(0, 2).map((r) => r.id);
    expect(authDocIds).toContain("1");
  });

  it("returns scores normalised to [0, 1]", () => {
    const index = new BM25Index(docs);
    const results = index.rank("authentication");
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("returns empty array for a query with no matching terms", () => {
    const index = new BM25Index(docs);
    const results = index.rank("zzzzz nonexistent term xyz");
    expect(results).toHaveLength(0);
  });

  it("handles an empty corpus", () => {
    const index = new BM25Index([]);
    expect(index.rank("anything")).toHaveLength(0);
  });

  it("handles empty query", () => {
    const index = new BM25Index(docs);
    expect(index.rank("")).toHaveLength(0);
  });

  it("top result has score 1.0 (normalised)", () => {
    const index = new BM25Index(docs);
    const results = index.rank("authentication");
    expect(results[0]!.score).toBe(1.0);
  });
});

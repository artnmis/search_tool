/**
 * tests/formats/detect.test.ts
 *
 * Content-type detection test suite.
 */

import { describe, it, expect } from "vitest";
import { detectContentType } from "../../src/formats/detect.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("content-type detection", () => {
  it("uses Content-Type header when trustworthy", () => {
    expect(detectContentType("text/html; charset=utf-8", enc("<html>"))).toBe("text/html");
  });

  it("normalises application/xhtml+xml to text/html", () => {
    expect(detectContentType("application/xhtml+xml", enc("<html>"))).toBe("text/html");
  });

  it("detects PDF via magic bytes", () => {
    expect(detectContentType("application/octet-stream", enc("%PDF-1.4\n"))).toBe("application/pdf");
  });

  it("detects JSON via content sniff when header is vague", () => {
    expect(detectContentType("text/plain", enc('{"key":"value"}'))).toBe("application/json");
  });

  it("detects RSS via content sniff", () => {
    expect(detectContentType("text/xml", enc("<rss version=\"2.0\">"))).toBe("application/rss+xml");
  });

  it("detects Atom via content sniff", () => {
    expect(detectContentType("text/xml", enc("<feed xmlns=\"http://www.w3.org/2005/Atom\">"))).toBe("application/atom+xml");
  });

  it("detects HTML via content sniff when header is octet-stream", () => {
    expect(detectContentType("application/octet-stream", enc("<!DOCTYPE html><html>"))).toBe("text/html");
  });

  it("returns 'unknown' when nothing matches", () => {
    expect(detectContentType("", enc("\x00\x01\x02\x03random binary"))).toBe("unknown");
  });

  it("strips charset parameter from Content-Type", () => {
    expect(detectContentType("application/json; charset=utf-8", enc("{}"))).toBe("application/json");
  });
});

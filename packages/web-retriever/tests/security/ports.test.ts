/**
 * tests/security/ports.test.ts
 *
 * Port allowlist test suite.
 */

import { describe, it, expect } from "vitest";
import { isSafePort, getPort } from "../../src/security/ports.js";

describe("port allowlist", () => {
  it("allows port 80", () => expect(isSafePort(80)).toBe(true));
  it("allows port 443", () => expect(isSafePort(443)).toBe(true));
  it("allows port 8080", () => expect(isSafePort(8080)).toBe(true));
  it("allows port 8443", () => expect(isSafePort(8443)).toBe(true));
  it("allows undefined (scheme default)", () => expect(isSafePort(undefined)).toBe(true));

  it("blocks port 22 (SSH)", () => expect(isSafePort(22)).toBe(false));
  it("blocks port 25 (SMTP)", () => expect(isSafePort(25)).toBe(false));
  it("blocks port 6379 (Redis)", () => expect(isSafePort(6379)).toBe(false));
  it("blocks port 5432 (Postgres)", () => expect(isSafePort(5432)).toBe(false));
  it("blocks port 3306 (MySQL)", () => expect(isSafePort(3306)).toBe(false));
  it("blocks port 11211 (Memcached)", () => expect(isSafePort(11211)).toBe(false));

  describe("getPort()", () => {
    it("returns undefined for default HTTP port", () => {
      expect(getPort(new URL("http://example.com/"))).toBeUndefined();
    });
    it("returns undefined for default HTTPS port", () => {
      expect(getPort(new URL("https://example.com/"))).toBeUndefined();
    });
    it("returns 8080 for explicit port", () => {
      expect(getPort(new URL("http://example.com:8080/"))).toBe(8080);
    });
  });
});

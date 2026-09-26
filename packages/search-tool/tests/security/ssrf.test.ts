/**
 * tests/security/ssrf.test.ts
 *
 * SSRF protection test suite.
 *
 * §112 of the spec ("SSRF tests") and Phase 1 task 1.8.
 *
 * Covers: localhost, loopback, private IPv4, private IPv6, link-local,
 * metadata service IPs, and verifies public IPs are NOT blocked.
 */

import { describe, it, expect } from "vitest";
import { assertSafeUrl } from "../../src/security/ssrf.js";
import type { RetrieveError } from "../../src/core/types.js";

// Helper: run assertSafeUrl and return the error code, or null if it passes.
async function check(url: string): Promise<string | null> {
  try {
    await assertSafeUrl(new URL(url));
    return null;
  } catch (e) {
    return (e as RetrieveError).code;
  }
}

describe("SSRF protection", () => {
  // --- Loopback / localhost ---
  it("blocks 127.0.0.1", async () => {
    expect(await check("http://127.0.0.1/path")).toBe("SSRF_BLOCKED");
  });

  it("blocks 127.0.0.2", async () => {
    expect(await check("http://127.0.0.2/")).toBe("SSRF_BLOCKED");
  });

  it("blocks ::1 (IPv6 loopback)", async () => {
    expect(await check("http://[::1]/")).toBe("SSRF_BLOCKED");
  });

  // --- Private IPv4 ranges ---
  it("blocks 10.0.0.1 (RFC 1918)", async () => {
    expect(await check("http://10.0.0.1/")).toBe("SSRF_BLOCKED");
  });

  it("blocks 172.16.0.1 (RFC 1918)", async () => {
    expect(await check("http://172.16.0.1/")).toBe("SSRF_BLOCKED");
  });

  it("blocks 192.168.1.1 (RFC 1918)", async () => {
    expect(await check("http://192.168.1.1/")).toBe("SSRF_BLOCKED");
  });

  // --- Link-local (cloud metadata) ---
  it("blocks 169.254.169.254 (AWS metadata)", async () => {
    expect(await check("http://169.254.169.254/")).toBe("SSRF_BLOCKED");
  });

  it("blocks 169.254.170.2 (ECS metadata)", async () => {
    expect(await check("http://169.254.170.2/")).toBe("SSRF_BLOCKED");
  });

  // --- Private IPv6 ---
  it("blocks fc00:: (unique local)", async () => {
    expect(await check("http://[fc00::1]/")).toBe("SSRF_BLOCKED");
  });

  it("blocks fe80:: (link-local)", async () => {
    expect(await check("http://[fe80::1]/")).toBe("SSRF_BLOCKED");
  });

  // --- Public IPs should NOT be blocked ---
  it("allows a public IPv4", async () => {
    // 1.1.1.1 is a well-known public DNS resolver (Cloudflare)
    expect(await check("http://1.1.1.1/")).toBeNull();
  });

  it("allows 8.8.8.8", async () => {
    expect(await check("http://8.8.8.8/")).toBeNull();
  });
});

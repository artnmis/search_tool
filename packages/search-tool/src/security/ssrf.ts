/**
 * security/ssrf.ts
 *
 * SSRF (Server-Side Request Forgery) protection layer.
 *
 * The AI model can supply arbitrary URLs.  Without this guard the retriever
 * could be used to probe internal services (AWS metadata, Redis, localhost
 * admin panels, etc.).  This module blocks every destination that should
 * never be reachable from a public-web retriever.
 *
 * §53 of the spec defines the full requirement.
 *
 * Approach: parse the URL, resolve the hostname to IP(s) via DNS, then
 * check each resolved IP against the known-private ranges.  DNS resolution
 * is also repeated on every redirect hop (see security/redirect.ts) to
 * defend against DNS rebinding attacks.
 */

import dns from "node:dns/promises";
import { RetrieveError } from "../core/types.js";

// ---------------------------------------------------------------------------
// Private / reserved IP ranges
// ---------------------------------------------------------------------------

/**
 * IPv4 CIDR ranges that must never be fetched.
 * Each entry is [networkBigInt, prefixLength].
 */
const BLOCKED_IPV4_RANGES: Array<[bigint, number]> = [
  [ip4ToBigInt("127.0.0.0"), 8], // loopback
  [ip4ToBigInt("10.0.0.0"), 8], // RFC 1918 private
  [ip4ToBigInt("172.16.0.0"), 12], // RFC 1918 private
  [ip4ToBigInt("192.168.0.0"), 16], // RFC 1918 private
  [ip4ToBigInt("169.254.0.0"), 16], // link-local (AWS/GCP metadata)
  [ip4ToBigInt("100.64.0.0"), 10], // carrier-grade NAT (RFC 6598)
  [ip4ToBigInt("192.0.2.0"), 24], // TEST-NET-1 (RFC 5737)
  [ip4ToBigInt("198.51.100.0"), 24], // TEST-NET-2
  [ip4ToBigInt("203.0.113.0"), 24], // TEST-NET-3
  [ip4ToBigInt("0.0.0.0"), 8], // unspecified / "this" network
  [ip4ToBigInt("240.0.0.0"), 4], // reserved (Class E)
  [ip4ToBigInt("255.255.255.255"), 32], // broadcast
];

/**
 * IPv6 prefixes that must never be fetched.
 * Each entry is [networkBigInt, prefixLength].
 */
const BLOCKED_IPV6_RANGES: Array<[bigint, number]> = [
  [ip6ToBigInt("::1"), 128], // loopback
  [ip6ToBigInt("::"), 128], // unspecified
  [ip6ToBigInt("fc00::"), 7], // unique local (RFC 4193)
  [ip6ToBigInt("fe80::"), 10], // link-local
  [ip6ToBigInt("ff00::"), 8], // multicast
  [ip6ToBigInt("2001:db8::"), 32], // documentation (RFC 3849)
  [ip6ToBigInt("100::"), 64], // discard prefix (RFC 6666)
  // IPv4-mapped ::ffff:a.b.c.d — checked separately
];

// Known cloud metadata service IPs that must always be blocked regardless of
// whether they fall in a private range (defence-in-depth).
const ALWAYS_BLOCKED_IPS: ReadonlySet<string> = new Set([
  "169.254.169.254", // AWS / GCP / Azure instance metadata
  "fd00:ec2::254", // AWS IPv6 metadata
  "169.254.170.2", // AWS ECS task metadata
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates a fully-parsed URL for SSRF safety.
 *
 * Resolves the hostname via DNS and checks every returned address.
 * Throws a RetrieveError with code "SSRF_BLOCKED" if the destination is
 * private, loopback, link-local, or otherwise unsafe.
 */
export async function assertSafeUrl(url: URL): Promise<void> {
  const hostname = url.hostname;

  // Raw IP addresses bypass DNS resolution — check them directly.
  if (isRawIpv4(hostname)) {
    assertSafeIpv4(hostname, url.href);
    return;
  }
  if (isRawIpv6(hostname)) {
    assertSafeIpv6(stripIpv6Brackets(hostname), url.href);
    return;
  }

  // Resolve hostname and check all returned addresses.
  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true });
    addresses = records.map((r) => r.address);
  } catch {
    // DNS failure — not an SSRF block, let the fetcher handle it as a
    // network error.  We only block known-private destinations.
    return;
  }

  for (const address of addresses) {
    if (ALWAYS_BLOCKED_IPS.has(address)) {
      throwSsrfError(url.href, `metadata service IP ${address}`);
    }
    if (isRawIpv4(address)) {
      assertSafeIpv4(address, url.href);
    } else {
      assertSafeIpv6(address, url.href);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertSafeIpv4(ip: string, originalUrl: string): void {
  const n = ip4ToBigInt(ip);
  for (const [network, prefix] of BLOCKED_IPV4_RANGES) {
    if (ipv4InRange(n, network, prefix)) {
      throwSsrfError(originalUrl, `private/reserved IPv4 ${ip}`);
    }
  }
}

function assertSafeIpv6(ip: string, originalUrl: string): void {
  // Handle IPv4-mapped addresses like ::ffff:192.168.1.1
  const mapped = extractIpv4MappedAddress(ip);
  if (mapped !== null) {
    assertSafeIpv4(mapped, originalUrl);
    return;
  }

  const n = ip6ToBigInt(ip);
  for (const [network, prefix] of BLOCKED_IPV6_RANGES) {
    if (ipv6InRange(n, network, prefix)) {
      throwSsrfError(originalUrl, `private/reserved IPv6 ${ip}`);
    }
  }
}

function throwSsrfError(url: string, reason: string): never {
  const error: RetrieveError = {
    code: "SSRF_BLOCKED",
    message: `SSRF protection blocked request to ${url}: ${reason}`,
    url,
  };
  throw error;
}

// --- IP parsing helpers ---

function isRawIpv4(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function isRawIpv6(hostname: string): boolean {
  // Matches bare IPv6 (with or without brackets) containing at least one colon
  return hostname.includes(":");
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

function ip4ToBigInt(ip: string): bigint {
  const parts = ip.split(".").map(Number);
  return (
    (BigInt(parts[0]!) << 24n) |
    (BigInt(parts[1]!) << 16n) |
    (BigInt(parts[2]!) << 8n) |
    BigInt(parts[3]!)
  );
}

function ipv4InRange(ip: bigint, network: bigint, prefix: number): boolean {
  const mask = prefix === 0 ? 0n : ~((1n << BigInt(32 - prefix)) - 1n) & 0xffffffffn;
  return (ip & mask) === (network & mask);
}

function ip6ToBigInt(ip: string): bigint {
  // Expand :: notation and parse the 8 groups
  const expanded = expandIpv6(ip);
  const groups = expanded.split(":");
  let result = 0n;
  for (const g of groups) {
    result = (result << 16n) | BigInt(parseInt(g || "0", 16));
  }
  return result;
}

function ipv6InRange(ip: bigint, network: bigint, prefix: number): boolean {
  const mask =
    prefix === 0 ? 0n : ~((1n << BigInt(128 - prefix)) - 1n) & ((1n << 128n) - 1n);
  return (ip & mask) === (network & mask);
}

function expandIpv6(ip: string): string {
  const halves = ip.split("::");
  if (halves.length === 1) return ip;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  return [...left, ...Array(missing).fill("0"), ...right].join(":");
}

function extractIpv4MappedAddress(ip: string): string | null {
  // ::ffff:a.b.c.d  or  ::ffff:0a0b:0c0d
  const match = ip.match(/^(?:0*:)*(?:0*:)?ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  return match ? (match[1] ?? null) : null;
}

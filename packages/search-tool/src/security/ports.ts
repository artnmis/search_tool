/**
 * security/ports.ts
 *
 * Allowlist of ports the fetcher may connect to.
 *
 * Why an allowlist instead of a denylist: the denylist approach requires
 * enumerating every dangerous service port (Redis, Memcached, SMTP, …).
 * An allowlist is smaller, safer, and easier to audit.  The overwhelming
 * majority of public HTTP services live on 80 and 443.
 *
 * §54 of the spec requires an allowlist policy for request method safety;
 * this complements that by restricting connection ports.
 */

/** Ports the fetcher is permitted to connect to by default. */
const SAFE_PORTS: ReadonlySet<number> = new Set([
  80, // HTTP
  443, // HTTPS
  8080, // common HTTP alternative
  8443, // common HTTPS alternative
]);

/**
 * Returns true when the port is on the safe list.
 *
 * If no port is present in the URL (i.e. the URL uses the scheme default),
 * pass `undefined` — it will be treated as allowed because the scheme-default
 * ports (80/443) are safe.
 */
export function isSafePort(port: number | undefined): boolean {
  if (port === undefined) return true; // scheme default (80 or 443) is fine
  return SAFE_PORTS.has(port);
}

/**
 * Extract the numeric port from a URL object.
 * Returns `undefined` when the URL uses its scheme's default port.
 */
export function getPort(url: URL): number | undefined {
  if (url.port === "") return undefined;
  const n = parseInt(url.port, 10);
  return isNaN(n) ? undefined : n;
}

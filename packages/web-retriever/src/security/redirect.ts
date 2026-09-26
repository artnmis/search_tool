/**
 * security/redirect.ts
 *
 * Redirect safety — re-validate the destination IP on every redirect hop.
 *
 * Why redirect re-validation matters: a DNS rebinding attack allows an
 * attacker to pass the initial SSRF check with a public IP, then serve a
 * DNS response that resolves to a private IP by the time the redirect is
 * followed.  Re-running assertSafeUrl() on every hop closes that window.
 *
 * §53 (DNS rebinding defence) and §104 (HTTP status handling) of the spec.
 */

import { assertSafeUrl } from "./ssrf.js";
import { RetrieveError } from "../core/types.js";

export interface RedirectCheckOptions {
  maxRedirects: number;
}

/**
 * Validates a redirect destination before following it.
 *
 * Call this inside the fetch loop whenever the HTTP response is a 3xx.
 * Throws a RetrieveError when:
 *   - too many redirects have already been followed;
 *   - the destination URL is unsafe (private IP, bad scheme, etc.).
 */
export async function assertSafeRedirect(
  location: string,
  fromUrl: string,
  hopCount: number,
  options: RedirectCheckOptions,
): Promise<URL> {
  if (hopCount >= options.maxRedirects) {
    const error: RetrieveError = {
      code: "TOO_MANY_REDIRECTS",
      message: `Exceeded ${options.maxRedirects} redirects (last: ${fromUrl} → ${location})`,
      url: fromUrl,
    };
    throw error;
  }

  // Resolve relative redirect URLs against the current URL.
  let destination: URL;
  try {
    destination = new URL(location, fromUrl);
  } catch {
    const error: RetrieveError = {
      code: "INVALID_URL",
      message: `Redirect location is not a valid URL: ${location}`,
      url: fromUrl,
    };
    throw error;
  }

  // Only follow HTTP(S) redirects — never follow javascript:, data:, etc.
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    const error: RetrieveError = {
      code: "UNSAFE_SCHEME",
      message: `Redirect to non-HTTP scheme blocked: ${destination.href}`,
      url: destination.href,
    };
    throw error;
  }

  // Re-validate the IP to catch DNS rebinding.
  await assertSafeUrl(destination);

  return destination;
}

/**
 * Detects a redirect loop by checking whether the destination URL has already
 * been visited in the current hop chain.
 */
export function isRedirectLoop(destination: string, visitedUrls: ReadonlySet<string>): boolean {
  return visitedUrls.has(destination);
}

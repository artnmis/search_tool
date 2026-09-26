/**
 * discovery/metadata.ts
 *
 * Page metadata extraction.
 *
 * §24 of the spec.
 *
 * Extracts:
 *   - <title>
 *   - <meta name="description">
 *   - Open Graph tags (og:title, og:description, og:type, og:url, og:image)
 *   - Twitter Card tags (twitter:title, twitter:description)
 *   - <link rel="canonical">
 *   - <link rel="alternate" hreflang="..."> (for multilingual pages, §96)
 *   - <link rel="manifest"> (for PWA manifests, §100)
 *
 * This is a pure function operating on pre-parsed HTML output — it does not
 * re-parse the DOM itself.
 */

/**
 * Normalised page metadata.  All fields are optional because any of them
 * may be absent on a given page.
 */
export interface PageMetadata {
  title?: string | undefined;
  description?: string | undefined;
  canonical?: string | undefined;
  ogTitle?: string | undefined;
  ogDescription?: string | undefined;
  ogType?: string | undefined;
  ogUrl?: string | undefined;
  ogImage?: string | undefined;
  twitterTitle?: string | undefined;
  twitterDescription?: string | undefined;
  /** hreflang alternate URLs keyed by language code. */
  alternates?: Record<string, string> | undefined;
  /** Web app manifest URL. */
  manifest?: string | undefined;
  /** Raw key→value map of all meta tags for forward compatibility. */
  raw: Record<string, string>;
}

/**
 * Converts the flat metadata record produced by the HTML extractor into a
 * typed PageMetadata object.
 *
 * @param raw  The `metadata` field from ExtractionResult.
 */
export function parsePageMetadata(raw: Record<string, string>): PageMetadata {
  const alternates: Record<string, string> = {};

  // The HTML extractor stores hreflang alternates with keys like
  // "alternate:hreflang:en" — extract them here.
  for (const [key, value] of Object.entries(raw)) {
    const match = key.match(/^alternate:hreflang:(.+)$/);
    if (match?.[1]) alternates[match[1]] = value;
  }

  return {
    title: raw["title"],
    description: raw["description"],
    canonical: raw["canonical"],
    ogTitle: raw["og:title"],
    ogDescription: raw["og:description"],
    ogType: raw["og:type"],
    ogUrl: raw["og:url"],
    ogImage: raw["og:image"],
    twitterTitle: raw["twitter:title"],
    twitterDescription: raw["twitter:description"],
    alternates: Object.keys(alternates).length > 0 ? alternates : undefined,
    manifest: raw["manifest"],
    raw,
  };
}

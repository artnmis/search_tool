/**
 * formats/detect.ts
 *
 * Content-type detection subsystem.
 *
 * §13 of the spec — determine document type using BOTH the HTTP Content-Type
 * header and magic bytes.  Never trust Content-Type blindly because servers
 * often serve wrong types (e.g. text/plain for JSON APIs, text/html for PDFs).
 *
 * Detection order:
 *   1. Normalise the Content-Type header.
 *   2. If the header is specific and trustworthy, use it.
 *   3. Otherwise sniff the first bytes of the body.
 *   4. Return a normalised MIME type string.
 */

// ---------------------------------------------------------------------------
// Magic-byte signatures
// ---------------------------------------------------------------------------

interface MagicSignature {
  /** Byte prefix to match. */
  bytes: Uint8Array;
  /** MIME type to return on match. */
  mime: string;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { bytes: enc("%PDF-"), mime: "application/pdf" },
  { bytes: enc("PK\x03\x04"), mime: "application/zip" }, // ZIP / DOCX / XLSX
  { bytes: enc("\xFF\xD8\xFF"), mime: "image/jpeg" },
  { bytes: enc("\x89PNG\r\n\x1A\n"), mime: "image/png" },
  { bytes: enc("GIF87a"), mime: "image/gif" },
  { bytes: enc("GIF89a"), mime: "image/gif" },
  { bytes: enc("RIFF"), mime: "image/webp" }, // partial — refined below
];

// Text-based magic: inspect the first 512 bytes as ASCII.
const TEXT_MAGIC: Array<{ pattern: RegExp; mime: string }> = [
  { pattern: /^<\?xml\s/i, mime: "application/xml" },
  { pattern: /^<rss[\s>]/i, mime: "application/rss+xml" },
  { pattern: /^<feed[\s>]/i, mime: "application/atom+xml" },
  { pattern: /^<!doctype\s+html/i, mime: "text/html" },
  { pattern: /^<html[\s>]/i, mime: "text/html" },
  { pattern: /^[\s]*[{[]/, mime: "application/json" },
];

// ---------------------------------------------------------------------------
// Normalisation table — maps non-canonical MIME aliases to canonical forms
// ---------------------------------------------------------------------------

const MIME_ALIASES: Record<string, string> = {
  "text/xml": "application/xml",
  "application/x-rss+xml": "application/rss+xml",
  "application/x-atom+xml": "application/atom+xml",
  "application/xhtml+xml": "text/html",
  "text/javascript": "application/javascript",
  "application/x-javascript": "application/javascript",
  "image/jpg": "image/jpeg",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Well-known MIME types the retriever understands. */
export type KnownMime =
  | "text/html"
  | "application/xml"
  | "application/rss+xml"
  | "application/atom+xml"
  | "application/json"
  | "text/plain"
  | "text/markdown"
  | "text/csv"
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "application/zip"
  | "application/javascript"
  | "unknown";

/**
 * Detects the content type of a response.
 *
 * @param contentTypeHeader  The raw Content-Type header value (may be empty).
 * @param bodyPreview        First bytes of the response body (≥512 bytes
 *                           preferred, but fewer is fine).
 */
export function detectContentType(
  contentTypeHeader: string,
  bodyPreview: Uint8Array,
): string {
  // Step 1: normalise the header.
  const fromHeader = normaliseMime(contentTypeHeader);

  // Step 2: if the header is specific and we trust it, return it.
  if (fromHeader && isTrustworthy(fromHeader)) {
    return MIME_ALIASES[fromHeader] ?? fromHeader;
  }

  // Step 3: sniff the body.
  const fromBody = sniff(bodyPreview);
  if (fromBody) return fromBody;

  // Step 4: fall back to the normalised header even if we don't fully trust it.
  if (fromHeader) return MIME_ALIASES[fromHeader] ?? fromHeader;

  return "unknown";
}

/**
 * Strips Content-Type parameters (charset, boundary, …) and lower-cases.
 * "text/html; charset=utf-8" → "text/html"
 */
export function normaliseMime(raw: string): string {
  return raw.split(";")[0]?.trim().toLowerCase() ?? "";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * A MIME type is "trustworthy" when it is not one of the vague types that
 * servers often misuse for arbitrary binary content.
 *
 * Generic XML types (application/xml, text/xml) are NOT treated as
 * trustworthy because many servers serve RSS/Atom under those types.
 * We sniff those to get the specific sub-type.
 */
function isTrustworthy(mime: string): boolean {
  const vague = new Set([
    "application/octet-stream",
    "binary/octet-stream",
    "text/plain",
    "application/xml",  // too generic — sniff for rss/atom
    "text/xml",         // too generic — sniff for rss/atom
    "",
    "unknown",
  ]);
  return !vague.has(mime);
}

function sniff(bytes: Uint8Array): string | null {
  // Binary magic bytes first.
  for (const sig of MAGIC_SIGNATURES) {
    if (startsWith(bytes, sig.bytes)) {
      // Disambiguate RIFF: RIFF....WEBP
      if (sig.mime === "image/webp") {
        const slice = bytes.slice(0, 12);
        if (new TextDecoder("ascii", { fatal: false }).decode(slice).includes("WEBP")) {
          return "image/webp";
        }
        continue; // Not WebP — skip this match.
      }
      return sig.mime;
    }
  }

  // Text-based sniff: decode up to 512 bytes as UTF-8 (lossy).
  const preview = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512));
  for (const { pattern, mime } of TEXT_MAGIC) {
    if (pattern.test(preview.trimStart())) return mime;
  }

  return null;
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * discovery/application-data.ts
 *
 * Embedded application state extraction.
 *
 * §16 of the spec — many modern sites (Next.js, Nuxt, SvelteKit, etc.) embed
 * their server-rendered data directly in the HTML so the client can hydrate
 * without a second API call.  This data is often more structured and complete
 * than the rendered HTML text.
 *
 * We extract:
 *   - __NEXT_DATA__  (Next.js — <script id="__NEXT_DATA__" type="application/json">)
 *   - __NUXT__       (Nuxt.js — window.__NUXT__ = {...})
 *   - __INITIAL_STATE__ / __REDUX_STATE__ / __APP_STATE__ (common SPA patterns)
 *   - Any <script type="application/json"> block
 *
 * We do NOT execute JavaScript.  We only extract statically present JSON
 * literals.  §1055 of the spec prohibits arbitrary JS execution in core.
 */

import { parseDocument, DomUtils } from "htmlparser2";
import type { Element } from "domhandler";

export interface AppStateResult {
  /** Key → parsed JSON value for each detected application state blob. */
  blobs: Record<string, unknown>;
  /** Whether any Next.js-specific data was found. */
  hasNextData: boolean;
  /** Whether any Nuxt-specific data was found. */
  hasNuxtData: boolean;
}

/**
 * Extracts embedded application state from raw HTML.
 *
 * Returns an AppStateResult with all discovered JSON blobs.
 */
export function extractApplicationData(html: Uint8Array | string): AppStateResult {
  const text = typeof html === "string" ? html : new TextDecoder().decode(html);
  const dom = parseDocument(text);

  const blobs: Record<string, unknown> = {};
  let hasNextData = false;
  let hasNuxtData = false;

  for (const node of DomUtils.findAll(
    (n) => n.type === "tag" && (n as Element).name === "script",
    dom.children,
  )) {
    const el = node as Element;
    const type = (el.attribs["type"] ?? "").toLowerCase();
    const id = el.attribs["id"] ?? "";
    const content = DomUtils.getText(el).trim();

    if (!content) continue;

    // --- Next.js ---
    if (id === "__NEXT_DATA__" || (type === "application/json" && id === "__NEXT_DATA__")) {
      const parsed = tryParseJson(content);
      if (parsed !== null) {
        blobs["__NEXT_DATA__"] = parsed;
        hasNextData = true;
      }
      continue;
    }

    // --- Generic <script type="application/json"> ---
    if (type === "application/json") {
      const key = id || `json_blob_${Object.keys(blobs).length}`;
      const parsed = tryParseJson(content);
      if (parsed !== null) blobs[key] = parsed;
      continue;
    }

    // --- window.* assignment patterns (inline scripts without a type) ---
    if (type === "" || type === "text/javascript") {
      // Nuxt: window.__NUXT__ = {...} or self.__NUXT__ = {...}
      const nuxtMatch = content.match(/(?:window|self)\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*$/m);
      if (nuxtMatch?.[1]) {
        const parsed = tryParseJson(nuxtMatch[1]);
        if (parsed !== null) {
          blobs["__NUXT__"] = parsed;
          hasNuxtData = true;
        }
      }

      // Generic window.__X__ = {...} patterns
      const genericMatch = content.match(
        /(?:window|self)\.(_{0,2}[A-Z][A-Z0-9_]*_{0,2})\s*=\s*(\{[\s\S]{0,50000}\})/m,
      );
      if (genericMatch?.[1] && genericMatch[2]) {
        const key = genericMatch[1];
        if (!blobs[key]) {
          const parsed = tryParseJson(genericMatch[2]);
          if (parsed !== null) blobs[key] = parsed;
        }
      }
    }
  }

  return { blobs, hasNextData, hasNuxtData };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tryParseJson(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * cache/interface.ts
 *
 * Re-exports the CacheProvider interface from core/types.ts so that
 * external implementors can import it from a stable, focused path without
 * pulling in the entire types module.
 *
 * A host application implementing a Redis-backed cache only needs:
 *
 *   import type { CacheProvider } from "@web-retriever/web-retriever/cache"
 */

export type { CacheProvider } from "../core/types.js";

/**
 * cache/memory.ts
 *
 * In-process, session-scoped memory cache for HTTP responses.
 *
 * §68 of the spec.
 *
 * This is the default cache used when the host application does not inject
 * a persistent CacheProvider.  It keeps responses in memory for the duration
 * of a single retrieve() call, so that robots.txt and sitemaps are not
 * re-fetched when the same URL is requested more than once within a session.
 *
 * Nothing is written to disk, no external service is contacted.
 */

import type { CacheProvider, FetchResponse } from "../core/types.js";

interface CacheEntry {
  response: FetchResponse;
  expiresAt: number;
}

export class MemoryCache implements CacheProvider {
  private readonly store = new Map<string, CacheEntry>();

  async get(key: string): Promise<FetchResponse | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // Evict expired entries on read.
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.response;
  }

  async set(key: string, value: FetchResponse, ttlSeconds = 300): Promise<void> {
    this.store.set(key, {
      response: value,
      expiresAt: Date.now() + ttlSeconds * 1_000,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Returns the number of currently valid (non-expired) entries. */
  get size(): number {
    const now = Date.now();
    let count = 0;
    for (const entry of this.store.values()) {
      if (entry.expiresAt > now) count++;
    }
    return count;
  }

  /** Removes all entries (useful at the end of a retrieve() session). */
  clear(): void {
    this.store.clear();
  }
}

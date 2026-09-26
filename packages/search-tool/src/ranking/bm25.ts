/**
 * ranking/bm25.ts
 *
 * BM25 text ranking — the core relevance signal.
 *
 * §31 of the spec.
 *
 * BM25 (Best Match 25) is a well-understood, deterministic, parameter-tunable
 * ranking function used by most information-retrieval systems.  It requires
 * no embedding model, no external service, and no GPU.
 *
 * Standard BM25 parameters:
 *   k1 = 1.5  — term-frequency saturation
 *   b  = 0.75 — document-length normalisation
 *
 * These are the standard defaults used by Elasticsearch, Solr, and Lucene.
 */

import { tokenize } from "./tokenizer.js";

// ---------------------------------------------------------------------------
// BM25 parameters
// ---------------------------------------------------------------------------
const K1 = 1.5;
const B = 0.75;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BM25Document {
  id: string;
  text: string;
}

export interface BM25Result {
  id: string;
  score: number;
}

// ---------------------------------------------------------------------------
// BM25 index
// ---------------------------------------------------------------------------

/**
 * Builds a BM25 index over a set of documents and provides a `score()`
 * method to rank them against a query.
 *
 * Typical usage:
 *   const index = new BM25Index(documents);
 *   const ranked = index.rank(query);
 */
export class BM25Index {
  /** Term → { docId → term frequency } */
  private readonly tf = new Map<string, Map<string, number>>();
  /** Term → document frequency (number of docs containing term). */
  private readonly df = new Map<string, number>();
  /** docId → document length in tokens. */
  private readonly docLengths = new Map<string, number>();
  /** Average document length across the corpus. */
  private readonly avgDocLength: number;
  /** Total number of documents. */
  private readonly N: number;

  constructor(documents: BM25Document[]) {
    this.N = documents.length;
    let totalTokens = 0;

    for (const doc of documents) {
      const tokens = tokenize(doc.text);
      this.docLengths.set(doc.id, tokens.length);
      totalTokens += tokens.length;

      // Build term frequency map for this document.
      const termFreq = new Map<string, number>();
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }

      for (const [term, freq] of termFreq) {
        // Store TF.
        if (!this.tf.has(term)) this.tf.set(term, new Map());
        this.tf.get(term)!.set(doc.id, freq);

        // Increment DF.
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }

    this.avgDocLength = this.N > 0 ? totalTokens / this.N : 1;
  }

  /**
   * Scores all documents in the index against the given query.
   * Returns results sorted by descending score, scores normalised to [0, 1].
   */
  rank(query: string): BM25Result[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const rawScores = new Map<string, number>();

    for (const term of queryTokens) {
      const docFreq = this.df.get(term) ?? 0;
      if (docFreq === 0) continue;

      // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((this.N - docFreq + 0.5) / (docFreq + 0.5) + 1);

      const termDocs = this.tf.get(term);
      if (!termDocs) continue;

      for (const [docId, tf] of termDocs) {
        const docLen = this.docLengths.get(docId) ?? this.avgDocLength;
        // TF component with length normalisation.
        const tfNorm =
          (tf * (K1 + 1)) /
          (tf + K1 * (1 - B + B * (docLen / this.avgDocLength)));

        rawScores.set(docId, (rawScores.get(docId) ?? 0) + idf * tfNorm);
      }
    }

    if (rawScores.size === 0) return [];

    // Normalise scores to [0, 1].
    const maxScore = Math.max(...rawScores.values());
    const results: BM25Result[] = [];

    for (const [id, score] of rawScores) {
      results.push({ id, score: maxScore > 0 ? score / maxScore : 0 });
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

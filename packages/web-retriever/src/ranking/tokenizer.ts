/**
 * ranking/tokenizer.ts
 *
 * Text tokenizer used by BM25 and the URL scorer.
 *
 * §31 of the spec.
 *
 * Keeps the implementation deliberately simple and dependency-free:
 *   1. Lower-case the input.
 *   2. Split on whitespace and punctuation.
 *   3. Remove stopwords.
 *   4. Apply a basic suffix-stripping stemmer (Porter-lite rules).
 *
 * No external NLP library is required.  The goal is to improve recall by
 * normalising common inflections, not to produce linguistically perfect stems.
 */

// ---------------------------------------------------------------------------
// Stopwords — English function words that carry no topical signal
// ---------------------------------------------------------------------------
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "shall", "should", "may", "might", "must", "can", "could", "not", "no",
  "it", "its", "this", "that", "these", "those", "i", "we", "you", "he",
  "she", "they", "what", "which", "who", "how", "when", "where", "why",
  "as", "if", "than", "then", "so", "also", "just", "more", "into",
  "about", "up", "out", "after", "before", "between", "through",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Tokenizes a string into normalised, stemmed, stopword-free tokens.
 *
 * @param text  Any natural-language or URL-path string.
 * @returns     Array of lowercase stemmed tokens.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Replace non-alphanumeric characters (including hyphens, underscores, dots, slashes) with spaces.
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Returns the unique token set for a string (for Jaccard-style scoring).
 */
export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

// ---------------------------------------------------------------------------
// Minimal suffix-stripping stemmer (Porter-lite)
// ---------------------------------------------------------------------------

/**
 * Applies a small set of suffix-stripping rules sufficient for English
 * inflections common in technical documentation.
 *
 * This is intentionally NOT a full Porter stemmer — full Porter has
 * ~60 rules and edge cases that add complexity without meaningfully
 * improving BM25 recall for the short queries this library handles.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;

  // -ing, -ings
  if (word.endsWith("ings") && word.length > 6) return word.slice(0, -4);
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);

  // -tion, -tions
  if (word.endsWith("tions")) return word.slice(0, -5);
  if (word.endsWith("tion")) return word.slice(0, -4);

  // -ations (before -tion to avoid double-stripping)
  if (word.endsWith("ations")) return word.slice(0, -6);

  // -ment, -ments
  if (word.endsWith("ments")) return word.slice(0, -5);
  if (word.endsWith("ment")) return word.slice(0, -4);

  // -able, -ible
  if (word.endsWith("able") && word.length > 6) return word.slice(0, -4);
  if (word.endsWith("ible") && word.length > 6) return word.slice(0, -4);

  // -ness
  if (word.endsWith("ness") && word.length > 6) return word.slice(0, -4);

  // -er, -ers (but not short words like "her", "per")
  if (word.endsWith("ers") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("er") && word.length > 4) return word.slice(0, -2);

  // -ed (but not "red", "bed" etc.)
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);

  // -es, -s (plural)
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3 && !word.endsWith("ss")) return word.slice(0, -1);

  return word;
}

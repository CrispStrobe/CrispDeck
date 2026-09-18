/**
 * Text similarity for crosspost detection.
 *
 * Detection used Jaro-Winkler over the raw post text. That is a character-level
 * edit metric, and on natural language two unrelated posts of similar length
 * score around 0.6-0.7 — so the 0.7 threshold applied to identity-linked
 * authors grouped almost everything (measured precision 14.8%), and even the
 * 0.9 default fell to 63% precision on feeds where posts share an opening
 * ("Good morning everyone, here is the daily update for ...").
 *
 * Comparing sets of word trigrams instead fixes both, because it measures
 * shared content rather than shared characters. Containment rather than
 * Jaccard, because a crosspost is often the same text truncated to the other
 * platform's limit, and containment scores a prefix against its original at
 * 1.0 where Jaccard would only see the length ratio.
 *
 * See scripts/experiments/crosspost-similarity.test.ts for the comparison.
 */

/** Shingle size in words. */
const N = 3;

/** Below this many shingles a text is too short to compare loosely. */
const MIN_SHINGLES = 3;

/**
 * Strip what crossposting changes but a reader wouldn't count as a difference:
 * case, links (often shortened or tracking-tagged per platform), hashtags and
 * handles (frequently appended on one network only), and punctuation.
 */
export function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@]\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TextProfile {
  /** Word trigrams, or the bare words when the text is shorter than N. */
  shingles: Set<string>;
  /** Normalized text, used for the short-text exact comparison. */
  normalized: string;
}

export function profileText(text: string): TextProfile {
  const normalized = normalizeForCompare(text);
  const words = normalized.split(' ').filter(Boolean);
  const shingles = new Set<string>();
  if (words.length < N) {
    for (const w of words) shingles.add(w);
  } else {
    for (let i = 0; i + N <= words.length; i++) shingles.add(words.slice(i, i + N).join(' '));
  }
  return { shingles, normalized };
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const value of small) if (large.has(value)) n++;
  return n;
}

/**
 * Similarity in [0, 1].
 *
 * Containment — shared shingles over the smaller set — so a post truncated for
 * one platform still matches its longer original. Texts too short to form
 * enough trigrams to be meaningful must match exactly after normalization,
 * which stops "thanks" and "thanks!" style near-collisions from grouping.
 */
export function textSimilarity(a: TextProfile, b: TextProfile): number {
  if (a.normalized === b.normalized) return 1;
  if (a.shingles.size < MIN_SHINGLES || b.shingles.size < MIN_SHINGLES) return 0;
  if (a.shingles.size === 0 || b.shingles.size === 0) return 0;
  return intersectionSize(a.shingles, b.shingles) / Math.min(a.shingles.size, b.shingles.size);
}

/** Convenience for callers that don't hold profiles. */
export function similarity(a: string, b: string): number {
  return textSimilarity(profileText(a), profileText(b));
}

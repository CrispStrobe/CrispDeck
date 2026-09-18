/**
 * Near-duplicate detection for crossposts.
 *
 * A crosspost is one person putting the same text on two networks. The text is
 * rarely byte-identical: Bluesky truncates at 300 characters where Mastodon
 * allows 500, link shorteners differ, and hashtag and mention syntax is not
 * the same. So the question is "is this the same writing?", not "are these
 * strings similar".
 *
 * Jaro-Winkler, which this replaced, answers the second question, and it was
 * designed for names and addresses rather than paragraphs. Its matching window
 * is half the longer string, so on a 200-character post almost any character
 * can match almost any other: measured over 35,511 unrelated Bluesky/Mastodon
 * pairs, the *mean* score was 0.80 — above the 0.70 the feed used to group
 * posts by the same author. It was also the single most expensive thing in the
 * app, at 85% of CPU samples on a 400-post timeline.
 *
 * Word shingles answer the first question. Two unrelated English sentences
 * share plenty of characters and common words, but almost never a run of three
 * words in the same order.
 */

/** Words per shingle. Texts shorter than this cannot form one. */
export const SHINGLE_SIZE = 3;

/** Words, with everything that legitimately differs between networks removed. */
export function normalizeForCompare(text: string): string[] {
  return text
    .toLowerCase()
    // Links are rewritten, shortened or appended per network.
    .replace(/https?:\/\/\S+/g, ' ')
    // The markers differ; the words after them usually do not.
    .replace(/[@#]/g, ' ')
    // Punctuation, emoji and the rest carry little signal and vary with
    // client-side formatting.
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Overlapping runs of [k] words.
 *
 * Short texts have no k-word run, so they fall back to their words. That makes
 * "Good morning!" match any other "Good morning!", and — because containment
 * divides by the SMALLER set — it also makes "thanks" a full match for "thanks
 * everyone". On its own that is not enough to call something a crosspost, so
 * callers must check `usedWordFallback` and require the two posts to be by the
 * same person before grouping on a score from this path. See detectCrossposts.
 */
export function shingles(tokens: string[], k = SHINGLE_SIZE): Set<string> {
  if (tokens.length < k) return new Set(tokens);
  const out = new Set<string>();
  for (let i = 0; i + k <= tokens.length; i++) out.add(tokens.slice(i, i + k).join(' '));
  return out;
}

/**
 * |A ∩ B| / min(|A|, |B|).
 *
 * Containment rather than Jaccard, because truncation is the common case: a
 * Bluesky post cut at 300 characters is a *subset* of the Mastodon one, and
 * Jaccard would punish it for the half it was not allowed to keep. Containment
 * asks whether the shorter text is contained in the longer, which is the
 * question truncation raises.
 */
export function containment(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const s of small) if (large.has(s)) shared++;
  return shared / small.size;
}

/** A post reduced to what the comparison needs. */
export interface Fingerprint {
  shingles: Set<string>;
  tokenCount: number;
}

export function fingerprint(text: string, k = SHINGLE_SIZE): Fingerprint {
  const tokens = normalizeForCompare(text);
  return { shingles: shingles(tokens, k), tokenCount: tokens.length };
}

/**
 * True when the text was too short to form a shingle, so its "shingles" are
 * really just its words.
 *
 * A score against such a text says only that one post's words appear in the
 * other — "gm" is fully contained in "gm all". Grouping on that alone merges
 * unrelated people's small talk, so it needs corroboration from the author.
 */
export function usedWordFallback(fp: Fingerprint, k = SHINGLE_SIZE): boolean {
  return fp.tokenCount < k;
}

export function similarity(a: Fingerprint, b: Fingerprint): number {
  return containment(a.shingles, b.shingles);
}

/**
 * Shingle → indices, for finding the few candidates worth scoring.
 *
 * Without it every post is compared against every post on the other network.
 * With it, a post is only compared against those sharing at least one run of
 * three words, which for unrelated posts is none at all — so the quadratic
 * term disappears for exactly the pairs that were wasting the time.
 *
 * A shingle shared by too many posts is not evidence of anything and is left
 * out of the index — a run like "i think that" would otherwise link half the
 * feed together and rebuild the quadratic behaviour through the back door.
 *
 * "Too many" is both a fraction of the corpus and an absolute ceiling. The
 * fraction alone is not enough: a bucket holding 10% of the feed grows with
 * the feed, so the work per post grows too and the whole thing is quadratic
 * again. Measured on a synthetic timeline, 200 posts took 0.9ms and 800 took
 * 102ms — 4x the posts for 115x the work. A phrase appearing in forty posts
 * is boilerplate whether the feed holds four hundred or four thousand.
 *
 * A crosspost pair shares nearly all of its shingles, so it is found as long
 * as *one* of them is rare. Only a post whose every run of three words is
 * common to forty others drops out, which is a post that says nothing
 * distinctive.
 */
export class ShingleIndex {
  private readonly byShingle = new Map<string, number[]>();

  constructor(fingerprints: Fingerprint[], maxDocFraction = 0.1, maxDocsAbsolute = 40) {
    const counts = new Map<string, number>();
    for (const fp of fingerprints) {
      for (const s of fp.shingles) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const maxDocs = Math.max(
      2,
      Math.min(maxDocsAbsolute, Math.floor(fingerprints.length * maxDocFraction)),
    );
    for (let i = 0; i < fingerprints.length; i++) {
      for (const s of fingerprints[i].shingles) {
        if ((counts.get(s) ?? 0) > maxDocs) continue;
        const bucket = this.byShingle.get(s);
        if (bucket) bucket.push(i);
        else this.byShingle.set(s, [i]);
      }
    }
  }

  /** Indices sharing at least one indexed shingle with [fp]. */
  candidates(fp: Fingerprint): Set<number> {
    const out = new Set<number>();
    for (const s of fp.shingles) {
      const bucket = this.byShingle.get(s);
      if (bucket) for (const i of bucket) out.add(i);
    }
    return out;
  }
}

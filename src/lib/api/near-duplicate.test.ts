import { describe, it, expect } from 'vitest';
import {
  normalizeForCompare, shingles, containment, fingerprint, similarity, ShingleIndex,
} from './near-duplicate';
import { CROSSPOST_PAIRS } from './crosspost-corpus';

const sim = (a: string, b: string) => similarity(fingerprint(a), fingerprint(b));
const DEFAULT_THRESHOLD = 0.65;
const IDENTITY_THRESHOLD = 0.55;

describe('normalizeForCompare', () => {
  it('drops the things that legitimately differ between networks', () => {
    expect(normalizeForCompare('Hi @alice.bsky.social — see https://x.com/a #news!'))
      .toEqual(['hi', 'alice', 'bsky', 'social', 'see', 'news']);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(normalizeForCompare('The Compiler, finally!')).toEqual(['the', 'compiler', 'finally']);
  });

  it('keeps non-Latin text rather than stripping it as punctuation', () => {
    expect(normalizeForCompare('リリースしました 🚀')).toEqual(['リリースしました']);
  });
});

describe('shingles', () => {
  it('produces overlapping three-word runs', () => {
    expect([...shingles(['a', 'b', 'c', 'd'])]).toEqual(['a b c', 'b c d']);
  });

  it('falls back to words when the text is shorter than one run', () => {
    expect([...shingles(['hi', 'there'])]).toEqual(['hi', 'there']);
  });
});

describe('containment', () => {
  it('is 1 when the shorter set is wholly inside the longer', () => {
    // This is the truncation case, which Jaccard would score 0.5.
    expect(containment(new Set(['a', 'b']), new Set(['a', 'b', 'c', 'd']))).toBe(1);
  });

  it('is 0 for disjoint sets, and safe for empty ones', () => {
    expect(containment(new Set(['a']), new Set(['b']))).toBe(0);
    expect(containment(new Set(), new Set(['a']))).toBe(0);
  });
});

describe('the labelled corpus', () => {
  for (const pair of CROSSPOST_PAIRS.filter((p) => p.same)) {
    it(`groups: ${pair.label}`, () => {
      expect(sim(pair.a, pair.b)).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });
  }
  for (const pair of CROSSPOST_PAIRS.filter((p) => !p.same)) {
    it(`keeps apart: ${pair.label}`, () => {
      // Below the lower of the two thresholds, so an identity match cannot
      // drag it over either.
      expect(sim(pair.a, pair.b)).toBeLessThan(IDENTITY_THRESHOLD);
    });
  }

  it('leaves a usable margin either side of the threshold', () => {
    // A corpus that only just passes is one edit away from not passing.
    const same = CROSSPOST_PAIRS.filter((p) => p.same).map((p) => sim(p.a, p.b));
    const diff = CROSSPOST_PAIRS.filter((p) => !p.same).map((p) => sim(p.a, p.b));
    const worstSame = Math.min(...same);
    const worstDiff = Math.max(...diff);
    expect(worstSame - worstDiff).toBeGreaterThan(0.2);
  });
});

describe('ShingleIndex', () => {
  it('offers only posts that share a run of words', () => {
    const texts = [
      'the compiler finally handles nested generics today',
      'the compiler finally handles nested generics today',
      'our cache batches partial writes after three attempts',
    ];
    const fps = texts.map((t) => fingerprint(t));
    const idx = new ShingleIndex(fps);
    expect([...idx.candidates(fps[0])].sort()).toEqual([0, 1]);
    expect([...idx.candidates(fps[2])]).toEqual([2]);
  });

  it('ignores runs common to most of the corpus', () => {
    // Boilerplate shared by everything would otherwise make every post a
    // candidate for every other, rebuilding the quadratic cost.
    const fps = Array.from({ length: 20 }, (_, i) =>
      fingerprint(`comments welcome the benchmark is in the repo unique${i} words${i} here${i}`));
    const idx = new ShingleIndex(fps);
    expect([...idx.candidates(fps[0])]).toEqual([0]);
  });
});

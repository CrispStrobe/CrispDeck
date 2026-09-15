import { describe, it, expect } from 'vitest';
import { pickAnchor, resolveAnchor, type MeasuredItem } from './feed-scroll';

const items: MeasuredItem[] = [
  { key: 'a', top: 0, height: 200 },
  { key: 'b', top: 200, height: 300 },
  { key: 'c', top: 500, height: 150 },
];

describe('pickAnchor', () => {
  it('returns null for an empty feed', () => {
    expect(pickAnchor([], 400)).toBeNull();
  });

  it('anchors to the first post at the top of the feed', () => {
    expect(pickAnchor(items, 0)).toEqual({ key: 'a', offset: 0 });
  });

  it('anchors to the post straddling the fold, not the next one', () => {
    // Half-way through post b: b is what the reader is looking at.
    expect(pickAnchor(items, 350)).toEqual({ key: 'b', offset: 150 });
  });

  it('anchors exactly at a post boundary to that post', () => {
    expect(pickAnchor(items, 500)).toEqual({ key: 'c', offset: 0 });
  });

  it('clamps a negative scroll (overscroll bounce) to the first post', () => {
    expect(pickAnchor(items, -60)).toEqual({ key: 'a', offset: 0 });
  });

  it('anchors past the end to the last post', () => {
    expect(pickAnchor(items, 9999)).toEqual({ key: 'c', offset: 9499 });
  });
});

describe('resolveAnchor', () => {
  it('returns null without an anchor', () => {
    expect(resolveAnchor(items, null)).toBeNull();
  });

  it('round-trips a position unchanged when the feed is identical', () => {
    for (const scrollTop of [0, 120, 350, 500, 640]) {
      const anchor = pickAnchor(items, scrollTop)!;
      expect(resolveAnchor(items, anchor)).toBe(scrollTop);
    }
  });

  it('follows the post when new posts are prepended above it', () => {
    // This is the case a pixel offset gets wrong: 3 new posts arrived on top,
    // so the same post is now 400px further down and a raw scrollTop would
    // land the reader somewhere they have never been.
    const shifted: MeasuredItem[] = [
      { key: 'new1', top: 0, height: 150 },
      { key: 'new2', top: 150, height: 250 },
      { key: 'a', top: 400, height: 200 },
      { key: 'b', top: 600, height: 300 },
      { key: 'c', top: 900, height: 150 },
    ];
    const anchor = pickAnchor(items, 350)!; // mid-way through b
    expect(resolveAnchor(shifted, anchor)).toBe(750); // still mid-way through b
  });

  it('survives posts above it changing height as images load', () => {
    const grown: MeasuredItem[] = [
      { key: 'a', top: 0, height: 560 },
      { key: 'b', top: 560, height: 300 },
      { key: 'c', top: 860, height: 150 },
    ];
    const anchor = pickAnchor(items, 200)!; // top of b
    expect(resolveAnchor(grown, anchor)).toBe(560); // still top of b
  });

  it('gives up rather than guessing when the anchored post is gone', () => {
    const anchor = pickAnchor(items, 350)!;
    const without = items.filter((i) => i.key !== 'b');
    expect(resolveAnchor(without, anchor)).toBeNull();
  });

  it('never returns a negative scroll target', () => {
    expect(resolveAnchor([{ key: 'a', top: 0, height: 100 }], { key: 'a', offset: -50 })).toBe(0);
  });
});

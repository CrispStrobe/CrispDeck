import { describe, it, expect } from 'vitest';
import { pickAnchor, anchorDelta, type MeasuredItem, type ScrollAnchor } from './feed-scroll';

const items: MeasuredItem[] = [
  { key: 'a', top: 0, height: 200 },
  { key: 'b', top: 200, height: 300 },
  { key: 'c', top: 500, height: 150 },
];

/**
 * The correction restoreAnchor would apply, for a container currently at
 * `scrollTop` over `layout`. An element's viewport top is
 * `containerTop - scrollTop + item.top`, so the container's own top cancels
 * out — which is exactly why the real thing is immune to layout guesses
 * above the anchor.
 */
function deltaFor(layout: MeasuredItem[], scrollTop: number, anchor: ScrollAnchor): number | null {
  const item = layout.find((i) => i.key === anchor.key);
  if (!item) return null;
  const CONTAINER_TOP = 64; // arbitrary; must not affect the result
  return anchorDelta(CONTAINER_TOP - scrollTop + item.top, CONTAINER_TOP, anchor.offset);
}

describe('pickAnchor', () => {
  it('returns null for an empty feed', () => {
    expect(pickAnchor([], 400)).toBeNull();
  });

  it('anchors to the first post at the top of the feed', () => {
    expect(pickAnchor(items, 0)).toEqual({ key: 'a', offset: 0 });
  });

  it('anchors to the post straddling the fold, not the next one', () => {
    // Half-way through post b: b is what the reader is looking at. Picking the
    // first fully-visible post instead would walk the feed forward by one post
    // on every round trip.
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

describe('anchorDelta', () => {
  // `offset` is how far the anchor post had been scrolled off the TOP, so the
  // restored state is the one where the element's top sits `offset` px ABOVE
  // the container's top edge.
  it('is zero when the anchor already sits where it belongs', () => {
    expect(anchorDelta(200, 350, 150)).toBe(0);
  });

  it('is zero for a post pinned flush to the top', () => {
    expect(anchorDelta(350, 350, 0)).toBe(0);
  });

  it('scrolls down when the anchor is still below where it belongs', () => {
    expect(anchorDelta(500, 350, 150)).toBe(300);
  });

  it('scrolls up when the anchor was pushed below the fold', () => {
    expect(anchorDelta(300, 350, 0)).toBe(-50);
  });

  it('depends only on the live gap, never on the container position', () => {
    expect(anchorDelta(1000, 350, 0)).toBe(anchorDelta(2000, 1350, 0));
  });
});

describe('save then restore', () => {
  it('asks for no correction when the feed comes back unchanged', () => {
    for (const scrollTop of [0, 120, 350, 500, 640]) {
      const anchor = pickAnchor(items, scrollTop)!;
      expect(deltaFor(items, scrollTop, anchor)).toBe(0);
    }
  });

  it('lands on a fresh page at the position the reader left', () => {
    // The restore case: page re-mounted, container back at the top.
    const anchor = pickAnchor(items, 350)!;
    expect(deltaFor(items, 0, anchor)).toBe(350);
  });

  it('follows the post when new posts are prepended above it', () => {
    // This is what a raw pixel offset gets wrong: three posts arrived on top,
    // so the same post is 400px further down and the old scrollTop would land
    // the reader somewhere they have never been.
    const shifted: MeasuredItem[] = [
      { key: 'new1', top: 0, height: 150 },
      { key: 'new2', top: 150, height: 250 },
      { key: 'a', top: 400, height: 200 },
      { key: 'b', top: 600, height: 300 },
      { key: 'c', top: 900, height: 150 },
    ];
    const anchor = pickAnchor(items, 350)!; // mid-way through b
    expect(deltaFor(shifted, 0, anchor)).toBe(750); // still mid-way through b
  });

  it('survives posts above it changing height as images load', () => {
    const grown: MeasuredItem[] = [
      { key: 'a', top: 0, height: 560 },
      { key: 'b', top: 560, height: 300 },
      { key: 'c', top: 860, height: 150 },
    ];
    const anchor = pickAnchor(items, 200)!; // top of b
    expect(deltaFor(grown, 0, anchor)).toBe(560); // still top of b
  });

  it('converges when an intrinsic-size guess is corrected mid-restore', () => {
    // content-visibility reports unrendered posts at their guessed height, so
    // the first pass aims short; the second pass, after those posts rendered
    // at full size, finishes the job rather than compounding the error.
    const guessed: MeasuredItem[] = [
      { key: 'a', top: 0, height: 256 },
      { key: 'b', top: 256, height: 256 },
    ];
    const real: MeasuredItem[] = [
      { key: 'a', top: 0, height: 700 },
      { key: 'b', top: 700, height: 300 },
    ];
    const anchor: ScrollAnchor = { key: 'b', offset: 0 };
    const first = deltaFor(guessed, 0, anchor)!;
    expect(first).toBe(256);
    const second = deltaFor(real, first, anchor)!;
    expect(first + second).toBe(700); // exactly the anchor's true position
  });

  it('gives up rather than guessing when the anchored post is gone', () => {
    const anchor = pickAnchor(items, 350)!;
    expect(deltaFor(items.filter((i) => i.key !== 'b'), 0, anchor)).toBeNull();
  });
});

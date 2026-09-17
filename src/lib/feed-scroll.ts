/**
 * Keep a feed's reading position across navigation.
 *
 * Opening a post is a real navigation (`/thread?uri=…`), so coming back
 * re-mounts the feed page from scratch. SvelteKit restores window scroll on a
 * back navigation, but the app scrolls `#main-content`, not the window, so
 * there was nothing to restore and every return landed at the top.
 *
 * Restoring a raw pixel offset does not work either. The feed reloads, images
 * arrive at unpredictable times, and a post that was 900px down before is
 * somewhere else after. So we anchor to *a post* instead: remember which post
 * was at the top of the viewport and how far above the fold it was, then on
 * return scroll to wherever that post now sits. If it has fallen out of the
 * feed entirely, we leave the user at the top rather than guessing.
 */

export interface ScrollAnchor {
  /** Key of the post that was at the top of the viewport. */
  key: string;
  /** Pixels of that post scrolled off the top — usually 0..postHeight. */
  offset: number;
}

export interface MeasuredItem {
  key: string;
  /** Item's top edge in the scroll container's coordinate space. */
  top: number;
  height: number;
}

/**
 * The item the reader is looking at: the last one whose top edge is at or
 * above the fold. Picking the *first visible* item instead would jump the page
 * forward by one post each round trip, because a post straddling the fold is
 * both partly read and partly not.
 */
export function pickAnchor(items: MeasuredItem[], scrollTop: number): ScrollAnchor | null {
  if (items.length === 0) return null;
  if (scrollTop <= 0) return { key: items[0].key, offset: 0 };

  let chosen = items[0];
  for (const item of items) {
    if (item.top <= scrollTop) chosen = item;
    else break;
  }
  return { key: chosen.key, offset: Math.round(scrollTop - chosen.top) };
}

/** Measure the feed items currently in `container`, in document order. */
export function measureItems(container: HTMLElement): MeasuredItem[] {
  const base = container.getBoundingClientRect().top - container.scrollTop;
  const out: MeasuredItem[] = [];
  for (const el of container.querySelectorAll<HTMLElement>('[data-feed-key]')) {
    const r = el.getBoundingClientRect();
    out.push({ key: el.dataset.feedKey!, top: Math.round(r.top - base), height: Math.round(r.height) });
  }
  return out;
}

/**
 * How far to move `container` to put the anchored element back under the fold.
 *
 * Deliberately a *relative* correction measured from the element's own
 * rectangle, not an absolute position summed from every item's height. Feed
 * items use `content-visibility: auto`, so a post that has never been on
 * screen reports its `contain-intrinsic-size` guess rather than its real
 * height — summing those would aim at a position that does not exist. The
 * element's live rect is exact for the layout as it stands right now, whatever
 * the items above it currently claim to be.
 */
export function anchorDelta(elementTop: number, containerTop: number, offset: number): number {
  return elementTop - containerTop + offset;
}

/**
 * Scroll `container` so the anchored post is back under the fold line.
 *
 * Iterates, because one pass cannot be right: scrolling renders the posts it
 * passes over, which replaces their intrinsic-size guesses with real heights
 * and moves the anchor again. Each pass re-measures and applies the remaining
 * correction, so the error shrinks to zero instead of compounding. Stops early
 * once the anchor is within a pixel of where it belongs.
 */
export function restoreAnchor(
  container: HTMLElement,
  anchor: ScrollAnchor | null,
  attempts = 10,
): void {
  if (!anchor) return;
  let n = 0;

  // Scanned rather than selected: a key is an at:// URI full of colons and
  // slashes, and matching on the dataset value sidesteps every question about
  // escaping it into an attribute selector.
  const find = () => {
    for (const el of container.querySelectorAll<HTMLElement>('[data-feed-key]')) {
      if (el.dataset.feedKey === anchor.key) return el;
    }
    return null;
  };

  const step = () => {
    const el = find();
    if (!el) {
      // The post has not rendered yet — it may still be arriving. Keep
      // looking, but never fall back to a pixel guess if it never shows.
      if (++n < attempts) requestAnimationFrame(step);
      return;
    }
    const delta = anchorDelta(
      el.getBoundingClientRect().top,
      container.getBoundingClientRect().top,
      anchor.offset,
    );
    if (Math.abs(delta) <= 1) return;
    container.scrollTop += delta;
    if (++n < attempts) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

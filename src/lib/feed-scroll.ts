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

/**
 * Where to scroll so the anchored post sits where it sat before.
 *
 * Returns null when the anchor is gone — the post was deleted, filtered out,
 * or has not loaded yet. The caller must not fall back to a pixel guess: a
 * wrong restore is more disorienting than no restore, because the reader
 * cannot tell they have been moved.
 */
export function resolveAnchor(items: MeasuredItem[], anchor: ScrollAnchor | null): number | null {
  if (!anchor) return null;
  const item = items.find((i) => i.key === anchor.key);
  if (!item) return null;
  return Math.max(0, item.top + anchor.offset);
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
 * Scroll `container` so the anchored post is back under the fold line.
 *
 * Retries across a few frames because the feed settles asynchronously: posts
 * stream in, avatars load, embeds resolve. Each attempt re-measures, so a
 * later reflow corrects an earlier approximation instead of compounding it.
 * Stops as soon as two consecutive attempts agree, which is the signal that
 * layout has stopped moving.
 */
export function restoreAnchor(
  container: HTMLElement,
  anchor: ScrollAnchor | null,
  attempts = 6,
): void {
  if (!anchor) return;
  let last = -1;
  let settled = 0;
  let n = 0;

  const step = () => {
    const target = resolveAnchor(measureItems(container), anchor);
    if (target === null) {
      // Anchor not rendered yet — keep looking until we run out of attempts.
      if (++n < attempts) requestAnimationFrame(step);
      return;
    }
    container.scrollTop = target;
    settled = target === last ? settled + 1 : 0;
    last = target;
    if (settled < 2 && ++n < attempts) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

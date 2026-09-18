/**
 * Windowing maths for the feed's virtual list.
 *
 * The feed mounts every loaded post: DOM nodes, Svelte effects and a Jetstream
 * watch per post all grow without bound as you scroll. This module decides
 * which slice of the list actually needs to exist, and how much empty space to
 * leave above and below it so the scrollbar and scroll position stay honest.
 *
 * It is deliberately pure — no DOM, no observers — so the behaviour that is
 * easy to get subtly wrong (off-by-one at the edges, drift between the padding
 * and the real content height) is testable on its own.
 */

export interface VirtualWindow {
  /** First index to render, inclusive. */
  start: number;
  /** One past the last index to render. */
  end: number;
  /** Spacer height before the rendered slice, in px. */
  padTop: number;
  /** Spacer height after the rendered slice, in px. */
  padBottom: number;
  /** Total height of the whole list, in px. */
  total: number;
}

export interface WindowOptions {
  /** Number of items in the list. */
  count: number;
  /** Height of item i — measured if known, else an estimate. */
  heightAt: (index: number) => number;
  /** Scroll offset of the viewport's top edge, relative to the list's top. */
  viewportTop: number;
  /** Visible height. */
  viewportHeight: number;
  /**
   * Extra px rendered beyond each edge. Generous overscan trades memory for
   * never showing a blank gap during a fast flick.
   */
  overscanPx?: number;
}

/**
 * Decide which items to render.
 *
 * Guarantees, all covered by tests:
 *   - padTop + (height of rendered items) + padBottom === total, exactly, so
 *     the scrollbar never drifts as the window moves;
 *   - every item intersecting [viewportTop, viewportTop + viewportHeight] is
 *     inside the window;
 *   - at least one item is rendered whenever count > 0.
 */
export function computeWindow(options: WindowOptions): VirtualWindow {
  const { count, heightAt, viewportTop, viewportHeight } = options;
  const overscanPx = options.overscanPx ?? 0;

  if (count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 };

  const top = viewportTop - overscanPx;
  const bottom = viewportTop + viewportHeight + overscanPx;

  let offset = 0;
  let start = -1;
  let end = count;
  let padTop = 0;

  for (let i = 0; i < count; i++) {
    const h = heightAt(i);
    const itemTop = offset;
    const itemBottom = offset + h;

    if (start === -1 && itemBottom > top) {
      start = i;
      padTop = itemTop;
    }
    if (start !== -1 && itemTop >= bottom) {
      end = i;
      break;
    }
    offset = itemBottom;
  }

  // Scrolled past everything: keep the last item mounted rather than nothing.
  if (start === -1) {
    start = count - 1;
    padTop = 0;
    for (let i = 0; i < start; i++) padTop += heightAt(i);
    end = count;
  }
  if (end <= start) end = Math.min(start + 1, count);

  // Total and padBottom are derived from the same per-item heights as padTop,
  // so the three always sum to the full list height.
  let total = 0;
  for (let i = 0; i < count; i++) total += heightAt(i);

  let rendered = 0;
  for (let i = start; i < end; i++) rendered += heightAt(i);

  return { start, end, padTop, padBottom: total - padTop - rendered, total };
}

/**
 * Remembers how tall each item turned out to be.
 *
 * Posts vary wildly — a one-line reply next to a four-image quote post — so a
 * single estimate would make the scrollbar jump as items are measured. Heights
 * are keyed by item id rather than index so they survive prepends and
 * reordering, which a feed does on refresh.
 */
export class HeightCache {
  private heights = new Map<string, number>();
  private measuredTotal = 0;

  constructor(private fallback: number) {}

  /**
   * Height to assume for an item that hasn't been rendered yet.
   *
   * The mean of what has actually been measured, rather than a fixed guess:
   * the total list height drives the scrollbar, so a constant estimate that is
   * off by 40% makes the scrollbar 40% wrong until every item has been seen.
   * The running mean converges after the first screenful.
   */
  get estimate(): number {
    return this.heights.size > 0 ? this.measuredTotal / this.heights.size : this.fallback;
  }

  get(key: string): number {
    const known = this.heights.get(key);
    return known !== undefined ? known : this.estimate;
  }

  /** Returns true if the stored height changed meaningfully. */
  set(key: string, height: number): boolean {
    if (!(height > 0)) return false;
    const previous = this.heights.get(key);
    // Sub-pixel churn from font loading or zoom shouldn't retrigger layout.
    if (previous !== undefined && Math.abs(previous - height) < 1) return false;
    if (previous !== undefined) this.measuredTotal -= previous;
    this.measuredTotal += height;
    this.heights.set(key, height);
    return true;
  }

  has(key: string): boolean {
    return this.heights.has(key);
  }

  /** Forget entries no longer in the list, so the map can't grow forever. */
  retain(keys: Iterable<string>): void {
    const keep = keys instanceof Set ? keys : new Set(keys);
    for (const [k, h] of this.heights) {
      if (!keep.has(k)) {
        this.measuredTotal -= h;
        this.heights.delete(k);
      }
    }
  }

  get size(): number {
    return this.heights.size;
  }
}

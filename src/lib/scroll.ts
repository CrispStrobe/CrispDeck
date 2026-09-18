/**
 * Finding the element that actually scrolls.
 *
 * The app shell is `flex h-screen` with `overflow: hidden` on html/body and a
 * scrolling `<main class="overflow-y-auto">` inside it, so the window never
 * scrolls: `window.scrollY` is always 0 and `window.addEventListener('scroll')`
 * never fires for page content. Anything reasoning about scroll position has to
 * ask the scroll parent instead.
 */

/**
 * Nearest ancestor that scrolls vertically, or null when the document itself
 * is the scroller (which is the case outside the app shell, and in tests).
 */
export function findScrollParent(from: HTMLElement | null): HTMLElement | null {
  let node = from?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/** Current scroll offset of `el`'s scroll parent, or of the window. */
export function scrollTopOf(el: HTMLElement | null): number {
  const parent = findScrollParent(el);
  if (parent) return parent.scrollTop;
  return window.scrollY || document.documentElement.scrollTop || 0;
}

/** True when `el`'s scroller is at the very top. */
export function isAtScrollTop(el: HTMLElement | null, tolerancePx = 1): boolean {
  return scrollTopOf(el) <= tolerancePx;
}

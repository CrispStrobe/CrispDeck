<!--
  Windowed list for the feed.

  Renders only the slice of `items` near the viewport, with spacers standing in
  for the rest, so DOM nodes, component instances and per-post subscriptions
  stay bounded no matter how far you scroll.

  Scrolling is tracked on the nearest scrollable ancestor, falling back to the
  window. The app layout scrolls an inner <main class="overflow-y-auto">, not the
  document, so assuming page scroll would leave the window pinned at zero and
  every item mounted.

  Heights are measured as items render and remembered per item key, so the
  scrollbar settles instead of jumping as estimates are replaced by real
  measurements.
-->
<script lang="ts" generics="T">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { computeWindow, HeightCache } from '$lib/virtual-list';
  import { findScrollParent } from '$lib/scroll';

  let {
    items,
    key,
    estimate = 240,
    overscanPx = 1200,
    item,
  }: {
    items: T[];
    /** Stable identity per item — heights are remembered against it. */
    key: (value: T, index: number) => string;
    /** Assumed height before an item has been measured. */
    estimate?: number;
    /** Extra px rendered beyond each viewport edge. */
    overscanPx?: number;
    item: Snippet<[T, number]>;
  } = $props();

  let container = $state<HTMLElement | null>(null);
  let observer: ResizeObserver | null = null;
  /** The element that actually scrolls; null means the window does. */
  let scroller: HTMLElement | null = null;

  let viewportTop = $state(0);
  let viewportHeight = $state(0);
  /** Bumped whenever a measurement changes, to re-run the window. */
  let measureTick = $state(0);

  // `estimate` is only the starting guess for unmeasured items, read once.
  const cache = new HeightCache(untrack(() => estimate));

  const window_ = $derived.by(() => {
    measureTick; // re-run when heights change
    return computeWindow({
      count: items.length,
      heightAt: (i) => cache.get(key(items[i], i)),
      viewportTop,
      viewportHeight,
      overscanPx,
    });
  });

  const visible = $derived(items.slice(window_.start, window_.end));

  function readViewport() {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // How far the list's top has travelled above the scroller's top edge.
    const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
    viewportTop = Math.max(0, scrollerTop - rect.top);
    viewportHeight = scroller ? scroller.clientHeight : window.innerHeight;
  }

  onMount(() => {
    scroller = findScrollParent(container);
    readViewport();

    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        readViewport();
      });
    };

    const scrollTarget: HTMLElement | Window = scroller ?? window;
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    // Measure rendered items; a post's height changes when images load.
    observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const k = (entry.target as HTMLElement).dataset.vkey;
        if (!k) continue;
        if (cache.set(k, (entry.target as HTMLElement).offsetHeight)) changed = true;
      }
      if (changed) measureTick++;
    });

    return () => {
      scrollTarget.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      observer?.disconnect();
      observer = null;
    };
  });

  /** Attach measurement to each rendered row. */
  function measure(node: HTMLElement) {
    observer?.observe(node);
    // Measure immediately too — ResizeObserver's first callback is async, and
    // the window should not be computed from the estimate for a whole frame.
    const k = node.dataset.vkey;
    if (k && cache.set(k, node.offsetHeight)) measureTick++;
    return {
      destroy() {
        observer?.unobserve(node);
      },
    };
  }

  // Forget heights for items that have left the list.
  $effect(() => {
    const keys = new Set(items.map((v, i) => key(v, i)));
    if (cache.size > keys.size * 2 + 64) cache.retain(keys);
  });
</script>

<div bind:this={container}>
  <div style:height="{window_.padTop}px" aria-hidden="true"></div>
  {#each visible as value, offset (key(value, window_.start + offset))}
    <div data-vkey={key(value, window_.start + offset)} use:measure>
      {@render item(value, window_.start + offset)}
    </div>
  {/each}
  <div style:height="{window_.padBottom}px" aria-hidden="true"></div>
</div>

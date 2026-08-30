<script lang="ts">
  import { untrack } from 'svelte';
  import { X, ChevronLeft, ChevronRight, ExternalLink } from '@lucide/svelte';
  import { haptic } from '$lib/haptics';

  export interface LightboxItem {
    url: string;
    thumb?: string;
    alt?: string;
    type?: 'image' | 'video' | 'gifv';
  }

  let {
    items = [],
    index = 0,
    onclose,
  }: {
    items: LightboxItem[];
    index?: number;
    onclose?: () => void;
  } = $props();

  // Untracked seed; the effect below is what keeps it in step with the prop,
  // while prev()/next() move it locally in between.
  let currentIndex = $state(untrack(() => index));

  $effect(() => { currentIndex = index; });

  function close() { onclose?.(); }
  function prev() { if (currentIndex > 0) { currentIndex--; haptic('selection'); } }
  function next() { if (currentIndex < items.length - 1) { currentIndex++; haptic('selection'); } }

  // Touch swipe support
  let touchStartX = 0;
  let touchStartY = 0;
  let swipeX = $state(0);

  function onTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swipeX = 0;
  }
  function onTouchMove(e: TouchEvent) {
    swipeX = e.touches[0].clientX - touchStartX;
  }
  function onTouchEnd() {
    const deltaY = 0; // vertical tracked via swipeX proxy — use separate if needed
    if (Math.abs(swipeX) > 50) {
      if (swipeX < 0) next(); else prev();
    }
    swipeX = 0;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).dataset.backdrop) close();
  }

  const current = $derived(items[currentIndex]);
</script>

{#if items.length > 0 && current}
  <!-- svelte-ignore a11y_autofocus -->
  <div
    class="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
    role="dialog"
    tabindex="-1"
    data-backdrop="true"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    autofocus
  >
    <!-- Close button -->
    <button
      onclick={close}
      class="absolute top-4 right-4 z-10 p-2 text-white/70 hover:text-white bg-black/40 rounded-full transition-colors"
    >
      <X size={20} />
    </button>

    <!-- Open in browser -->
    <a
      href={current.url}
      target="_blank"
      rel="noopener noreferrer"
      class="absolute top-4 right-16 z-10 p-2 text-white/70 hover:text-white bg-black/40 rounded-full transition-colors"
      title="Open in browser"
      onclick={(e) => e.stopPropagation()}
    >
      <ExternalLink size={18} />
    </a>

    <!-- Counter -->
    {#if items.length > 1}
      <div class="absolute top-4 left-4 z-10 px-3 py-1 text-sm text-white/70 bg-black/40 rounded-full">
        {currentIndex + 1} / {items.length}
      </div>
    {/if}

    <!-- Previous -->
    {#if currentIndex > 0}
      <button
        onclick={(e) => { e.stopPropagation(); prev(); }}
        class="absolute left-4 z-10 p-2 text-white/70 hover:text-white bg-black/40 rounded-full transition-colors"
      >
        <ChevronLeft size={24} />
      </button>
    {/if}

    <!-- Next -->
    {#if currentIndex < items.length - 1}
      <button
        onclick={(e) => { e.stopPropagation(); next(); }}
        class="absolute right-4 z-10 p-2 text-white/70 hover:text-white bg-black/40 rounded-full transition-colors"
      >
        <ChevronRight size={24} />
      </button>
    {/if}

    <!-- Media -->
    <!-- Swipe surface. The onclick={stopPropagation} that used to sit here was
         dead: handleBackdropClick only closes when the click target itself
         carries data-backdrop, which only the root element does. Swiping has
         keyboard equivalents already — arrow keys on the dialog, and the
         prev/next buttons. -->
    <div
      role="group"
      aria-label="Media viewer"
      class="max-w-[90vw] max-h-[85vh] flex flex-col items-center"
      ontouchstart={onTouchStart}
      ontouchmove={onTouchMove}
      ontouchend={onTouchEnd}
      style="transform: translateX({swipeX * 0.4}px); transition: {swipeX === 0 ? 'transform 0.2s ease-out' : 'none'}"
    >
      {#if current.type === 'video' || current.type === 'gifv'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={current.url}
          controls
          autoplay
          loop={current.type === 'gifv'}
          class="max-w-full max-h-[80vh] rounded-lg"
        ></video>
      {:else}
        <img
          src={current.url}
          alt={current.alt || ''}
          class="max-w-full max-h-[80vh] rounded-lg object-contain"
          draggable="false"
        />
      {/if}
      {#if current.alt}
        <p class="mt-3 text-sm text-white/60 max-w-xl text-center line-clamp-3">{current.alt}</p>
      {/if}
    </div>
  </div>
{/if}

<script lang="ts">
  import { ArrowUp } from '@lucide/svelte';
  import { onMount } from 'svelte';

  let visible = $state(false);
  let scrollContainer: HTMLElement | null = null;

  onMount(() => {
    scrollContainer = document.getElementById('main-content');
    if (!scrollContainer) return;

    function onScroll() {
      visible = (scrollContainer?.scrollTop ?? 0) > 800;
    }

    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollContainer?.removeEventListener('scroll', onScroll);
  });

  function scrollToTop() {
    scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

{#if visible}
  <button
    onclick={scrollToTop}
    class="fixed bottom-20 md:bottom-6 right-16 md:right-6 z-40 p-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full shadow-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-all scroll-top-enter"
    aria-label="Scroll to top"
    title="Scroll to top"
  >
    <ArrowUp size={18} />
  </button>
{/if}

<style>
  .scroll-top-enter {
    animation: scroll-top-in 0.2s ease-out;
  }
  @keyframes scroll-top-in {
    from { opacity: 0; transform: translateY(8px) scale(0.9); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .scroll-top-enter { animation: none; }
  }
</style>

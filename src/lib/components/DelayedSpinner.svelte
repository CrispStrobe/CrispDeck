<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  let { delay = 100, children }: { delay?: number; children: Snippet } = $props();
  let show = $state(false);

  onMount(() => {
    const timer = setTimeout(() => show = true, delay);
    return () => clearTimeout(timer);
  });
</script>

{#if show}
  {@render children()}
{/if}

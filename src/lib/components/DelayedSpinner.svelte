<script lang="ts">
  import { onMount } from 'svelte';

  let { delay = 100 }: { delay?: number } = $props();
  let show = $state(false);

  onMount(() => {
    const timer = setTimeout(() => show = true, delay);
    return () => clearTimeout(timer);
  });
</script>

{#if show}
  <slot />
{/if}

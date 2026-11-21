<script lang="ts">
  import type { Platform } from '$lib/types';

  let {
    src,
    label = '',
    platform = 'bluesky',
    size = 'md',
  }: {
    src?: string | null;
    label?: string;
    platform?: Platform;
    size?: 'xs' | 'sm' | 'md';
  } = $props();

  // Remote avatars expire (Threads profile pictures in particular). A failed
  // image must fall back to the platform mark instead of the browser's broken
  // image glyph.
  let failed = $state(false);
  $effect(() => {
    const value = src;
    if (value) failed = false;
  });

  const dimensions = $derived(size === 'xs' ? 'w-5 h-5 text-[8px]' : size === 'sm' ? 'w-7 h-7 text-xs' : 'w-8 h-8 text-xs');
  const mark = $derived(platform === 'threads' ? 'T' : platform === 'mastodon' ? 'M' : platform === 'bluesky' ? 'BS' : (label.trim()[0] ?? '?').toUpperCase());
  const color = $derived(platform === 'threads' ? 'var(--color-threads, #000)' : platform === 'mastodon' ? 'var(--color-mastodon)' : 'var(--color-bluesky)');
</script>

{#if src && !failed}
  <img
    {src}
    alt=""
    loading="lazy"
    class="{dimensions} rounded-full flex-shrink-0 object-cover"
    onerror={() => { failed = true; }}
  />
{:else}
  <div
    class="{dimensions} rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white"
    style="background: {color}"
    aria-hidden="true"
  >
    {mark}
  </div>
{/if}

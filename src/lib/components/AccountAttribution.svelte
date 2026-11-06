<script lang="ts">
  import { base } from '$app/paths';
  import type { Platform } from '$lib/types';
  let { platform, account }: { platform: Platform; account: string } = $props();
  const names: Record<Platform, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon', threads: 'Threads' };
  const shortHandle = $derived.by(() => {
    const value = account.replace(/^@/, '');
    return `@${value.split('@')[0].split('.')[0]}`;
  });
</script>
<span class="account-attribution" aria-label="{names[platform]}: {account}" title="{names[platform]}: {account}">
  <img src="{base}/platform-icons/{platform}.svg" alt="" width="13" height="13" />
  <span>via {shortHandle}</span>
</span>
<style>
  .account-attribution { position:absolute; top:-.25rem; right:.5rem; display:inline-flex; align-items:center; gap:.25rem; padding:.125rem .375rem; border-radius:9999px; background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text-muted); font-size:.625rem; z-index:10; }
  img { width:13px; height:13px; flex:none; }
</style>

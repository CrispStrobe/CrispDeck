<script lang="ts">
  import { onMount } from 'svelte';
  import { Bookmark, Loader2, Inbox } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { listBookmarks } from '$lib/bookmarks';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost } from '$lib/types';

  let posts: UnifiedPost[] = $state([]);
  let loading = $state(true);

  onMount(async () => {
    posts = await listBookmarks();
    loading = false;
  });
</script>

<svelte:head><title>CrispDeck — Bookmarks</title></svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Bookmark size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.bookmarks.title}</h1>
    {#if posts.length > 0}
      <span class="text-sm text-[var(--color-text-muted)]">({posts.length})</span>
    {/if}
  </div>

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else if posts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Bookmark size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.bookmarks.noBookmarks}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.bookmarks.hint}</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each posts as post (post.uri)}
        <Post {post} />
      {/each}
    </div>
  {/if}
</div>

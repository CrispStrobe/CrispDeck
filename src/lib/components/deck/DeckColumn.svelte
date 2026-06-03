<script lang="ts">
  import { onMount } from 'svelte';
  import { X, RefreshCw, Loader2, GripVertical } from '@lucide/svelte';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost } from '$lib/types';

  export type ColumnType = 'timeline' | 'mentions' | 'notifications' | 'my-posts' | 'search' | 'list' | 'hashtag' | 'user' | 'feed';

  let {
    id,
    title,
    type,
    posts = [],
    loading = false,
    onrefresh,
    onremove,
    onlike,
    onboost,
  }: {
    id: string;
    title: string;
    type: ColumnType;
    posts: UnifiedPost[];
    loading?: boolean;
    onrefresh?: () => void;
    onremove?: () => void;
    onlike?: (post: UnifiedPost) => void;
    onboost?: (post: UnifiedPost) => void;
  } = $props();
</script>

<div class="flex flex-col h-full min-w-[350px] max-w-[400px] bg-[var(--color-bg)] border-r border-[var(--color-border)]">
  <!-- Column header -->
  <div class="flex items-center justify-between px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex-shrink-0">
    <div class="flex items-center gap-2">
      <GripVertical size={14} class="text-[var(--color-text-muted)] cursor-grab" />
      <span class="text-sm font-medium truncate">{title}</span>
    </div>
    <div class="flex items-center gap-1">
      {#if onrefresh}
        <button onclick={onrefresh} disabled={loading} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
          <RefreshCw size={12} class={loading ? 'animate-spin' : ''} />
        </button>
      {/if}
      {#if onremove}
        <button onclick={onremove} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors">
          <X size={12} />
        </button>
      {/if}
    </div>
  </div>

  <!-- Column content -->
  <div class="flex-1 overflow-y-auto p-2 space-y-2">
    {#if loading && posts.length === 0}
      <div class="text-center py-8">
        <Loader2 size={20} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
      </div>
    {:else if posts.length === 0}
      <p class="text-center py-8 text-xs text-[var(--color-text-muted)]">No posts</p>
    {:else}
      {#each posts as post (post.uri)}
        <Post {post} {onlike} {onboost} />
      {/each}
    {/if}
  </div>
</div>

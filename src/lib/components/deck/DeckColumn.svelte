<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { X, RefreshCw, Loader2, GripVertical, Heart, Repeat, UserPlus, MessageCircle, AtSign, Bell, Quote, ChevronDown, ChevronUp, Radio } from '@lucide/svelte';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost } from '$lib/types';
  import type { NotificationGroup } from '$lib/notification-grouping';
  import { i18n } from '$lib/i18n.svelte';

  export type ColumnType = 'timeline' | 'mentions' | 'notifications' | 'my-posts' | 'search' | 'list' | 'hashtag' | 'user' | 'feed' | 'local' | 'federated' | 'tag-group' | 'rss' | 'keyword-monitor' | 'threads-search';

  let {
    id,
    title,
    type,
    posts = [],
    notificationGroups = [],
    loading = false,
    streaming = false,
    width = 380,
    onrefresh,
    onremove,
    onlike,
    onboost,
    onwidthchange,
    ondragstart: onDragStart,
    ondragover: onDragOver,
    ondrop: onDrop,
  }: {
    id: string;
    title: string;
    type: ColumnType;
    posts: UnifiedPost[];
    notificationGroups?: NotificationGroup[];
    loading?: boolean;
    streaming?: boolean;
    width?: number;
    onrefresh?: () => void;
    onremove?: () => void;
    onlike?: (post: UnifiedPost) => void;
    onboost?: (post: UnifiedPost) => void;
    onwidthchange?: (width: number) => void;
    ondragstart?: (e: DragEvent) => void;
    ondragover?: (e: DragEvent) => void;
    ondrop?: (e: DragEvent) => void;
  } = $props();

  let expandedGroups: Set<string> = $state(new Set());

  function toggleGroup(groupId: string) {
    const next = new Set(expandedGroups);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    expandedGroups = next;
  }

  function getNotifIcon(ntype: string) {
    switch (ntype) {
      case 'like': case 'favourite': return Heart;
      case 'repost': case 'reblog': return Repeat;
      case 'follow': return UserPlus;
      case 'mention': return AtSign;
      case 'reply': return MessageCircle;
      case 'quote': return Quote;
      default: return Bell;
    }
  }

  function getNotifColor(ntype: string): string {
    switch (ntype) {
      case 'like': case 'favourite': return 'text-red-400';
      case 'repost': case 'reblog': return 'text-green-400';
      case 'follow': return 'text-blue-400';
      case 'mention': case 'reply': return 'text-yellow-400';
      case 'quote': return 'text-purple-400';
      default: return 'text-[var(--color-text-muted)]';
    }
  }

  function getNotifActionText(ntype: string, count: number): string {
    if (count === 1) {
      switch (ntype) {
        case 'like': return i18n.t.notifications.liked;
        case 'repost': return i18n.t.notifications.boosted;
        case 'follow': return i18n.t.notifications.followed;
        case 'mention': return i18n.t.notifications.mentioned;
        case 'reply': return i18n.t.notifications.replied;
        case 'quote': return i18n.t.notifications.quoted;
        default: return ntype;
      }
    }
    switch (ntype) {
      case 'like': return i18n.t.notifications.likedGroup.replace('{count}', String(count));
      case 'repost': return i18n.t.notifications.boostedGroup.replace('{count}', String(count));
      case 'follow': return i18n.t.notifications.followedGroup.replace('{count}', String(count));
      default: return ntype;
    }
  }

  function formatNotifTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000) return i18n.t.notifications.justNow;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /** Whether this column should render grouped notifications instead of posts */
  const useGroupedNotifs = $derived(type === 'notifications' && notificationGroups.length > 0);

  let filterText = $state('');
  let debouncedFilter = $state('');
  let filterTimer: ReturnType<typeof setTimeout> | undefined;

  function onFilterInput(value: string) {
    filterText = value;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { debouncedFilter = value; }, 200);
  }

  const POST_PAGE_SIZE = 50;
  let visiblePostCount = $state(POST_PAGE_SIZE);

  const filteredPosts = $derived(
    debouncedFilter
      ? posts.filter(p => {
          const q = debouncedFilter.toLowerCase();
          return p.text.toLowerCase().includes(q) || p.author.handle.toLowerCase().includes(q);
        })
      : posts
  );
  const visiblePosts = $derived(filteredPosts.slice(0, visiblePostCount));
  const hasMorePosts = $derived(filteredPosts.length > visiblePostCount);

  // Resize handle
  let resizing = $state(false);
  let startX = 0;
  let startWidth = 0;

  function onResizeStart(e: MouseEvent) {
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startWidth = width;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }

  function onResizeMove(e: MouseEvent) {
    if (!resizing) return;
    const delta = e.clientX - startX;
    const newWidth = Math.max(280, Math.min(600, startWidth + delta));
    width = newWidth;
  }

  function onResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
    onwidthchange?.(width);
  }

  onDestroy(() => {
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  });
</script>

<div
  class="flex flex-col h-full bg-[var(--color-bg)] border-r border-[var(--color-border)] relative flex-shrink-0"
  style="width: {width}px"
  draggable="true"
  ondragstart={onDragStart}
  ondragover={onDragOver}
  ondrop={onDrop}
>
  <!-- Column header -->
  <div class="flex items-center justify-between px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex-shrink-0">
    <div class="flex items-center gap-2">
      <GripVertical size={14} class="text-[var(--color-text-muted)] cursor-grab" />
      <span class="text-sm font-medium truncate">{title}</span>
      {#if streaming}
        <span class="flex items-center gap-1 text-[9px] text-green-400 font-medium" title="Live streaming">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
          </span>
          LIVE
        </span>
      {/if}
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

  <!-- Inline filter -->
  <div class="px-2 py-1 border-b border-[var(--color-border)]">
    <input
      type="text"
      value={filterText}
      oninput={(e) => onFilterInput((e.target as HTMLInputElement).value)}
      placeholder="Filter..."
      class="w-full px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[10px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
    />
  </div>

  <!-- Column content -->
  <div class="flex-1 overflow-y-auto p-2 space-y-2">
    {#if loading && filteredPosts.length === 0 && notificationGroups.length === 0}
      <div class="text-center py-8">
        <Loader2 size={20} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
      </div>
    {:else if useGroupedNotifs}
      <!-- Grouped notification rendering for notification columns -->
      {#each notificationGroups as group (group.id)}
        {@const NIcon = getNotifIcon(group.type)}
        {@const isGrouped = group.actors.length > 1}
        {@const isExpanded = expandedGroups.has(group.id)}
        <div class="rounded-lg hover:bg-[var(--color-surface)] transition-colors">
          <div class="flex items-start gap-2 p-2">
            <div class="flex-shrink-0 mt-0.5 {getNotifColor(group.type)}">
              <NIcon size={12} />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-[11px]">
                {#if isGrouped}
                  <div class="flex -space-x-1.5 mb-1">
                    {#each group.actors.slice(0, 3) as actor}
                      {#if actor.avatar}
                        <img loading="lazy" src={actor.avatar} alt="" class="w-5 h-5 rounded-full border border-[var(--color-bg)]" />
                      {/if}
                    {/each}
                    {#if group.actors.length > 3}
                      <span class="w-5 h-5 rounded-full bg-[var(--color-surface)] border border-[var(--color-bg)] flex items-center justify-center text-[8px] font-bold text-[var(--color-text-muted)]">
                        +{group.actors.length - 3}
                      </span>
                    {/if}
                  </div>
                  <span class="font-semibold">{group.actors[0].displayName || group.actors[0].handle}</span>
                  <span class="text-[var(--color-text-muted)]"> {getNotifActionText(group.type, group.actors.length)}</span>
                  <button onclick={() => toggleGroup(group.id)} class="inline-flex ml-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    {#if isExpanded}<ChevronUp size={10} />{:else}<ChevronDown size={10} />{/if}
                  </button>
                {:else}
                  {#if group.actors[0]?.avatar}
                    <img loading="lazy" src={group.actors[0].avatar} alt="" class="w-5 h-5 rounded-full inline mr-1 align-text-bottom" />
                  {/if}
                  <span class="font-semibold">{group.actors[0]?.displayName || group.actors[0]?.handle}</span>
                  <span class="text-[var(--color-text-muted)]"> {getNotifActionText(group.type, 1)}</span>
                {/if}
              </p>
              {#if group.text}
                <p class="text-[10px] text-[var(--color-text-muted)] mt-0.5 line-clamp-1">{group.text}</p>
              {/if}
              {#if isGrouped && isExpanded}
                <div class="mt-1 space-y-0.5">
                  {#each group.actors as actor}
                    <div class="flex items-center gap-1 text-[10px] py-0.5">
                      {#if actor.avatar}<img loading="lazy" src={actor.avatar} alt="" class="w-4 h-4 rounded-full" />{/if}
                      <span>{actor.displayName || actor.handle}</span>
                      <span class="w-1.5 h-1.5 rounded-full ml-auto" style="background: var(--color-{actor.platform})"></span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
            <span class="text-[9px] text-[var(--color-text-muted)] flex-shrink-0">{formatNotifTime(group.latestAt)}</span>
          </div>
        </div>
      {/each}
    {:else if filteredPosts.length === 0}
      <div class="text-center py-8">
        <p class="text-xs text-[var(--color-text-muted)] mb-2">{filterText ? 'No matches' : 'No posts yet'}</p>
        {#if onrefresh && !filterText}
          <button onclick={onrefresh} class="text-[10px] text-[var(--color-primary)] hover:underline">Refresh column</button>
        {/if}
      </div>
    {:else}
      {#each visiblePosts as post (post.uri)}
        <Post {post} {onlike} {onboost} />
      {/each}
      {#if hasMorePosts}
        <button
          onclick={() => visiblePostCount += POST_PAGE_SIZE}
          class="w-full py-2 text-xs text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          Show more ({filteredPosts.length - visiblePostCount} remaining)
        </button>
      {/if}
    {/if}
  </div>

  <!-- Resize handle (right edge) -->
  <div
    class="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--color-primary)]/40 transition-colors {resizing ? 'bg-[var(--color-primary)]/60' : ''}"
    onmousedown={onResizeStart}
    role="separator"
    aria-orientation="vertical"
    tabindex="-1"
  ></div>
</div>

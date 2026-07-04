<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { X, RefreshCw, Loader2, GripVertical, Heart, Repeat, UserPlus, MessageCircle, AtSign, Bell, BellOff, BellRing, Quote, ChevronDown, ChevronUp, Radio, Lock, Unlock, Pin, PinOff, Trash2, Minimize2, Maximize2, Palette, Columns3 } from '@lucide/svelte';
  import type { ColumnNotifyMode } from '$lib/deck-layouts';
  import { COLUMN_WIDTH_PRESETS, type ColumnWidthPreset } from '$lib/deck-layouts';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost } from '$lib/types';
  import type { NotificationGroup } from '$lib/notification-grouping';
  import { i18n } from '$lib/i18n.svelte';

  export type ColumnType = 'timeline' | 'mentions' | 'notifications' | 'my-posts' | 'search' | 'list' | 'hashtag' | 'user' | 'feed' | 'local' | 'federated' | 'tag-group' | 'rss' | 'keyword-monitor' | 'threads-search' | 'messages' | 'trending' | 'activity' | 'likes' | 'followers';

  let {
    id,
    title,
    type,
    posts = [],
    notificationGroups = [],
    loading = false,
    streaming = false,
    width = 380,
    focusedPostIdx = -1,
    onrefresh,
    onremove,
    onlike,
    onboost,
    onreply,
    onquote,
    onwidthchange,
    notify = 'off',
    onnotifychange,
    scrollLock = true,
    onscrolllockchange,
    color = '',
    oncolorchange,
    collapsed = false,
    oncollapsedchange,
    pinned = false,
    onpinnedchange,
    onclear,
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
    focusedPostIdx?: number;
    onrefresh?: () => void;
    onremove?: () => void;
    onlike?: (post: UnifiedPost) => void;
    onboost?: (post: UnifiedPost) => void;
    onreply?: (post: UnifiedPost) => void;
    onquote?: (post: UnifiedPost) => void;
    onwidthchange?: (width: number) => void;
    notify?: ColumnNotifyMode;
    onnotifychange?: (mode: ColumnNotifyMode) => void;
    scrollLock?: boolean;
    onscrolllockchange?: (locked: boolean) => void;
    color?: string;
    oncolorchange?: (color: string) => void;
    collapsed?: boolean;
    oncollapsedchange?: (collapsed: boolean) => void;
    pinned?: boolean;
    onpinnedchange?: (pinned: boolean) => void;
    onclear?: () => void;
    ondragstart?: (e: DragEvent) => void;
    ondragover?: (e: DragEvent) => void;
    ondrop?: (e: DragEvent) => void;
  } = $props();

  let showNotifyMenu = $state(false);
  let showColorPicker = $state(false);
  let showWidthMenu = $state(false);
  let contentEl: HTMLDivElement | undefined = $state();
  let prevPostCount = $state(0);

  const colorPresets = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', ''];

  // Auto-scroll to top when new posts arrive and scroll-lock is off
  $effect(() => {
    const currentCount = filteredPosts.length;
    if (!scrollLock && currentCount > prevPostCount && prevPostCount > 0 && contentEl) {
      contentEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevPostCount = currentCount;
  });

  const notifyModes: { mode: ColumnNotifyMode; label: string }[] = [
    { mode: 'off', label: 'Off' },
    { mode: 'sound', label: 'Sound' },
    { mode: 'desktop', label: 'Desktop' },
    { mode: 'both', label: 'Sound + Desktop' },
  ];

  function cycleNotify() {
    const modes: ColumnNotifyMode[] = ['off', 'sound', 'desktop', 'both'];
    const next = modes[(modes.indexOf(notify) + 1) % modes.length];
    onnotifychange?.(next);
  }

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

{#if collapsed}
  <!-- Collapsed column: narrow icon strip -->
  <div
    class="flex flex-col items-center h-full bg-[var(--color-bg)] border-r border-[var(--color-border)] flex-shrink-0 py-2 gap-2 cursor-pointer hover:bg-[var(--color-surface)]"
    style="width: 40px"
    onclick={() => oncollapsedchange?.(false)}
    role="button"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Enter') oncollapsedchange?.(false); }}
    title="Expand {title}"
  >
    {#if color}<div class="w-6 h-1 rounded-full" style="background: {color}"></div>{/if}
    <Maximize2 size={14} class="text-[var(--color-text-muted)]" />
    <span class="text-[9px] text-[var(--color-text-muted)] writing-mode-vertical" style="writing-mode: vertical-rl; text-orientation: mixed">{title}</span>
  </div>
{:else}
<div
  class="flex flex-col h-full bg-[var(--color-bg)] border-r border-[var(--color-border)] relative flex-shrink-0"
  style="width: {width}px"
  draggable={!pinned}
  ondragstart={pinned ? undefined : onDragStart}
  ondragover={onDragOver}
  ondrop={onDrop}
>
  <!-- Color accent bar -->
  {#if color}
    <div class="h-0.5 flex-shrink-0" style="background: {color}"></div>
  {/if}
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
      <!-- Scroll-lock toggle -->
      <button
        onclick={() => onscrolllockchange?.(!scrollLock)}
        class="p-1 transition-colors {scrollLock ? 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]' : 'text-green-400'}"
        title={scrollLock ? 'Auto-scroll off (click to enable)' : 'Auto-scroll on (click to lock)'}
      >
        {#if scrollLock}
          <Lock size={12} />
        {:else}
          <Unlock size={12} />
        {/if}
      </button>
      <!-- Per-column notification toggle -->
      <div class="relative">
        <button
          onclick={cycleNotify}
          class="p-1 transition-colors {notify !== 'off' ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
          title="Notifications: {notify}"
        >
          {#if notify === 'off'}
            <BellOff size={12} />
          {:else if notify === 'both'}
            <BellRing size={12} />
          {:else}
            <Bell size={12} />
          {/if}
        </button>
      </div>
      <!-- Pin toggle -->
      <button
        onclick={() => onpinnedchange?.(!pinned)}
        class="p-1 transition-colors {pinned ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        title={pinned ? 'Unpin column' : 'Pin column'}
      >
        {#if pinned}<Pin size={12} />{:else}<PinOff size={12} />{/if}
      </button>
      <!-- Collapse -->
      <button
        onclick={() => oncollapsedchange?.(true)}
        class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        title="Collapse column"
      >
        <Minimize2 size={12} />
      </button>
      <!-- Color picker -->
      <div class="relative">
        <button
          onclick={() => showColorPicker = !showColorPicker}
          class="p-1 transition-colors {color ? '' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
          title="Column color"
        >
          {#if color}
            <div class="w-3 h-3 rounded-full" style="background: {color}"></div>
          {:else}
            <Palette size={12} />
          {/if}
        </button>
        {#if showColorPicker}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-40" onclick={() => showColorPicker = false} onkeydown={() => {}}></div>
          <div class="absolute right-0 top-full mt-1 p-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 flex gap-1">
            {#each colorPresets as c}
              <button
                onclick={() => { oncolorchange?.(c); showColorPicker = false; }}
                class="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 {c === color ? 'border-white' : 'border-transparent'}"
                style="background: {c || 'var(--color-bg)'}"
                title={c || 'No color'}
              >
                {#if !c}<X size={8} class="mx-auto text-[var(--color-text-muted)]" />{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <!-- Width presets -->
      <div class="relative">
        <button
          onclick={() => showWidthMenu = !showWidthMenu}
          class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          title="Column width"
        >
          <Columns3 size={12} />
        </button>
        {#if showWidthMenu}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-40" onclick={() => showWidthMenu = false} onkeydown={() => {}}></div>
          <div class="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 py-1 min-w-[100px]">
            {#each Object.entries(COLUMN_WIDTH_PRESETS) as [label, w]}
              <button
                onclick={() => { onwidthchange?.(w); showWidthMenu = false; }}
                class="w-full text-left px-3 py-1 text-[10px] hover:bg-[var(--color-surface-hover)] {width === w ? 'text-[var(--color-primary)] font-medium' : 'text-[var(--color-text)]'}"
              >
                {label.charAt(0).toUpperCase() + label.slice(1)} ({w}px)
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if onrefresh}
        <button onclick={onrefresh} disabled={loading} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
          <RefreshCw size={12} class={loading ? 'animate-spin' : ''} />
        </button>
      {/if}
      <!-- Clear column -->
      {#if onclear}
        <button onclick={onclear} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors" title="Clear column">
          <Trash2 size={12} />
        </button>
      {/if}
      {#if onremove && !pinned}
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
  <div bind:this={contentEl} class="flex-1 overflow-y-auto p-2 space-y-2">
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
      {#each visiblePosts as post, postIdx (post.uri)}
        <div class={focusedPostIdx === postIdx ? 'ring-1 ring-[var(--color-primary)]/60 rounded-lg' : ''} data-post-uri={post.uri}>
          <Post {post} {onlike} {onboost} {onreply} {onquote} />
        </div>
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
{/if}

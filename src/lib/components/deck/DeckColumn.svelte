<script lang="ts">
  import { pickAnchor, measureItems, restoreAnchor, type ScrollAnchor } from '$lib/feed-scroll';
  import { saveReadPosition, getReadPosition, flushReadPositions } from '$lib/read-position';
  import { onMount, onDestroy, tick, untrack, type Snippet } from 'svelte';
  import { base } from '$app/paths';
  import { X, RefreshCw, Loader2, GripVertical, Heart, Repeat, UserPlus, MessageCircle, AtSign, Bell, BellOff, BellRing, Quote, ChevronDown, ChevronUp, Radio, Lock, Unlock, Pin, PinOff, Trash2, Minimize2, Maximize2, Palette, Columns3, Settings2, Pause, Play, Copy, ArrowLeft, ArrowRight } from '@lucide/svelte';
  import type { ColumnNotifyMode } from '$lib/deck-layouts';
  import { COLUMN_WIDTH_PRESETS, type ColumnWidthPreset } from '$lib/deck-layouts';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account } from '$lib/types';
  import type { DeckColumnFilters } from '$lib/deck-filters';
  import { notificationActorName, notificationPostHref, type NotificationGroup } from '$lib/notification-grouping';
  import { i18n } from '$lib/i18n.svelte';
  import { playColumnSound } from '$lib/column-notify';
  import { swallow } from '$lib/debug-log';
  import { needsAccountAttribution } from '$lib/feed-account-attribution';

  import { clampColumnWidth, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, type ColumnType } from '$lib/deck-columns';

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
    children,
    accounts = [], filters = {}, errors = [], hasOlder = false,
    onloadmore, onsettings, onduplicate, onmoveleft, onmoveright,
    paused = false, onpause, unread = 0, onmarkread, onfilterchange,
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
    onmove: onMove,
    ondragstart: onDragStart,
    ondragover: onDragOver,
    ondrop: onDrop,
    ondragend: onDragEnd,
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
    children?: Snippet;
    accounts?: Account[];
    filters?: DeckColumnFilters;
    errors?: string[];
    hasOlder?: boolean;
    onloadmore?: () => void;
    onsettings?: () => void;
    onduplicate?: () => void;
    onmoveleft?: () => void;
    onmoveright?: () => void;
    paused?: boolean;
    onpause?: () => void;
    unread?: number;
    onmarkread?: () => void;
    onfilterchange?: (query: string) => void;
    onremove?: () => void;
    onlike?: (post: UnifiedPost, active?: boolean) => void | Promise<void>;
    onboost?: (post: UnifiedPost, active?: boolean) => void | Promise<void>;
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
    onmove?: (direction: -1 | 1) => void;
    ondragstart?: (e: DragEvent) => void;
    ondragover?: (e: DragEvent) => void;
    ondrop?: (e: DragEvent) => void;
    /** Fires even when the drag is abandoned outside a drop target, so the
     *  parent can clear its "currently dragging" styling. */
    ondragend?: (e: DragEvent) => void;
  } = $props();

  let showNotifyMenu = $state(false);
  let showColorPicker = $state(false);
  let showWidthMenu = $state(false);
  let contentEl: HTMLDivElement | undefined = $state();
  let previousHead: string | undefined;
  let pendingReadAnchor: ScrollAnchor | null = $state(null);

  const colorPresets = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', ''];

  // Only new content at the head follows the reader to the top. Appending an
  // older page must leave them beside the page they just requested.
  $effect(() => {
    const head = useGroupedNotifs
      ? notificationGroups[0] && `${notificationGroups[0].id}:${notificationGroups[0].latestAt}`
      : posts[0]?.uri;
    if (!scrollLock && previousHead && head && head !== previousHead && contentEl) {
      contentEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
    previousHead = head;
  });

  /**
   * Remember where this column was being read.
   *
   * Each column scrolls independently, so each keeps its own position, keyed
   * by column id. Opening a post leaves /deck entirely and every column is
   * rebuilt on the way back -- without this they all reset to the top, and a
   * deck is precisely the layout where that costs the most.
   *
   * Only while scroll-lock is on. With it off the column deliberately jumps to
   * the top whenever posts arrive, and restoring a position would fight the
   * behaviour the user asked for.
   */
  const posKey = $derived(`deck:v2:${id}`);
  let scrollRaf = 0;

  function rememberPosition() {
    if (!contentEl || !scrollLock) return;
    const anchor = pickAnchor(measureItems(contentEl), contentEl.scrollTop);
    if (anchor) saveReadPosition(posKey, anchor.key, anchor.offset);
  }

  function onColumnScroll() {
    // A deliberate scroll takes precedence over a saved position whose post
    // has not arrived yet.
    pendingReadAnchor = null;
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      rememberPosition();
    });
  }

  onMount(() => {
    if (scrollLock) {
      const pos = getReadPosition(posKey);
      pendingReadAnchor = pos
        ? { key: pos.lastSeenUri, offset: pos.scrollY ?? 0 }
        : null;
    }
  });

  onDestroy(() => {
    contentEl?.removeEventListener('scroll', onColumnScroll);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    // The last scroll event may still be waiting on a frame that will not run.
    rememberPosition();
    flushReadPositions();
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
    // Permission and AudioContext activation must happen in this user gesture,
    // not later in an asynchronous feed refresh.
    if (next === 'sound' || next === 'both') playColumnSound();
    const desktop = next === 'desktop' || next === 'both';
    if (desktop && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(error => swallow('deck.notificationPermission', error));
    }
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
  const useGroupedNotifs = $derived(['notifications', 'activity', 'followers'].includes(type));

  function notificationDestination(group: NotificationGroup): string | undefined {
    const inApp = notificationPostHref(group, base);
    if (inApp) return inApp;
    if (!group.postUri) return;
    if (group.postUri.startsWith('at://') && group.platforms.has('bluesky')) {
      return `${base}/thread?uri=${encodeURIComponent(group.postUri)}&platform=bluesky`;
    }
    // Mastodon status IDs belong to the instance that fetched them. A public
    // canonical URI is safe to open without guessing a different account's ID.
    try {
      const url = new URL(group.postUri);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* Notifications without a public post destination stay text. */ }
  }

  let filterText = $state(untrack(() => filters.searchTerm ?? ''));
  $effect(() => { filterText = filters.searchTerm ?? ''; });
  let filterTimer: ReturnType<typeof setTimeout> | undefined;

  function onFilterInput(value: string) {
    filterText = value;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { visiblePostCount = POST_PAGE_SIZE; onfilterchange?.(value); }, 200);
  }

  let updateAnchor: ScrollAnchor | null = null;
  $effect.pre(() => {
    posts; notificationGroups;
    updateAnchor = contentEl && scrollLock && contentEl.scrollTop > 0
      ? pickAnchor(measureItems(contentEl), contentEl.scrollTop) : null;
  });
  $effect(() => {
    posts; notificationGroups;
    const anchor = updateAnchor;
    if (anchor && contentEl && scrollLock) void tick().then(() => {
      if (contentEl && scrollLock && contentEl.scrollTop > 0) restoreAnchor(contentEl, anchor);
    });
  });

  const POST_PAGE_SIZE = 50;
  let visiblePostCount = $state(POST_PAGE_SIZE);

  // The parent supplies the canonical filtered rows, also used by keyboard
  // actions and unread counts. Filtering a second time here made display-name
  // matches disappear and gave shortcuts a different row order.
  const filteredPosts = $derived(posts);
  const visiblePosts = $derived(filteredPosts.slice(0, visiblePostCount));
  const hasMorePosts = $derived(!useGroupedNotifs && !children && filteredPosts.length > visiblePostCount);

  $effect(() => {
    posts; notificationGroups; visiblePostCount;
    if (!pendingReadAnchor || !contentEl || !scrollLock) return;
    const anchor = pendingReadAnchor;
    const index = posts.findIndex(post => post.uri === anchor.key);
    if (index >= visiblePostCount) {
      visiblePostCount = Math.ceil((index + 1) / POST_PAGE_SIZE) * POST_PAGE_SIZE;
      return;
    }
    if (measureItems(contentEl).some(item => item.key === anchor.key)) {
      pendingReadAnchor = null;
      restoreAnchor(contentEl, anchor);
    }
  });

  // Resize handle
  let resizing = $state(false);
  let startX = 0;
  let startWidth = 0;


  const KEYBOARD_RESIZE_STEP = 20;

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
    width = clampWidth(startWidth + delta);
  }

  const clampWidth = clampColumnWidth;

  /**
   * Keyboard half of the window-splitter pattern — role="separator" with a
   * tabindex promises this, and until now the handle was mouse-only.
   */
  function onResizeKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? KEYBOARD_RESIZE_STEP * 5 : KEYBOARD_RESIZE_STEP;
    let next = width;
    if (e.key === 'ArrowLeft') next = clampWidth(width - step);
    else if (e.key === 'ArrowRight') next = clampWidth(width + step);
    else if (e.key === 'Home') next = MIN_COLUMN_WIDTH;
    else if (e.key === 'End') next = MAX_COLUMN_WIDTH;
    else return;
    e.preventDefault();
    width = next;
    onwidthchange?.(next);
  }

  function onResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
    onwidthchange?.(width);
  }

  onDestroy(() => {
    clearTimeout(filterTimer);
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
  role="region"
  aria-label={title}
>
  <!-- Color accent bar -->
  {#if color}
    <div class="h-0.5 flex-shrink-0" style="background: {color}"></div>
  {/if}
  <!-- Column header -->
  <div class="flex flex-wrap items-center justify-between gap-y-2 px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex-shrink-0">
    <div class="flex items-center gap-2 w-full min-w-0">
      <button type="button" class="drag-handle text-[var(--color-text-muted)] cursor-grab active:cursor-grabbing" draggable={false} ondragstart={pinned ? undefined : onDragStart} ondragend={onDragEnd} onkeydown={(e) => {
        if (pinned) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); onMove?.(e.key === 'ArrowLeft' ? -1 : 1);
      }} aria-label={i18n.t.deck.moveColumn.replace('{title}', title)} title={i18n.t.deck.moveColumn.replace('{title}', title)}>
        <GripVertical size={14} />
      </button>
      <span class="text-sm font-medium truncate">{title}</span>
      {#if paused}<span class="ml-auto text-[10px] text-amber-500">{i18n.t.deck.paused}</span>{/if}
      {#if streaming && !paused}
        <span class="flex items-center gap-1 text-[9px] text-green-400 font-medium" title={i18n.t.deck.liveStreaming}>
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
          </span>
          LIVE
        </span>
      {/if}
    </div>
    <div class="column-actions flex items-center flex-nowrap w-full">
      <button onclick={onsettings} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title={i18n.t.deck.columnSettings} aria-label={i18n.t.deck.columnSettings}><Settings2 size={13} /></button>
      <button onclick={onpause} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title={paused ? i18n.t.deck.resumeColumn : i18n.t.deck.pauseColumn} aria-label={paused ? i18n.t.deck.resumeColumn : i18n.t.deck.pauseColumn}>{#if paused}<Play size={13} />{:else}<Pause size={13} />{/if}</button>
      <button onclick={onduplicate} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title={i18n.t.deck.duplicateColumn} aria-label={i18n.t.deck.duplicateColumn}><Copy size={13} /></button>
      {#if !pinned}
        <button onclick={onmoveleft} disabled={!onmoveleft} class="p-1 text-[var(--color-text-muted)] disabled:opacity-30" title={i18n.t.deck.moveLeft} aria-label={i18n.t.deck.moveLeft}><ArrowLeft size={13} /></button>
        <button onclick={onmoveright} disabled={!onmoveright} class="p-1 text-[var(--color-text-muted)] disabled:opacity-30" title={i18n.t.deck.moveRight} aria-label={i18n.t.deck.moveRight}><ArrowRight size={13} /></button>
      {/if}
      {#if !children}
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
          class="p-1 transition-colors {notify !== 'off' ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
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
      {/if}
      <!-- Pin toggle -->
      <button
        onclick={() => onpinnedchange?.(!pinned)}
        class="p-1 transition-colors {pinned ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        title={pinned ? 'Unpin column' : 'Pin column'}
      >
        {#if pinned}<Pin size={12} />{:else}<PinOff size={12} />{/if}
      </button>
      <!-- Collapse -->
      <button
        onclick={() => oncollapsedchange?.(true)}
        class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        title={i18n.t.deck.collapseColumn}
      >
        <Minimize2 size={12} />
      </button>
      <!-- Color picker -->
      <div class="relative">
        <button
          onclick={() => showColorPicker = !showColorPicker}
          class="p-1 transition-colors {color ? '' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
          title={i18n.t.deck.columnColor}
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
          title={i18n.t.deck.columnWidth}
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
                class="w-full text-left px-3 py-1 text-[10px] hover:bg-[var(--color-surface-hover)] {width === w ? 'text-[var(--color-primary-text)] font-medium' : 'text-[var(--color-text)]'}"
              >
                {label.charAt(0).toUpperCase() + label.slice(1)} ({w}px)
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if onrefresh}
        <button onclick={onrefresh} disabled={loading} aria-label={i18n.t.common.refreshColumn} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
          <RefreshCw size={12} class={loading ? 'animate-spin' : ''} />
        </button>
      {/if}
      <!-- Clear column -->
      {#if onclear}
        <button onclick={onclear} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors" title={i18n.t.deck.clearColumn}>
          <Trash2 size={12} />
        </button>
      {/if}
      {#if onremove && !pinned}
        <button onclick={onremove} aria-label={i18n.t.common.removeColumn} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors">
          <X size={12} />
        </button>
      {/if}
    </div>
  </div>

  {#if accounts.length}
    <button onclick={onsettings} class="flex items-center gap-1 px-3 py-1 text-[10px] text-[var(--color-text-muted)] text-left" aria-label={i18n.t.deck.columnAccounts}>
      {#each accounts.slice(0, 3) as account}{#if account.avatar_url}<img src={account.avatar_url} alt="" class="w-4 h-4 rounded-full" />{/if}{/each}
      <span class="truncate">{accounts.map(account => `@${account.handle.replace(/^@+/, '')}`).join(', ')}</span>
    </button>
  {/if}
  {#if errors.length}
    <div role="status" class="border-b border-[var(--color-border)] p-2 text-xs text-amber-500 break-words">
      {#each errors as error}<p>{error}</p>{/each}
      <button onclick={onrefresh} disabled={loading} class="underline mt-1">{i18n.t.feed.retry}</button>
    </div>
  {/if}
  {#if unread > 0}
    <button onclick={() => { onmarkread?.(); contentEl?.scrollTo({ top: 0, behavior: 'smooth' }); }} class="w-full py-1.5 text-xs bg-[var(--color-primary)]/15 text-[var(--color-primary-text)]">{i18n.t.deck.newPosts.replace('{count}', String(unread))}</button>
  {/if}
  <!-- Inline filter -->
  <div class="px-2 py-1 border-b border-[var(--color-border)]">
    <input
      type="text"
      value={filterText}
      oninput={(e) => onFilterInput((e.target as HTMLInputElement).value)}
      placeholder={i18n.t.feed.searchInPosts}
      aria-label={i18n.t.deck.includeText}
      class="w-full px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[10px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
    />
  </div>

  <!-- Column content -->
  <div bind:this={contentEl} onscroll={onColumnScroll} class="deck-content flex-1 overflow-y-auto p-2">
    {#if children}
      {@render children()}
    {:else if loading && filteredPosts.length === 0 && notificationGroups.length === 0}
      <div class="text-center py-8">
        <Loader2 size={20} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
      </div>
    {:else if type === 'messages' || type === 'trending'}
      {#each visiblePosts as post, postIdx (post.uri)}
        {@const raw = post.raw as any}
        {@const unreadConversation = raw?.unreadCount || raw?.unread}
        {@const destination = type === 'messages'
          ? `${base}/messages?account=${post.sourceAccountId ?? ''}&conversation=${encodeURIComponent(raw?.id ?? '')}&platform=${post.platform}`
          : `${base}/search?q=${encodeURIComponent(raw?.topic ?? (raw?.name ? `#${raw.name}` : raw?.title ?? post.text))}`}
        <a href={destination} data-feed-key={post.uri} data-post-uri={post.uri} class="block p-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface)] {focusedPostIdx === postIdx ? 'ring-1 ring-[var(--color-primary)]/60' : ''}">
          <div class="flex items-center gap-2 text-sm font-medium">
            {#if post.author.avatar}<img src={post.author.avatar} alt="" class="w-7 h-7 rounded-full" />{/if}
            <span>{post.author.displayName || post.author.handle}</span>
            {#if type === 'messages' && unreadConversation}<span class="w-2 h-2 rounded-full bg-[var(--color-primary)]"></span>{/if}
          </div>
          <p class="text-sm mt-1 line-clamp-3">{post.text}</p>
          {#if post.sourceAccount}<p class="text-[10px] mt-1 text-[var(--color-text-muted)]">@{post.sourceAccount}</p>{/if}
        </a>
      {/each}
      {#if visiblePosts.length === 0}<p class="text-xs text-center text-[var(--color-text-muted)] py-8">{i18n.t.feed.noPostsFound}</p>{/if}
    {:else if useGroupedNotifs}
      <!-- Grouped notification rendering for notification columns -->
      {#each notificationGroups as group (group.id)}
        {@const NIcon = getNotifIcon(group.type)}
        {@const isGrouped = group.actors.length > 1}
        {@const isExpanded = expandedGroups.has(group.id)}
        {@const destination = notificationDestination(group)}
        <div data-feed-key={`notification:${group.id}`} class="rounded-lg hover:bg-[var(--color-surface)] transition-colors">
          <div class="flex items-start gap-2 p-2">
            <div class="flex-shrink-0 mt-0.5 {getNotifColor(group.type)}">
              <NIcon size={12} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[11px]">
                {#if isGrouped}
                  <div class="flex -space-x-1.5 mb-1">
                    {#each group.actors.slice(0, 3) as actor}
                      {#if actor.avatar}
                        <a href={`${base}/profile?handle=${encodeURIComponent(actor.handle)}&platform=${actor.platform}`} aria-label={notificationActorName(actor)}><img loading="lazy" src={actor.avatar} alt="" class="w-5 h-5 rounded-full border border-[var(--color-bg)]" /></a>
                      {/if}
                    {/each}
                    {#if group.actors.length > 3}
                      <span class="w-5 h-5 rounded-full bg-[var(--color-surface)] border border-[var(--color-bg)] flex items-center justify-center text-[8px] font-bold text-[var(--color-text-muted)]">
                        +{group.actors.length - 3}
                      </span>
                    {/if}
                  </div>
                  <a href={`${base}/profile?handle=${encodeURIComponent(group.actors[0].handle)}&platform=${group.actors[0].platform}`} class="font-semibold hover:underline">{notificationActorName(group.actors[0])}</a>
                  <span class="text-[var(--color-text-muted)]"> {getNotifActionText(group.type, group.actors.length)}</span>
                  <button onclick={() => toggleGroup(group.id)} aria-expanded={isExpanded} aria-label={getNotifActionText(group.type, group.actors.length)} class="inline-flex ml-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    {#if isExpanded}<ChevronUp size={10} />{:else}<ChevronDown size={10} />{/if}
                  </button>
                {:else}
                  {#if group.actors[0]?.avatar}
                    <a href={`${base}/profile?handle=${encodeURIComponent(group.actors[0].handle)}&platform=${group.actors[0].platform}`} aria-label={notificationActorName(group.actors[0])}><img loading="lazy" src={group.actors[0].avatar} alt="" class="w-5 h-5 rounded-full inline mr-1 align-text-bottom" /></a>
                  {/if}
                  <a href={`${base}/profile?handle=${encodeURIComponent(group.actors[0]?.handle ?? '')}&platform=${group.actors[0]?.platform}`} class="font-semibold hover:underline">{group.actors[0] ? notificationActorName(group.actors[0]) : '?'}</a>
                  <span class="text-[var(--color-text-muted)]"> {getNotifActionText(group.type, 1)}</span>
                {/if}
              </div>
              {#if destination}<a href={destination} class="block text-[10px] text-[var(--color-primary-text)] mt-0.5 line-clamp-2 hover:underline">{group.text || i18n.t.post.openVideoPost}</a>{:else if group.text}<p class="text-[10px] text-[var(--color-text-muted)] mt-0.5 line-clamp-2">{group.text}</p>{/if}
              {#if isGrouped && isExpanded}
                <div class="mt-1 space-y-0.5">
                  {#each group.actors as actor}
                    <div class="flex items-center gap-1 text-[10px] py-0.5">
                      {#if actor.avatar}<img loading="lazy" src={actor.avatar} alt="" class="w-4 h-4 rounded-full" />{/if}
                      <a href={`${base}/profile?handle=${encodeURIComponent(actor.handle)}&platform=${actor.platform}`} class="hover:underline">{notificationActorName(actor)}</a>
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
      {#if notificationGroups.length === 0}<p class="text-xs text-center text-[var(--color-text-muted)] py-8">{filterText ? i18n.t.search.noResults : i18n.t.feed.noPostsFound}</p>{/if}
    {:else if filteredPosts.length === 0}
      <div class="text-center py-8">
        <p class="text-xs text-[var(--color-text-muted)] mb-2">{filterText ? i18n.t.search.noResults : i18n.t.feed.noPostsFound}</p>
        {#if onrefresh && !filterText}
          <button onclick={onrefresh} class="text-[10px] text-[var(--color-primary-text)] hover:underline">{i18n.t.deck.refreshColumn}</button>
        {/if}
      </div>
    {:else}
      {#each visiblePosts as post, postIdx (post.uri)}
        <!-- data-feed-key, not data-post-uri: Post.svelte already puts
             data-post-uri on its own root, so carrying it here too made every
             post count twice — j/k keyboard navigation needed two presses to
             move one post, and the scroll anchor could match either element. -->
        <div class="deck-post {focusedPostIdx === postIdx ? 'ring-1 ring-[var(--color-primary)]/60 rounded-lg' : ''}" data-feed-key={post.uri}>
          {#if post.sourceAccount && needsAccountAttribution(accounts, post.platform)}<p class="px-2 pt-1 text-[10px] text-[var(--color-text-muted)] truncate" title={i18n.t.deck.columnAccounts}>@{post.sourceAccount.replace(/^@+/, '')}</p>{/if}
          <Post {post} {onlike} {onboost} {onreply} {onquote} />
        </div>
      {/each}
    {/if}
    {#if hasMorePosts}
      <button
        onclick={() => visiblePostCount += POST_PAGE_SIZE}
        class="w-full py-2 text-xs text-[var(--color-primary-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        {i18n.t.deck.showMore.replace('{count}', String(filteredPosts.length - visiblePostCount))}
      </button>
    {/if}
    {#if hasOlder && !hasMorePosts}
      <button onclick={onloadmore} disabled={loading} class="w-full py-3 text-xs text-[var(--color-primary-text)] disabled:opacity-50">{loading ? i18n.t.common.loading : i18n.t.deck.loadOlder}</button>
    {/if}
  </div>

  <!-- Resize handle (right edge). ARIA's window-splitter pattern says a
       focusable separator IS a widget; Svelte's rule classifies every separator
       as non-interactive and so cannot express that. The handle below is a
       proper splitter: labelled, with valuenow/min/max, and operable by
       arrow keys, Home and End. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--color-primary)]/40 transition-colors {resizing ? 'bg-[var(--color-primary)]/60' : ''}"
    onmousedown={onResizeStart}
    onkeydown={onResizeKeydown}
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize {title} column"
    aria-valuenow={width}
    aria-valuemin={MIN_COLUMN_WIDTH}
    aria-valuemax={MAX_COLUMN_WIDTH}
    tabindex="0"
  ></div>
</div>
{/if}

<style>
  /* The narrowest supported column is 280px: compact padding keeps every action on one row. */
  .column-actions > button, .column-actions > div > button { padding: 2px; flex-shrink: 0; }
  .column-actions > div { flex-shrink: 0; }

  /**
   * Skip layout, style and paint for posts scrolled out of a column.
   *
   * A deck is several columns of posts side by side, each one as expensive to
   * render as a timeline row -- rich text, embeds, quote cards, media -- so the
   * cost is multiplied by however many columns are open. `contain-intrinsic-size:
   * auto` lets the browser remember each post's real height once rendered, so
   * scrollbars stay put and the reading position above still resolves.
   */
  .deck-post :global(.post-footer) { min-width: 0; }
  .deck-post :global(.post-card) { border: 0; border-bottom: 1px solid var(--color-border); border-radius: 0; padding: 0.4rem 0.5rem; }
  .deck-post :global(.post-footer) { margin-top: 0; }
  .deck-post :global(.post-actions) { min-width: 0; max-width: 100%; }
  .deck-post {
    content-visibility: auto;
    contain-intrinsic-size: auto 14rem;
  }
</style>

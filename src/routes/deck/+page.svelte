<script lang="ts">
  import { swallow } from '$lib/debug-log';
  import { readJson, writeJson } from '$lib/safe-storage';
  import { getCached, setCache } from '$lib/view-cache';
  import { deckCacheKey } from '$lib/deck-cache';
  import { toast } from '$lib/toast.svelte';
  import { subscribeDeckColumn } from '$lib/deck-live';
  import { columnAccounts } from '$lib/deck-accounts';
  import { performDeckAction } from '$lib/deck-actions';
  import { loadDeckPage, supportsDeckLoader } from '$lib/deck-loader';
  import { filterColumnPosts, filterColumnNotifications } from '$lib/deck-filters';
  import { mergeColumnPosts, withoutDeletedPosts } from '$lib/deck-state';
  import ColumnSettings from '$lib/components/deck/ColumnSettings.svelte';
  import WorkspaceManager from '$lib/components/deck/WorkspaceManager.svelte';
  import PublishingColumn from '$lib/components/deck/PublishingColumn.svelte';
  import { listBookmarks } from '$lib/bookmarks';
  import { listAccounts } from '$lib/db';
  import { loadConversationInbox } from '$lib/messages';
  import { isColumnLocked } from '$lib/deck-scroll';
  import * as deckFocus from '$lib/deck-focus';
  import { base } from '$app/paths';
  import { onMount, onDestroy } from 'svelte';
  import { initAllClients, invalidateClientCache, type ClientEntry } from '$lib/api/client-factory';
  import { Columns3, Plus, Loader2, Pencil } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import StarterWorkspaces from '$lib/components/StarterWorkspaces.svelte';
  import { STARTER_WORKSPACES, type WorkspaceId } from '$lib/starter-workspaces';
  function layoutLabel(name: string) {
    const key = name.replace(/^starter:/, '') as WorkspaceId;
    return name.startsWith('starter:') && STARTER_WORKSPACES.includes(key) ? i18n.t.workflow[key] : name;
  }
  let showStarters = $state(false);
  function applyStarter(next: DeckColumnConfig[]) {
    if (!deckReady) return;
    for (const col of columns) clearColumnRuntime(col.id);
    columns = next; columnPosts = {}; columnNotifGroups = {};
    focusedColumnIdx = -1; focusedPostIdx = -1;
    refreshLayoutList();
    columns.forEach(col => loadColumn(col));
    showStarters = false;
  }
  import { haptic } from '$lib/haptics';
  import DelayedSpinner from '$lib/components/DelayedSpinner.svelte';
  import DeckColumn from '$lib/components/deck/DeckColumn.svelte';
  import { requiresQuery, moveColumn, type ColumnType } from '$lib/deck-columns';
  import FloatingCompose from '$lib/components/FloatingCompose.svelte';
  import FeedPickerDialog from '$lib/components/FeedPickerDialog.svelte';
  import type { FeedChoice } from '$lib/bluesky-feeds';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { sortPosts } from '$lib/api/unified';
  import { fetchOk } from '$lib/http';
  import type { UnifiedPost, Account } from '$lib/types';
  import { groupNotifications, type UnifiedNotification, type NotificationGroup } from '$lib/notification-grouping';
  import { fetchFeed, rssItemToPost } from '$lib/rss';
  import { applyMuteFilter, buildMuteFilter } from '$lib/muted-words';
  import { streamManager } from '$lib/streaming';
  import {
    listLayouts, getLayout, saveLayout,
    getActiveLayoutName, setActiveLayoutName, parseDeckColumns,
    type DeckColumnConfig, type ColumnNotifyMode,
  } from '$lib/deck-layouts';
  import { notifyColumn } from '$lib/column-notify';
  import { jetstream } from '$lib/jetstream';

  // Drag-and-drop reorder state (mouse)
  let draggedColumnId: string | null = $state(null);
  let dragOverColumnId: string | null = $state(null);

  // Pointer-based mouse dragging works in native WKWebView as well as browsers.
  let pointerDrag: { id: string; x: number; y: number; pointerId: number } | null = null;
  function startPointerDrag(id: string, event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || columns.find(c => c.id === id)?.pinned) return;
    if (!(event.target instanceof Element) || !event.target.closest('.drag-handle')) return;
    pointerDrag = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }
  function movePointerDrag(event: PointerEvent) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    if (!draggedColumnId && Math.hypot(event.clientX - pointerDrag.x, event.clientY - pointerDrag.y) < 5) return;
    draggedColumnId = pointerDrag.id;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-deck-column]');
    const id = target?.dataset.deckColumn;
    dragOverColumnId = id && id !== pointerDrag.id && !columns.find(c => c.id === id)?.pinned ? id : null;
    event.preventDefault();
  }
  function endPointerDrag(event: PointerEvent) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const source = pointerDrag.id;
    const target = dragOverColumnId;
    if (event.type !== 'pointercancel' && draggedColumnId && target) reorderColumns(source, target);
    pointerDrag = null;
    draggedColumnId = null;
    dragOverColumnId = null;
  }

  // Touch drag-and-drop reorder state
  let touchDragColumnId: string | null = $state(null);
  let touchDropTargetId: string | null = $state(null);
  let touchDragX = $state(0);
  let touchDragY = $state(0);
  let touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let deckContainerEl: HTMLDivElement | undefined = $state();

  function handleTouchStart(colId: string, e: TouchEvent) {
    if (touchLongPressTimer) clearTimeout(touchLongPressTimer);
    touchLongPressTimer = null;
    if (columns.find(col => col.id === colId)?.pinned) return;
    if (e.target instanceof Element && !e.target.closest('.drag-handle')) {
      if (e.target.closest('button, input, select, textarea, a')) return;
    }
    const touch = e.touches[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;

    touchLongPressTimer = setTimeout(() => {
      touchDragColumnId = colId;
      touchDragX = touch.clientX;
      touchDragY = touch.clientY;
      haptic('medium');
    }, 500);
  }

  function handleTouchMove(e: TouchEvent) {
    const touch = e.touches[0];
    if (!touch) return;

    // If we haven't entered drag mode yet, check if touch moved too far (cancel long-press)
    if (!touchDragColumnId && touchLongPressTimer) {
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
      }
      return;
    }

    if (!touchDragColumnId) return;

    // Prevent scrolling while dragging
    e.preventDefault();

    touchDragX = touch.clientX;
    touchDragY = touch.clientY;

    // Determine which column the touch is over by checking column wrapper divs
    let foundTarget: string | null = null;
    if (deckContainerEl) {
      const wrappers = deckContainerEl.children;
      for (let i = 0; i < wrappers.length; i++) {
        const colId = columns[i]?.id;
        if (!colId || colId === touchDragColumnId) continue;
        const rect = wrappers[i].getBoundingClientRect();
        if (touch.clientX >= rect.left && touch.clientX <= rect.right) {
          foundTarget = colId;
          break;
        }
      }
    }
    touchDropTargetId = foundTarget;
  }

  function handleTouchEnd(event?: TouchEvent) {
    // Clear long-press timer
    if (touchLongPressTimer) {
      clearTimeout(touchLongPressTimer);
      touchLongPressTimer = null;
    }

    if (!touchDragColumnId) return;

    // Perform the reorder if we have a valid drop target
    if (event?.type !== 'touchcancel' && touchDropTargetId && touchDropTargetId !== touchDragColumnId) {
      const fromIdx = columns.findIndex(c => c.id === touchDragColumnId);
      const toIdx = columns.findIndex(c => c.id === touchDropTargetId);
      if (fromIdx >= 0 && toIdx >= 0 && !columns[fromIdx]?.pinned && !columns[toIdx]?.pinned) {
        const moved = columns[fromIdx];
        const updated = [...columns];
        updated.splice(fromIdx, 1);
        updated.splice(toIdx, 0, moved);
        columns = updated;
        focusedColumnIdx = -1; focusedPostIdx = -1;
        saveColumns();
        haptic('light');
      }
    }

    // Reset state
    touchDragColumnId = null;
    touchDropTargetId = null;
  }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  // Loading can finish with an initialization error. Only a restored column
  // configuration and resolved account identities make workspace writes safe.
  let deckReady = $state(false);
  let showAddMenu = $state(false);
  let showWorkspaces = $state(false);
  let editingColumn: DeckColumnConfig | null = $state(null);
  let columns: DeckColumnConfig[] = $state([]);
  let columnPosts: Record<string, UnifiedPost[]> = $state({});
  let columnNotifGroups: Record<string, NotificationGroup[]> = $state({});
  let columnLoading: Record<string, boolean> = $state({});

  function restoreDeckCache(col: DeckColumnConfig, sourceAccounts: Account[]) {
    if (col.type === 'drafts' || col.type === 'scheduled' || col.type === 'bookmarks') return;
    const data = getCached<{ posts: UnifiedPost[]; notifications: UnifiedNotification[] }>(deckCacheKey(col, sourceAccounts))?.data;
    if (!data || !Array.isArray(data.posts) || !Array.isArray(data.notifications)) return;
    columnPosts[col.id] = data.posts;
    columnNotifications[col.id] = data.notifications;
    columnNotifGroups[col.id] = groupNotifications(data.notifications);
  }


  let clientEntries: Map<number, ClientEntry> = $state(new Map());
  let streamCleanups: Map<string, () => void> = new Map();

  // Floating compose state
  let composeOpen = $state(false);
  let composeReplyTo: UnifiedPost | null = $state(null);
  let composeQuotePost: UnifiedPost | null = $state(null);

  function openCompose(replyTo?: UnifiedPost, quote?: UnifiedPost) {
    composeReplyTo = replyTo ?? null;
    composeQuotePost = quote ?? null;
    composeOpen = true;
  }

  function handleReply(post: UnifiedPost) {
    openCompose(post);
  }

  function handleQuote(post: UnifiedPost) {
    openCompose(undefined, post);
  }

  // Column-aware keyboard navigation
  let focusedColumnIdx = $state(-1);
  let focusedPostIdx = $state(-1);

  function focusColumn(idx: number) {
    const next = deckFocus.focusColumn({ column: focusedColumnIdx, post: focusedPostIdx }, idx, columns.length);
    if (next.column === focusedColumnIdx && next.post === focusedPostIdx) return;
    focusedColumnIdx = next.column;
    focusedPostIdx = next.post;
    // Scroll the column into view
    if (deckContainerEl) {
      const wrapper = deckContainerEl.children[idx] as HTMLElement;
      wrapper?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }

  function focusPost(idx: number) {
    if (focusedColumnIdx < 0) return;
    const postEls = renderedPostElements();
    focusedPostIdx = deckFocus.focusPost(
      { column: focusedColumnIdx, post: focusedPostIdx }, idx, postEls.length,
    ).post;
    postEls[focusedPostIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderedPostElements(): HTMLElement[] {
    if (!deckContainerEl || focusedColumnIdx < 0) return [];
    return [...(deckContainerEl.children[focusedColumnIdx]?.querySelectorAll<HTMLElement>('[data-post-uri]') ?? [])];
  }

  function getFocusedPost(): UnifiedPost | null {
    if (focusedColumnIdx < 0 || focusedPostIdx < 0) return null;
    const col = columns[focusedColumnIdx];
    const uri = renderedPostElements()[focusedPostIdx]?.dataset.postUri;
    return (col ? displayedPosts(col) : []).find(post => post.uri === uri) ?? null;
  }

  function handleKeydown(e: KeyboardEvent) {
    const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    if (isInput || composeOpen || showWorkspaces || editingColumn || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLElement) {
      if (e.target.isContentEditable || e.target.closest('dialog')) return;
    }

    // 'n' opens compose
    if (e.key === 'n') {
      e.preventDefault();
      openCompose();
      return;
    }

    // Column navigation: h/l or ArrowLeft/ArrowRight
    if (e.key === 'h' || e.key === 'ArrowLeft') {
      e.preventDefault();
      focusColumn(deckFocus.focusPrevColumn({ column: focusedColumnIdx, post: focusedPostIdx }, columns.length).column);
      return;
    }
    if (e.key === 'l' || e.key === 'ArrowRight') {
      e.preventDefault();
      focusColumn(deckFocus.focusNextColumn({ column: focusedColumnIdx, post: focusedPostIdx }, columns.length).column);
      return;
    }

    // Post navigation within focused column: j/k
    if (e.key === 'j') {
      e.preventDefault();
      if (focusedColumnIdx < 0) focusColumn(0);
      focusPost(focusedPostIdx + 1);
      return;
    }
    if (e.key === 'k') {
      e.preventDefault();
      focusPost(focusedPostIdx - 1);
      return;
    }

    // 1-9 jump to column by position
    const byNumber = deckFocus.columnForNumberKey(e.key, columns.length);
    if (byNumber !== null) {
      e.preventDefault();
      focusColumn(byNumber);
      return;
    }

    // 'o' opens focused post in thread view
    if (e.key === 'o') {
      const element = renderedPostElements()[focusedPostIdx];
      if (element instanceof HTMLAnchorElement) {
        e.preventDefault(); element.click(); return;
      }
      const post = getFocusedPost();
      if (post) {
        e.preventDefault();
        const params = new URLSearchParams({ uri: post.uri, platform: post.platform });
        if (post.sourceAccountId !== undefined) {
          params.set('account', String(post.sourceAccountId));
          const raw = post.raw as any;
          const localId = raw?.reblog?.id ?? raw?.id;
          if (post.platform === 'mastodon' && localId) params.set('id', String(localId));
        }
        window.location.href = `${base}/thread?${params}`;
      }
      return;
    }

    // 'r' replies to focused post
    if (e.key === 'r') {
      if (['messages', 'trending'].includes(columns[focusedColumnIdx]?.type)) return;
      const post = getFocusedPost();
      if (post) { e.preventDefault(); handleReply(post); }
      return;
    }

    // 'a' opens add column menu
    if (e.key === 'a') {
      if (!deckReady) return;
      e.preventDefault();
      showAddMenu = !showAddMenu;
      return;
    }

    // Escape clears column focus or closes add menu
    if (e.key === 'Escape') {
      if (showAddMenu) { e.preventDefault(); showAddMenu = false; return; }
      if (focusedColumnIdx >= 0) {
        e.preventDefault();
        focusedColumnIdx = -1;
        focusedPostIdx = -1;
      }
    }
  }

  const hasBsky = $derived(accounts.some(a => a.platform === 'bluesky'));
  const hasMasto = $derived(accounts.some(a => a.platform === 'mastodon'));
  const hasThreads = $derived(accounts.some(a => a.platform === 'threads'));

  const defaultColumns: DeckColumnConfig[] = [
    { id: 'timeline', title: 'Timeline', type: 'timeline' },
    { id: 'notifications', title: 'Notifications', type: 'notifications' },
    { id: 'mentions', title: 'Mentions', type: 'mentions' },
  ];

  const availableColumns: { type: ColumnType; label: string }[] = [
    { type: 'timeline', label: 'Home Timeline' },
    { type: 'my-posts', label: 'My Posts' },
    { type: 'mentions', label: 'Mentions' },
    { type: 'notifications', label: 'Notifications' },
    { type: 'local', label: 'Local (Mastodon)' },
    { type: 'federated', label: 'Federated (Mastodon)' },
    { type: 'search', label: 'Search...' },
    { type: 'hashtag', label: 'Hashtag...' },
    { type: 'user', label: 'User Feed...' },
    { type: 'list', label: 'List...' },
    { type: 'feed', label: 'Bluesky Feed...' },
    { type: 'tag-group', label: 'Tag Group...' },
    { type: 'rss', label: 'RSS Feed...' },
    { type: 'keyword-monitor', label: 'Monitor Keywords...' },
    { type: 'threads-search', label: 'Threads Search...' },
    { type: 'messages', label: 'Messages / DMs' },
    { type: 'trending', label: 'Trending' },
    { type: 'activity', label: 'Activity (Engagement)' },
    { type: 'likes', label: 'Liked Posts' },
    { type: 'followers', label: 'New Followers' },
    { type: 'bookmarks', label: i18n.t.nav.bookmarks },
    { type: 'drafts', label: i18n.t.nav.drafts },
    { type: 'scheduled', label: i18n.t.drafts.scheduled },
  ];

  // Saved layouts (using deck-layouts.ts module)
  let savedLayoutNames: string[] = $state([]);

  function refreshLayoutList() {
    savedLayoutNames = listLayouts().map(l => l.name);
  }

  function loadLayoutByName(name: string) {
    if (!saveColumns()) throw new Error(i18n.t.deck.workspaceSaveFailed);
    const layout = getLayout(name);
    if (!layout) return;
    setActiveLayoutName(name);
    for (const col of columns) clearColumnRuntime(col.id);
    columns = structuredClone(layout.columns);
    focusedColumnIdx = -1; focusedPostIdx = -1;
    if (!saveColumns()) throw new Error(i18n.t.deck.workspaceSaveFailed);
    columns.forEach(col => loadColumn(col));
  }

  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let accountRevision = 0;
  let clientsRefreshing = true;

  function accountIdentitySnapshot(items: Account[]): string {
    return JSON.stringify([...items].sort((a, b) => a.id - b.id).map(account => [
      account.id, account.platform, account.handle, account.did,
      account.instance_url, account.mastodon_id, account.threads_user_id,
    ]));
  }

  function needsAccountClients(col: DeckColumnConfig): boolean {
    return !['rss', 'bookmarks', 'drafts', 'scheduled'].includes(col.type);
  }

  function resetAccountColumns() {
    for (const col of columns.filter(needsAccountClients)) clearColumnRuntime(col.id);
    unlikedAtRequest.clear();
    focusedPostIdx = -1;
  }

  function adoptAccounts(next: Account[]) {
    // A credential rebind can keep the numeric account ID while changing its
    // remote identity. Metadata-only edits retain older pages and their cursors.
    if (accountIdentitySnapshot(accounts) !== accountIdentitySnapshot(next)) resetAccountColumns();
    accounts = next;
  }

  async function refreshAccountClients(initial = false) {
    const revision = accountRevision;
    const isCurrent = () => !disposed && revision === accountRevision;
    try {
      if (!initial) {
        const next = await listAccounts();
        if (!isCurrent()) return;
        adoptAccounts(next);
      }
      let result = await initAllClients();
      if (!isCurrent()) return;
      if (initial && result.accounts.length === 0) {
        invalidateClientCache();
        result = await initAllClients();
        if (!isCurrent()) return;
      }
      adoptAccounts(result.accounts);
      clientEntries = result.clients;
      clientsRefreshing = false;
      const liveCounters = localStorage.getItem('crispdeck-live-counters') !== 'false';
      jetstream.setEnabled(liveCounters && accounts.some(account => account.platform === 'bluesky'));

      // The current workspace may have been edited or switched during login.
      for (const col of columns) {
        columnLoading[col.id] = false;
        const requested = pendingHeadRefresh.delete(col.id);
        if (initial || !col.paused || requested) void loadColumn(col);
      }
    } catch (error) {
      if (!isCurrent()) return;
      clientsRefreshing = false;
      swallow('deck.init', error);
      toast.error(i18n.t.deck.initFailed);
      for (const col of columns) columnLoading[col.id] = false;
    }
  }

  function handleAccountsChanged(event: Event) {
    accountRevision++;
    if (!deckReady || disposed) return;
    clientsRefreshing = true;
    clientEntries = new Map();
    for (const col of columns.filter(needsAccountClients)) stopColumnRequests(col.id);
    if ((event as CustomEvent<{ membershipChanged?: boolean }>).detail?.membershipChanged !== false) resetAccountColumns();
    void refreshAccountClients();
  }

  onMount(async () => {
    window.addEventListener('crispdeck:accounts-changed', handleAccountsChanged);
    try {
      // Restore the editable workspace before waiting for credentials, OAuth,
      // or provider requests. Account metadata is needed for portable exports.
      const saved = readJson('crispdeck-deck-columns', defaultColumns, Array.isArray);
      let restoredRevision = accountRevision;
      let storedAccounts = await listAccounts();
      while (!disposed && restoredRevision !== accountRevision) {
        restoredRevision = accountRevision;
        storedAccounts = await listAccounts();
      }
      if (disposed) return;
      accounts = storedAccounts;
      try { columns = parseDeckColumns(saved); } catch { columns = defaultColumns; }
      for (const col of columns) restoreDeckCache(col, storedAccounts);
      refreshLayoutList();
      deckReady = true;
      loading = false;
      for (const col of columns) columnLoading[col.id] = true;

      await refreshAccountClients(true);
    } catch (e) {
      swallow('deck.init', e);
      toast.error(i18n.t.deck.initFailed);
      loading = false;
      for (const col of columns) columnLoading[col.id] = false;
    }

    // Auto-refresh every 5 minutes, skip when tab is hidden.
    // NB: Svelte ignores the return value of an *async* onMount callback, so
    // the teardown lives in onDestroy — returning a cleanup here would leave
    // this interval, the listener and the Jetstream socket running for the
    // rest of the session, and stack another set on the next visit.
    if (disposed) return;
    refreshInterval = setInterval(() => {
      if (document.hidden) return;
      columns.filter(col => !col.paused && Date.now() - (lastRefresh.get(col.id) ?? 0) >= (col.refreshIntervalSeconds ?? 300) * 1000).forEach(col => loadColumn(col));
    }, 1000);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('crispdeck-bookmarks-changed', handleBookmarkChange);
  });

  /** Refresh on tab re-focus — stagger to avoid a thundering herd. */
  function handleBookmarkChange() { columns.filter(col => col.type === 'bookmarks' && !col.paused).forEach(col => loadColumn(col)); }

  function handleVisibility() {
    if (!document.hidden) columns.filter(col => !col.paused).forEach(col => loadColumn(col));
  }

  onDestroy(() => {
    disposed = true;
    if (touchLongPressTimer) clearTimeout(touchLongPressTimer);
    for (const col of columns) clearColumnRuntime(col.id);
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = undefined;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('crispdeck-bookmarks-changed', handleBookmarkChange);
      window.removeEventListener('crispdeck:accounts-changed', handleAccountsChanged);
    }
    streamManager.disconnectAll();
    streamCleanups.clear();
    jetstream.setEnabled(false);
  });

  function saveColumns(): boolean {
    if (!deckReady) return false;
    if (!writeJson('crispdeck-deck-columns', columns)) { toast.error(i18n.t.deck.workspaceSaveFailed); return false; }
    const active = getActiveLayoutName();
    if (active) {
      try { saveLayout(active, columns); }
      catch (error) { swallow('deck.saveWorkspace', error); toast.error(i18n.t.deck.workspaceSaveFailed); return false; }
    }
    return true;
  }

  const columnRequests = new Map<string, number>();
  let requestSequence = 0;
  let disposed = false;
  let columnErrors: Record<string, string[]> = $state({});
  let publishingRefresh: Record<string, number> = $state({});
  let columnCursors: Record<string, Record<string, string | null>> = {};
  let columnHasMore: Record<string, boolean> = $state({});
  let columnLive: Record<string, boolean> = $state({});
  let columnUnread: Record<string, number> = $state({});
  let columnLoaded: Record<string, boolean> = {};
  let columnNotifications: Record<string, UnifiedNotification[]> = {};
  const loadedOlder = new Set<string>();
  const lastRefresh = new Map<string, number>();
  const liveRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingHeadRefresh = new Set<string>();
  const deletedUris = new Map<string, Set<string>>();
  const unlikedAtRequest = new Map<string, number>();

  function likeSourceKey(post: UnifiedPost, accountId = post.sourceAccountId): string {
    return `${post.platform}:${accountId}:${post.uri}`;
  }

  function displayedPosts(col: DeckColumnConfig): UnifiedPost[] {
    return filterColumnPosts(applyMuteFilter(columnPosts[col.id] ?? []), col.filters, col.muteWords);
  }

  function displayedNotificationGroups(col: DeckColumnConfig, groups = columnNotifGroups[col.id] ?? []): NotificationGroup[] {
    const muted = buildMuteFilter();
    return filterColumnNotifications(groups, col.filters, col.muteWords).filter(group => !muted(group.text ?? ''));
  }

  function publishingAccountIds(col: DeckColumnConfig): number[] | undefined {
    if (!col.platform || col.platform === 'all') return col.accountIds;
    return accounts.filter(account => {
      if (account.platform !== col.platform) return false;
      if (col.accountIds === undefined) return true;
      return col.accountIds.includes(account.id);
    }).map(account => account.id);
  }

  function stopColumnRequests(id: string) {
    columnRequests.delete(id);
    streamCleanups.get(id)?.(); streamCleanups.delete(id);
    const timer = liveRefreshTimers.get(id);
    if (timer) clearTimeout(timer);
    liveRefreshTimers.delete(id);
    pendingHeadRefresh.delete(id);
    columnLoading[id] = false;
    columnLive[id] = false;
  }

  function clearColumnRuntime(id: string) {
    stopColumnRequests(id);
    delete columnCursors[id]; delete columnErrors[id]; delete columnPosts[id];
    delete columnNotifGroups[id]; delete columnNotifications[id];
    delete columnHasMore[id]; delete columnLoaded[id]; delete columnUnread[id]; delete columnLive[id];
    columnLoading[id] = false;
    loadedOlder.delete(id); lastRefresh.delete(id); deletedUris.delete(id);
  }

  function startColumnStream(col: DeckColumnConfig) {
    if (streamCleanups.has(col.id) || col.paused || disposed) return;
    const cleanup = subscribeDeckColumn(col, accounts, clientEntries, (event, accountId) => {
      const current = columns.find(column => column.id === col.id);
      if (!current || current.paused || disposed) return;
      if (event.type === 'delete') {
        const removed = (columnPosts[col.id] ?? []).filter(post => event.platform === 'bluesky'
          ? post.uri === event.payload.uri
          : post.sourceAccountId === accountId && String((post.raw as any)?.id) === String(event.payload.id));
        const deleted = deletedUris.get(col.id) ?? new Set<string>();
        for (const post of removed) deleted.add(post.uri);
        if (event.payload.uri) deleted.add(event.payload.uri);
        deletedUris.set(col.id, deleted);
        columnPosts[col.id] = withoutDeletedPosts(columnPosts[col.id] ?? [], deleted);
        return;
      }
      if (!liveRefreshTimers.has(col.id)) {
        liveRefreshTimers.set(col.id, setTimeout(() => {
          liveRefreshTimers.delete(col.id);
          const latest = columns.find(column => column.id === col.id);
          if (latest && !latest.paused && !disposed && !document.hidden) void loadColumn(latest);
        }, 2000));
      }
    }, ready => columnLive[col.id] = ready);
    streamCleanups.set(col.id, cleanup);
  }

  async function loadColumn(col: DeckColumnConfig, older = false) {
    if (disposed || !columns.some(column => column.id === col.id)) return;
    if (clientsRefreshing && needsAccountClients(col)) {
      pendingHeadRefresh.add(col.id);
      return;
    }
    if (columnLoading[col.id]) {
      if (!older) pendingHeadRefresh.add(col.id);
      return;
    }
    const request = ++requestSequence;
    lastRefresh.set(col.id, Date.now());
    columnRequests.set(col.id, request);
    columnLoading[col.id] = true;
    const isCurrent = () => !disposed && columnRequests.get(col.id) === request && columns.some(column => column.id === col.id);
    try {
      if (col.type === 'drafts' || col.type === 'scheduled') { publishingRefresh[col.id] = (publishingRefresh[col.id] ?? 0) + 1; return; }
      if (col.type === 'bookmarks') {
        const bookmarks = await listBookmarks();
        if (isCurrent()) {
          columnPosts[col.id] = bookmarks.filter(post => {
            if (col.platform && col.platform !== 'all' && post.platform !== col.platform) return false;
            if (col.accountIds === undefined) return true;
            if (post.sourceAccountId === undefined) return false;
            return col.accountIds.includes(post.sourceAccountId);
          });
          columnErrors[col.id] = [];
        }
        return;
      }
      const selected = columnAccounts(col, accounts);
      if (col.type !== 'rss' && selected.length === 0) {
        if (isCurrent()) columnErrors[col.id] = [i18n.t.deck.noSelectedAccounts];
        return;
      }
      let posts: UnifiedPost[] = [];
      let notifications: UnifiedNotification[] | undefined;
      let errors: string[] = [];
      if (supportsDeckLoader(col.type)) {
        const page = await loadDeckPage(col, accounts, clientEntries, older ? columnCursors[col.id] : undefined);
        if (!isCurrent()) return;
        posts = page.posts;
        notifications = page.notifications;
        errors = page.errors.map(error => `@${String(accounts.find(account => account.id === error.accountId)?.handle ?? error.accountId).replace(/^@+/, "")}: ${error.message}`);
        if (older || !loadedOlder.has(col.id)) {
          columnCursors[col.id] = page.cursors;
          columnHasMore[col.id] = page.hasMore;
        }
        if (older) loadedOlder.add(col.id);
      } else {
        const results = await Promise.allSettled((col.type === 'rss' ? [[]] : selected.map(account => [account])).map(selection => loadLegacyColumn(col, selection)));
        if (!isCurrent()) return;
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') posts.push(...result.value);
          else { swallow('deck.loadColumn', result.reason); errors.push(`${selected[index]?.handle ?? col.title}: ${i18n.t.deck.columnLoadFailed}`); }
        });
      }
      if (!isCurrent()) return;
      const current = columns.find(column => column.id === col.id)!;
      columnErrors[col.id] = errors;
      if (notifications) {
        const previous = columnNotifications[col.id] ?? [];
        const merged = new Map(previous.map(notification => [notification.id, notification]));
        const arrivals = notifications.filter(notification => !merged.has(notification.id)
          && displayedNotificationGroups(current, groupNotifications([notification])).length > 0);
        for (const notification of notifications) merged.set(notification.id, notification);
        columnNotifications[col.id] = [...merged.values()];
        columnNotifGroups[col.id] = groupNotifications(columnNotifications[col.id]);
        if (columnLoaded[col.id] && !older && arrivals.length) {
          columnUnread[col.id] = (columnUnread[col.id] ?? 0) + arrivals.length;
          notifyColumn(current.notify, current.title, arrivals[0].text ?? arrivals[0].author.displayName ?? arrivals[0].author.handle);
        }
      }
      // An older request may finish after a successful unlike. Do not let that
      // stale snapshot put the removed like back; later requests can reflect
      // a like made again elsewhere without replacing our older pages.
      const sourcePosts = col.type === 'likes' ? posts.filter(post => {
        const removedAt = unlikedAtRequest.get(likeSourceKey(post));
        return removedAt === undefined || request > removedAt;
      }) : posts;
      const incoming = withoutDeletedPosts(sortPosts(sourcePosts, 'newest'), deletedUris.get(col.id) ?? new Set());
      const previous = columnPosts[col.id] ?? [];
      const known = new Set(previous.map(post => post.uri));
      const arrivals = filterColumnPosts(applyMuteFilter(incoming.filter(post => !known.has(post.uri))), current.filters, current.muteWords);
      columnPosts[col.id] = mergeColumnPosts(previous, incoming, older);
      if (columnLoaded[col.id] && !older && !notifications && arrivals.length) {
        columnUnread[col.id] = (columnUnread[col.id] ?? 0) + arrivals.length;
        notifyColumn(current.notify, current.title, arrivals[0].text);
      }
      if (!errors.length || posts.length || notifications?.length) columnLoaded[col.id] = true;
      if (!errors.length) setCache(deckCacheKey(current, accounts), {
        posts: (columnPosts[col.id] ?? []).slice(0, 100),
        notifications: (columnNotifications[col.id] ?? []).slice(0, 100),
      });
      lastRefresh.set(col.id, Date.now());
      startColumnStream(current);
    } catch (error) {
      if (isCurrent()) {
        swallow(`deck.loadColumn:${col.id}`, error);
        columnErrors[col.id] = [i18n.t.deck.columnLoadFailed];
      }
    } finally {
      if (isCurrent()) {
        columnLoading[col.id] = false;
        if (pendingHeadRefresh.delete(col.id)) {
          const current = columns.find(column => column.id === col.id);
          if (current) void loadColumn(current);
        }
      }
    }
  }

  async function loadLegacyColumn(col: DeckColumnConfig, selected: Account[]): Promise<UnifiedPost[]> {
    const posts: UnifiedPost[] = [];
    const selectedIds = new Set(selected.map(account => account.id));
    const allBsky = [...clientEntries.entries()].filter(([id, entry]) => selectedIds.has(id) && entry.platform === 'bluesky');
    const allMasto = [...clientEntries.entries()].filter(([id, entry]) => selectedIds.has(id) && entry.platform === 'mastodon');
    // First client per platform (for single-client operations)
    const bskyEntry = allBsky[0]?.[1];
    const mastoEntry = allMasto[0]?.[1];
    const bskyClient = bskyEntry?.client as BlueskyClient | undefined;
    const mastoClient = mastoEntry?.client as MastodonClient | undefined;

      if (col.type === 'rss' && col.query) {
        try {
          const items = await fetchFeed(col.query);
          const feedTitle = col.title.replace(/^RSS: /, '');
          // 50, matching what a Bluesky or Mastodon column loads. At 30 an RSS
          // column could never reach the render cap, so it behaved differently
          // from every other column type for no stated reason.
          posts.push(...items.slice(0, 50).map(item => rssItemToPost(item, feedTitle)));
        } catch (e) {
          throw e;
        }
      } else if (col.type === 'messages') {
        const inbox = await loadConversationInbox(selected, clientEntries);
        if (inbox.errors.length) throw new Error(i18n.t.deck.columnLoadFailed);
        posts.push(...inbox.conversations.map(conversation => ({
          uri: `chat:${conversation.platform}:${conversation.accountId}:${conversation.id}`,
          text: conversation.lastMessage ?? '',
          author: conversation.participant,
          createdAt: conversation.lastDate ?? '',
          platform: conversation.platform,
          isRepost: false,
          raw: conversation,
        })));
      } else if (col.type === 'trending') {
        // Load trending topics/posts from both platforms
        if (bskyClient) try {
          const agent = bskyEntry?.oauthAgent ?? bskyClient.getAgent();
          // Also try trending topics
          try {
            const topics = await agent.api.app.bsky.unspecced.getTrendingTopics({});
            for (const topic of topics.data.topics ?? []) {
              posts.push({
                uri: `trending:bsky:${topic.topic}`,
                text: `🔥 ${topic.topic}${topic.displayName ? ` — ${topic.displayName}` : ''}`,
                author: { handle: 'trending', displayName: 'Trending on Bluesky' },
                createdAt: new Date().toISOString(),
                platform: 'bluesky',
                isRepost: false,
                raw: topic,
              });
            }
          } catch (e) { throw e; }
        } catch (e) { throw e; }
        if (mastoClient) try {
          const token = mastoClient.getAccessToken();
          const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
          const [tagsResp, linksResp] = await Promise.all([
            fetchOk(`${mastoClient.getInstanceUrl()}/api/v1/trends/tags?limit=10`, { headers }),
            fetchOk(`${mastoClient.getInstanceUrl()}/api/v1/trends/links?limit=10`, { headers }),
          ]);
          if (tagsResp.ok) for (const tag of await tagsResp.json()) {
            const totalUses = (tag.history ?? []).reduce((sum: number, d: any) => sum + parseInt(d.uses ?? 0), 0);
            posts.push({
              uri: `trending:masto:tag:${tag.name}`,
              text: `#${tag.name} — ${totalUses} uses`,
              author: { handle: 'trending', displayName: 'Trending on Mastodon' },
              createdAt: new Date().toISOString(),
              platform: 'mastodon',
              isRepost: false,
              raw: tag,
            });
          }
          if (linksResp.ok) for (const link of await linksResp.json()) {
            posts.push({
              uri: `trending:masto:link:${link.url}`,
              text: `${link.title ?? link.url}`,
              author: { handle: link.provider_name ?? new URL(link.url).hostname, displayName: 'Trending Link', avatar: link.image },
              createdAt: link.published_at ?? new Date().toISOString(),
              platform: 'mastodon',
              isRepost: false,
              raw: link,
            });
          }
        } catch (e) { throw e; }

      }
    return posts.map(post => ({ ...post, sourceAccount: selected[0]?.handle, sourceAccountId: selected[0]?.id }));
  }

  let showFeedPicker = $state(false);

  /** The first connected Bluesky account's agent, or null. */
  function blueskyAgent(): any | null {
    for (const [id, entry] of clientEntries) {
      if (accounts.find(a => a.id === id)?.platform !== 'bluesky') continue;
      return entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
    }
    return null;
  }

  function addFeedColumn(choice: FeedChoice) {
    showFeedPicker = false;
    if (!deckReady) return;
    if (!choice.uri) return;
    const id = `feed-${Date.now()}`;
    columns = [...columns, { id, title: choice.title, type: choice.kind === 'list' ? 'list' : 'feed', query: choice.uri, platform: 'bluesky' }];
    saveColumns();
    loadColumn(columns[columns.length - 1]);
  }

  function addColumn(type: ColumnType) {
    showAddMenu = false;
    if (!deckReady) return;
    if (type === 'feed') { showFeedPicker = true; return; }
    const next: DeckColumnConfig = { id: crypto.randomUUID(), title: availableColumns.find(column => column.type === type)?.label.replace(/\.\.\.$/, '') ?? type, type };
    if (requiresQuery(type)) { editingColumn = next; return; }
    columns = [...columns, next]; saveColumns(); void loadColumn(next);
  }

  function saveColumnSettings(next: DeckColumnConfig) {
    if (!deckReady) return;
    const exists = columns.some(column => column.id === next.id);
    if (exists) clearColumnRuntime(next.id);
    columns = exists ? columns.map(column => column.id === next.id ? next : column) : [...columns, next];
    focusedPostIdx = -1;
    editingColumn = null;
    saveColumns(); void loadColumn(next);
  }

  function duplicateColumn(col: DeckColumnConfig) {
    const next = { ...structuredClone($state.snapshot(col)), id: crypto.randomUUID(), pinned: false };
    const index = columns.findIndex(column => column.id === col.id);
    columns = [...columns.slice(0, index + 1), next, ...columns.slice(index + 1)];
    saveColumns(); void loadColumn(next);
  }

  function moveColumnBy(id: string, delta: number) {
    const index = columns.findIndex(column => column.id === id);
    const target = index + delta;
    if (columns[index]?.pinned || columns[target]?.pinned) return;
    columns = moveColumn(columns, index, target);
    focusedColumnIdx = -1; focusedPostIdx = -1;
    saveColumns();
  }

  function toggleColumnPause(col: DeckColumnConfig) {
    const next = { ...col, paused: !col.paused };
    columns = columns.map(column => column.id === col.id ? next : column);
    streamCleanups.get(col.id)?.(); streamCleanups.delete(col.id);
    const timer = liveRefreshTimers.get(col.id); if (timer) clearTimeout(timer);
    liveRefreshTimers.delete(col.id);
    pendingHeadRefresh.delete(col.id);
    columnRequests.delete(col.id); columnLoading[col.id] = false;
    saveColumns();
    if (!next.paused) void loadColumn(next);
  }

  function updateColumnFilter(col: DeckColumnConfig, query: string) {
    columns = columns.map(column => column.id === col.id ? { ...column, filters: { ...column.filters, searchTerm: query } } : column);
    focusedPostIdx = -1; saveColumns();
  }

  function removeColumn(id: string) {
    if (columns.find(col => col.id === id)?.pinned) return;
    clearColumnRuntime(id);
    columns = columns.filter(c => c.id !== id);
    focusedColumnIdx = -1; focusedPostIdx = -1;
    saveColumns();
  }

  function handleColumnWidthChange(colId: string, width: number) {
    columns = columns.map(c => c.id === colId ? { ...c, width } : c);
    saveColumns();
  }

  function handleNotifyChange(colId: string, mode: ColumnNotifyMode) {
    columns = columns.map(c => c.id === colId ? { ...c, notify: mode } : c);
    saveColumns();
  }

  function handleScrollLockChange(colId: string, locked: boolean) {
    columns = columns.map(c => c.id === colId ? { ...c, scrollLock: locked } : c);
    saveColumns();
  }

  function handleColorChange(colId: string, color: string) {
    columns = columns.map(c => c.id === colId ? { ...c, color } : c);
    saveColumns();
  }

  function handleCollapsedChange(colId: string, collapsed: boolean) {
    columns = columns.map(c => c.id === colId ? { ...c, collapsed } : c);
    saveColumns();
  }

  function handlePinnedChange(colId: string, pinned: boolean) {
    columns = columns.map(c => c.id === colId ? { ...c, pinned } : c);
    saveColumns();
  }

  function handleClear(colId: string) {
    pendingHeadRefresh.delete(colId);
    columnRequests.delete(colId); columnLoading[colId] = false;
    columnUnread[colId] = 0; columnNotifications[colId] = [];
    columnPosts[colId] = [];
    columnNotifGroups[colId] = [];
  }

  function handleDragStart(colId: string, e: DragEvent) {
    draggedColumnId = colId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', colId);
    }
  }

  function handleDragOver(colId: string, e: DragEvent) {
    if (!draggedColumnId || colId === draggedColumnId) return;
    if (columns.find(col => col.id === colId)?.pinned) return;
    e.preventDefault();
    dragOverColumnId = colId;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(colId: string, e: DragEvent) {
    e.preventDefault();
    if (draggedColumnId) reorderColumns(draggedColumnId, colId);
  }
  function reorderColumns(source: string, colId: string) {
    if (source === colId || columns.find(col => col.id === source)?.pinned || columns.find(col => col.id === colId)?.pinned) return;
    const fromIdx = columns.findIndex(c => c.id === source);
    const toIdx = columns.findIndex(c => c.id === colId);
    if (fromIdx < 0 || toIdx < 0) return;
    const moved = columns[fromIdx];
    const updated = [...columns];
    updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    columns = updated;
    focusedColumnIdx = -1; focusedPostIdx = -1;
    saveColumns();
    draggedColumnId = null;
    dragOverColumnId = null;
  }

  async function handleLike(post: UnifiedPost, active = true, column?: DeckColumnConfig) {
    const revision = accountRevision;
    const selected = column ? columnAccounts(column, accounts) : accounts;
    const allowed = selected.map(account => account.id);
    const candidates = allowed.map(id => clientEntries.get(id)).filter(entry => entry?.platform === post.platform);
    const sourceId = post.sourceAccountId ?? (candidates.length === 1 ? candidates[0]?.accountId : undefined);
    const matches = (candidate: UnifiedPost) => candidate.uri === post.uri && candidate.platform === post.platform && candidate.sourceAccountId === sourceId;
    const wasLiked = new WeakMap<UnifiedPost, boolean>();
    const liked = (candidate: UnifiedPost) => {
      const raw = candidate.raw as any;
      const record = candidate.platform === 'mastodon' ? raw?.reblog ?? raw : raw?.post ?? raw;
      return !!(candidate.platform === 'mastodon' ? record?.favourited : record?.viewer?.like);
    };
    // The action mutates its own raw viewer. Capture these flags before the
    // await so every same-account copy receives the count adjustment once.
    for (const rows of Object.values(columnPosts)) for (const candidate of rows) {
      if (matches(candidate)) wasLiked.set(candidate, liked(candidate));
    }
    wasLiked.set(post, liked(post));
    await performDeckAction(post, 'like', active, clientEntries, allowed);
    if (disposed || revision !== accountRevision || sourceId === undefined) return;
    if (active) unlikedAtRequest.delete(likeSourceKey(post, sourceId));
    else unlikedAtRequest.set(likeSourceKey(post, sourceId), requestSequence);
    const actedRaw = post.raw as any;
    const actedRecord = actedRaw?.post ?? actedRaw;
    for (const config of columns) {
      const rows = columnPosts[config.id] ?? [];
      if (!rows.some(matches)) continue;
      columnPosts[config.id] = rows.flatMap(candidate => {
        if (!matches(candidate)) return [candidate];
        if (config.type === 'likes' && !active) {
          if (columns[focusedColumnIdx]?.id === config.id) focusedPostIdx = -1;
          return [];
        }
        const previous = wasLiked.get(candidate) ?? liked(candidate);
        const likeCount = Math.max(0, (candidate.likeCount ?? 0) + Number(active) - Number(previous));
        const raw = candidate.raw as any;
        if (candidate.platform === 'mastodon') {
          const record = raw?.reblog ?? raw;
          const updated = { ...record, favourited: active };
          return [{ ...candidate, likeCount, raw: raw?.reblog ? { ...raw, reblog: updated } : updated }];
        }
        const record = raw?.post ?? raw;
        const updated = { ...record, viewer: { ...record?.viewer, like: actedRecord?.viewer?.like } };
        return [{ ...candidate, likeCount, raw: raw?.post ? { ...raw, post: updated } : updated }];
      });
    }
  }

  async function handleBoost(post: UnifiedPost, active = true, column?: DeckColumnConfig) {
    const selected = column ? columnAccounts(column, accounts) : accounts;
    await performDeckAction(post, 'repost', active, clientEntries, selected.map(account => account.id));
  }
</script>

<svelte:window onkeydown={handleKeydown} onpointermove={movePointerDrag} onpointerup={endPointerDrag} onpointercancel={endPointerDrag} />
<svelte:head><title>CrispDeck — Deck</title><meta name="description" content="Multi-column deck view" /></svelte:head>

<div class="h-full flex flex-col">
  {#if deckReady}
  {#if showStarters || (!loading && accounts.length === 0)}
    <div class="p-4 border-b border-[var(--color-border)] overflow-y-auto max-h-[70vh]"><StarterWorkspaces connected={accounts.length > 0} onapply={applyStarter} /></div>
  {/if}
  {/if}
  <!-- Deck header -->
  <div class="flex flex-wrap gap-2 items-center justify-between px-4 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex-shrink-0">
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2">
        <Columns3 size={20} />
        <h1 class="text-lg font-bold">{i18n.t.nav.deck}</h1>
        <span class="text-xs text-[var(--color-text-muted)]">{columns.length} col</span>
      </div>
      <button disabled={!deckReady} onclick={() => showStarters = !showStarters} class="px-2 py-1 text-xs border border-[var(--color-border)] rounded-lg disabled:opacity-50">{i18n.t.workflow.starterWorkspaces}</button>
      <!-- Saved layouts -->
      {#if savedLayoutNames.length > 0}
        <select
          disabled={!deckReady}
          onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) { try { loadLayoutByName(v); } catch (error) { swallow('deck.switchWorkspace', error); toast.error(i18n.t.deck.workspaceSaveFailed); } } }}
          class="px-2 py-1 text-[10px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
        >
          <option value="">{i18n.t.deck.loadLayoutPlaceholder}</option>
          {#each savedLayoutNames as name}
            <option value={name}>{layoutLabel(name)}</option>
          {/each}
        </select>
      {/if}
      <button disabled={!deckReady} onclick={() => showWorkspaces = true} class="px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] rounded disabled:opacity-50">{i18n.t.deck.manageWorkspaces}</button>
      <button onclick={() => openCompose()} class="flex items-center gap-1 px-2 py-1 text-xs border border-[var(--color-border)] rounded"><Pencil size={12} />{i18n.t.nav.compose}</button>
    </div>
    <div class="relative">
      <button
        disabled={!deckReady}
        onclick={() => showAddMenu = !showAddMenu}
        class="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md disabled:opacity-50"
      >
        <Plus size={12} /> Add Column
      </button>
      {#if showAddMenu}
        <div class="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 py-1 min-w-[160px]">
          {#each availableColumns.filter(opt => {
            if (opt.type === 'local' || opt.type === 'federated') return hasMasto;
            if (opt.type === 'list') return hasMasto || hasBsky;
            if (opt.type === 'feed') return hasBsky;
            if (opt.type === 'threads-search') return hasThreads;
            return true;
          }) as opt}
            <button
              onclick={() => addColumn(opt.type)}
              class="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {opt.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Columns -->
  {#if loading}
    <div class="flex-1 flex items-center justify-center">
      <DelayedSpinner>
        <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin" />
      </DelayedSpinner>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={deckContainerEl}
      class="flex-1 flex overflow-x-auto"
      ontouchmove={handleTouchMove}
      ontouchend={handleTouchEnd}
      ontouchcancel={handleTouchEnd}
    >
      {#each columns as col, colIdx (col.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="transition-all duration-200 {draggedColumnId === col.id || touchDragColumnId === col.id ? 'opacity-40 scale-[0.95]' : ''} {touchDropTargetId === col.id || dragOverColumnId === col.id ? 'ring-2 ring-[var(--color-primary)] rounded-lg' : draggedColumnId && draggedColumnId !== col.id ? 'hover:ring-2 hover:ring-[var(--color-primary)]/30 hover:rounded-lg' : ''} {focusedColumnIdx === colIdx ? 'ring-2 ring-[var(--color-primary)]/50 rounded-lg' : ''}"
          data-deck-column={col.id}
          onpointerdown={(e) => startPointerDrag(col.id, e)}
          ontouchstart={(e) => handleTouchStart(col.id, e)}
          ondragover={(e) => handleDragOver(col.id, e)}
          ondrop={(e) => handleDrop(col.id, e)}
        >
          <DeckColumn
            id={col.id}
            title={col.title}
            type={col.type}
            posts={displayedPosts(col)}
            notificationGroups={displayedNotificationGroups(col)}
            loading={columnLoading[col.id] ?? false}
            streaming={columnLive[col.id] ?? false}
            accounts={columnAccounts(col, accounts)}
            filters={col.filters}
            errors={columnErrors[col.id] ?? []}
            hasOlder={columnHasMore[col.id] ?? false}
            onloadmore={() => loadColumn(col, true)}
            onsettings={() => editingColumn = col}
            onduplicate={() => duplicateColumn(col)}
            onmoveleft={colIdx > 0 && !columns[colIdx - 1]?.pinned ? () => moveColumnBy(col.id, -1) : undefined}
            onmoveright={colIdx < columns.length - 1 && !columns[colIdx + 1]?.pinned ? () => moveColumnBy(col.id, 1) : undefined}
            paused={col.paused ?? false}
            onpause={() => toggleColumnPause(col)}
            unread={columnUnread[col.id] ?? 0}
            onmarkread={() => columnUnread[col.id] = 0}
            onfilterchange={(query) => updateColumnFilter(col, query)}
            width={col.width ?? 380}
            focusedPostIdx={focusedColumnIdx === colIdx ? focusedPostIdx : -1}
            onrefresh={() => loadColumn(col)}
            onremove={() => removeColumn(col.id)}
            onlike={['rss', 'bookmarks'].includes(col.type) ? undefined : (post, active) => handleLike(post, active, col)}
            onboost={['rss', 'bookmarks'].includes(col.type) ? undefined : (post, active) => handleBoost(post, active, col)}
            onreply={handleReply}
            onquote={handleQuote}
            onwidthchange={(w) => handleColumnWidthChange(col.id, w)}
            notify={col.notify ?? 'off'}
            onnotifychange={(mode) => handleNotifyChange(col.id, mode)}
            scrollLock={isColumnLocked(col)}
            onscrolllockchange={(locked) => handleScrollLockChange(col.id, locked)}
            color={col.color ?? ''}
            oncolorchange={(c) => handleColorChange(col.id, c)}
            collapsed={col.collapsed ?? false}
            oncollapsedchange={(c) => handleCollapsedChange(col.id, c)}
            pinned={col.pinned ?? false}
            onpinnedchange={(p) => handlePinnedChange(col.id, p)}
            onclear={['drafts', 'scheduled'].includes(col.type) ? undefined : () => handleClear(col.id)}
            onmove={(direction) => moveColumnBy(col.id, direction)}
            ondragstart={(e) => handleDragStart(col.id, e)}
            ondragend={() => { draggedColumnId = null; dragOverColumnId = null; }}
            children={col.type === 'drafts' || col.type === 'scheduled' ? publishingContent : undefined}
          />
          {#snippet publishingContent()}
            {#if col.type === 'drafts' || col.type === 'scheduled'}
              <PublishingColumn type={col.type} accountIds={publishingAccountIds(col)} filterText={col.filters?.searchTerm} paused={col.paused} refreshKey={publishingRefresh[col.id] ?? 0} />
            {/if}
          {/snippet}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Touch drag floating indicator -->
  {#if touchDragColumnId}
    {@const dragCol = columns.find(c => c.id === touchDragColumnId)}
    {#if dragCol}
      <div
        class="fixed z-[100] pointer-events-none px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium shadow-lg whitespace-nowrap"
        style="left: {touchDragX}px; top: {touchDragY - 40}px; transform: translateX(-50%)"
      >
        {dragCol.title}
      </div>
    {/if}
  {/if}

  <!-- Floating compose panel -->
  <FloatingCompose
    bind:open={composeOpen}
    replyToPost={composeReplyTo}
    quotePost={composeQuotePost}
    onposted={() => columns.filter(col => !col.paused).forEach(col => loadColumn(col))}
  />

{#if showFeedPicker}
  <FeedPickerDialog
    agent={blueskyAgent()}
    onselect={addFeedColumn}
    oncancel={() => showFeedPicker = false}
  />
{/if}
</div>

{#if editingColumn}<ColumnSettings column={editingColumn} {accounts} clients={clientEntries} onsave={saveColumnSettings} onclose={() => editingColumn = null} />{/if}
{#if showWorkspaces && deckReady}<WorkspaceManager {columns} {accounts} onload={loadLayoutByName} onchange={refreshLayoutList} onclose={() => showWorkspaces = false} />{/if}

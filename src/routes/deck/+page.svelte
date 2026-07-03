<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, invalidateClientCache, type ClientEntry } from '$lib/api/client-factory';
  import { Columns3, Plus, Loader2 } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { haptic } from '$lib/haptics';
  import DelayedSpinner from '$lib/components/DelayedSpinner.svelte';
  import DeckColumn from '$lib/components/deck/DeckColumn.svelte';
  import type { ColumnType } from '$lib/components/deck/DeckColumn.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { ThreadsClient } from '$lib/api/threads';
  import { normalizePost, sortPosts } from '$lib/api/unified';
  import type { UnifiedPost, Account } from '$lib/types';
  import { groupNotifications, type UnifiedNotification, type NotificationGroup } from '$lib/notification-grouping';
  import { listTagGroups } from '$lib/tag-groups';
  import { listFeeds, fetchFeed, rssItemToPost } from '$lib/rss';
  import { applyMuteFilter } from '$lib/muted-words';
  import { parseKeywords, buildKeywordMatcher, listKeywordSets } from '$lib/keyword-monitor';
  import { streamManager, type StreamEvent } from '$lib/streaming';
  import {
    listLayouts, getLayout, saveLayout, deleteLayout,
    getActiveLayoutName, setActiveLayoutName,
    type DeckColumnConfig,
  } from '$lib/deck-layouts';

  // Drag-and-drop reorder state (mouse)
  let draggedColumnId: string | null = $state(null);

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
    const touch = e.touches[0];
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

  function handleTouchEnd() {
    // Clear long-press timer
    if (touchLongPressTimer) {
      clearTimeout(touchLongPressTimer);
      touchLongPressTimer = null;
    }

    if (!touchDragColumnId) return;

    // Perform the reorder if we have a valid drop target
    if (touchDropTargetId && touchDropTargetId !== touchDragColumnId) {
      const fromIdx = columns.findIndex(c => c.id === touchDragColumnId);
      const toIdx = columns.findIndex(c => c.id === touchDropTargetId);
      if (fromIdx >= 0 && toIdx >= 0) {
        const moved = columns[fromIdx];
        const updated = [...columns];
        updated.splice(fromIdx, 1);
        updated.splice(toIdx, 0, moved);
        columns = updated;
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
  let showAddMenu = $state(false);
  let columns: DeckColumnConfig[] = $state([]);
  let columnPosts: Record<string, UnifiedPost[]> = $state({});
  let columnNotifGroups: Record<string, NotificationGroup[]> = $state({});
  let columnLoading: Record<string, boolean> = $state({});

  let clientEntries: Map<number, ClientEntry> = new Map();
  let streamCleanups: Map<string, () => void> = new Map();

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
    { type: 'list', label: 'Mastodon List...' },
    { type: 'feed', label: 'Bluesky Feed...' },
    { type: 'tag-group', label: 'Tag Group...' },
    { type: 'rss', label: 'RSS Feed...' },
    { type: 'keyword-monitor', label: 'Monitor Keywords...' },
    { type: 'threads-search', label: 'Threads Search...' },
  ];

  // Saved layouts (using deck-layouts.ts module)
  let savedLayoutNames: string[] = $state([]);

  function refreshLayoutList() {
    savedLayoutNames = listLayouts().map(l => l.name);
  }

  function loadLayoutByName(name: string) {
    const layout = getLayout(name);
    if (layout) {
      columns = [...layout.columns] as DeckColumnConfig[];
      setActiveLayoutName(name);
      saveColumns();
      columns.forEach(col => loadColumn(col));
    }
  }

  onMount(async () => {
    try {
      let result = await initAllClients();
      if (result.accounts.length === 0) {
        invalidateClientCache();
        result = await initAllClients();
      }
      accounts = result.accounts;
      clientEntries = result.clients;
      rebuildClientGroups();

      // Load saved column config or use defaults
      const saved = localStorage.getItem('crispdeck-deck-columns');
      columns = saved ? JSON.parse(saved) : defaultColumns;

      // Load saved layouts via module
      refreshLayoutList();

      // Load columns one by one (show as they load, don't block all)
      loading = false;
      for (const col of columns) {
        loadColumn(col); // fire and forget — each shows its own spinner
      }
    } catch (e) {
      console.error('Deck init failed:', e);
      loading = false;
    }

    // Auto-refresh every 5 minutes, skip when tab is hidden
    const interval = setInterval(() => {
      if (document.hidden) return;
      columns.forEach(col => loadColumn(col));
    }, 300000);
    // Refresh on tab re-focus — stagger to avoid thundering herd
    const handleVisibility = () => {
      if (!document.hidden) columns.forEach((col, i) => setTimeout(() => loadColumn(col), i * 150));
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      streamManager.disconnectAll();
      streamCleanups.clear();
    };
  });

  function saveColumns() {
    localStorage.setItem('crispdeck-deck-columns', JSON.stringify(columns));
  }

  // Precomputed client groups — rebuilt after initAllClients
  let allBsky: [number, ClientEntry][] = [];
  let allMasto: [number, ClientEntry][] = [];
  let allThreads: [number, ClientEntry][] = [];
  function rebuildClientGroups() {
    allBsky = [...clientEntries.entries()].filter(([id]) => accounts.find(a => a.id === id)?.platform === 'bluesky');
    allMasto = [...clientEntries.entries()].filter(([id]) => accounts.find(a => a.id === id)?.platform === 'mastodon');
    allThreads = [...clientEntries.entries()].filter(([id]) => accounts.find(a => a.id === id)?.platform === 'threads');
  }

  async function loadColumn(col: DeckColumnConfig) {
    columnLoading[col.id] = true;
    const posts: UnifiedPost[] = [];

    // First client per platform (for single-client operations)
    const bskyEntry = allBsky[0]?.[1];
    const mastoEntry = allMasto[0]?.[1];
    const threadsEntry = allThreads[0]?.[1];
    const bskyClient = bskyEntry?.client as BlueskyClient | undefined;
    const bskyAgent = bskyEntry?.oauthAgent ?? (bskyClient ? (() => { try { const a = bskyClient.getAgent(); return a?.session ? a : null; } catch { return null; } })() : null);
    const mastoClient = mastoEntry?.client as MastodonClient | undefined;
    const threadsClient = threadsEntry?.client as ThreadsClient | undefined;
    const bskyAcct = accounts.find(a => a.platform === 'bluesky');
    const mastoAcct = accounts.find(a => a.platform === 'mastodon');

    try {
      // Multi-account merge: loop ALL accounts for timeline and my-posts
      if (col.type === 'timeline') {
        for (const [id, entry] of allBsky) {
          const acct = accounts.find(a => a.id === id);
          try {
            if (entry.oauthAgent) {
              const r = await entry.oauthAgent.api.app.bsky.feed.getTimeline({ limit: 50 });
              posts.push(...r.data.feed.map(p => ({ ...normalizePost(p, 'bluesky'), sourceAccount: acct?.handle })));
            } else {
              const r = await (entry.client as BlueskyClient).getTimeline();
              posts.push(...r.feed.map(p => ({ ...normalizePost(p, 'bluesky'), sourceAccount: acct?.handle })));
            }
          } catch {}
        }
        for (const [id, entry] of allMasto) {
          const acct = accounts.find(a => a.id === id);
          try {
            const timeline = await (entry.client as MastodonClient).getHomeTimeline();
            posts.push(...timeline.map(s => ({ ...normalizePost(s, 'mastodon'), sourceAccount: acct?.handle })));
          } catch {}
        }
      } else if (col.type === 'my-posts') {
        for (const [id, entry] of allBsky) {
          const acct = accounts.find(a => a.id === id);
          if (!acct) continue;
          try {
            const r = await (entry.client as BlueskyClient).getAuthorFeed(acct.handle);
            posts.push(...r.feed.map(p => ({ ...normalizePost(p, 'bluesky'), sourceAccount: acct.handle })));
          } catch {}
        }
        for (const [id, entry] of allMasto) {
          const acct = accounts.find(a => a.id === id);
          if (!acct) continue;
          try {
            const a = await (entry.client as MastodonClient).getAccountByHandle(acct.handle);
            const statuses = await (entry.client as MastodonClient).getAccountStatuses(a.id);
            posts.push(...statuses.map(s => ({ ...normalizePost(s, 'mastodon'), sourceAccount: acct.handle })));
          } catch {}
        }
        for (const [id, entry] of allThreads) {
          const acct = accounts.find(a => a.id === id);
          try {
            const client = entry.client as ThreadsClient;
            const threadsPosts = await client.getOwnPosts(25);
            posts.push(...threadsPosts.map(p => ({ ...client.normalizePost(p), sourceAccount: acct?.handle })));
          } catch {}
        }
      } else if (col.type === 'mentions') {
        if (bskyAgent) try {
          const r = await bskyAgent.api.app.bsky.notification.listNotifications({ limit: 50 });
          for (const n of (r.data.notifications ?? []).filter(n => n.reason === 'mention' || n.reason === 'reply')) {
            if ((n.record as any)?.text) posts.push({ uri: n.uri, text: (n.record as any).text, author: { handle: n.author.handle, displayName: n.author.displayName, avatar: n.author.avatar }, createdAt: n.indexedAt, platform: 'bluesky', isRepost: false, raw: n });
          }
        } catch {} else if (bskyClient) try {
          const { notifications } = await bskyClient.getNotifications();
          for (const n of notifications.filter(n => n.reason === 'mention' || n.reason === 'reply')) {
            if ((n.record as any)?.text) posts.push({ uri: n.uri, text: (n.record as any).text, author: { handle: n.author.handle, displayName: n.author.displayName, avatar: n.author.avatar }, createdAt: n.indexedAt, platform: 'bluesky', isRepost: false, raw: n });
          }
        } catch {}
        if (mastoClient) try {
          const token = mastoClient.getAccessToken();
          if (token) {
            const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v1/notifications?types[]=mention&limit=40`, { headers: { Authorization: `Bearer ${token}` } });
            if (resp.ok) for (const n of await resp.json()) { if (n.status) posts.push(normalizePost(n.status, 'mastodon')); }
          }
        } catch {}
      } else if (col.type === 'notifications') {
        // Fetch from both platforms and group
        const allNotifs: UnifiedNotification[] = [];
        if (bskyAgent) try {
          const r = await bskyAgent.api.app.bsky.notification.listNotifications({ limit: 50 });
          for (const n of r.data.notifications ?? []) {
            allNotifs.push({
              id: `bsky-${n.uri}`,
              platform: 'bluesky',
              type: n.reason,
              createdAt: n.indexedAt,
              author: { handle: n.author.handle, displayName: n.author.displayName, avatar: n.author.avatar },
              text: (n.record as any)?.text,
              postUri: n.reasonSubject,
            });
          }
        } catch {} else if (bskyClient) try {
          const { notifications } = await bskyClient.getNotifications();
          for (const n of notifications) {
            allNotifs.push({
              id: `bsky-${n.uri}`,
              platform: 'bluesky',
              type: n.reason,
              createdAt: n.indexedAt,
              author: { handle: n.author.handle, displayName: n.author.displayName, avatar: n.author.avatar },
              text: (n.record as any)?.text,
              postUri: n.reasonSubject,
            });
          }
        } catch {}
        if (mastoClient) try {
          const token = mastoClient.getAccessToken();
          if (token) {
            const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v1/notifications?limit=40`, { headers: { Authorization: `Bearer ${token}` } });
            if (resp.ok) for (const n of await resp.json()) {
              allNotifs.push({
                id: `masto-${n.id}`,
                platform: 'mastodon',
                type: n.type,
                createdAt: n.created_at,
                author: { handle: n.account?.acct ? `@${n.account.acct}` : '?', displayName: n.account?.display_name, avatar: n.account?.avatar },
                text: n.status?.content?.replace(/<[^>]*>?/gm, ''),
                postUri: n.status?.uri,
              });
            }
          }
        } catch {}
        columnNotifGroups[col.id] = groupNotifications(allNotifs);
        columnLoading[col.id] = false;
        return; // Skip the post-based flow
      } else if (col.type === 'search' && col.query && bskyClient) {
        try {
          const r = await bskyClient.searchPosts(col.query);
          for (const p of r.posts) posts.push({ uri: p.uri, text: (p.record as any).text ?? '', author: { handle: p.author.handle, displayName: p.author.displayName, avatar: p.author.avatar }, createdAt: (p.record as any).createdAt ?? p.indexedAt, platform: 'bluesky', likeCount: p.likeCount, repostCount: p.repostCount, isRepost: false, raw: p });
        } catch {}
      } else if (col.type === 'hashtag' && col.query) {
        if (bskyClient) try {
          const r = await bskyClient.searchPosts(`#${col.query}`);
          for (const p of r.posts) posts.push({ uri: p.uri, text: (p.record as any).text ?? '', author: { handle: p.author.handle, displayName: p.author.displayName, avatar: p.author.avatar }, createdAt: (p.record as any).createdAt ?? p.indexedAt, platform: 'bluesky', likeCount: p.likeCount, repostCount: p.repostCount, isRepost: false, raw: p });
        } catch {}
        if (mastoClient) try {
          const token = mastoClient.getAccessToken();
          const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v1/timelines/tag/${col.query}?limit=40`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (resp.ok) posts.push(...(await resp.json()).map((s: any) => normalizePost(s, 'mastodon')));
        } catch {}
      } else if (col.type === 'tag-group' && col.query) {
        // query is comma-separated tags — fetch all in parallel
        const tags = col.query.split(',').filter(Boolean);
        const tagFetchers: Promise<UnifiedPost[]>[] = [];
        for (const tag of tags) {
          if (bskyClient) tagFetchers.push((async () => {
            try {
              const r = await bskyClient.searchPosts(`#${tag}`);
              return r.posts.map(p => ({ uri: p.uri, text: (p.record as any).text ?? '', author: { handle: p.author.handle, displayName: p.author.displayName, avatar: p.author.avatar }, createdAt: (p.record as any).createdAt ?? p.indexedAt, platform: 'bluesky' as const, likeCount: p.likeCount, repostCount: p.repostCount, isRepost: false, raw: p }));
            } catch { return []; }
          })());
          if (mastoClient) tagFetchers.push((async () => {
            try {
              const token = mastoClient.getAccessToken();
              const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v1/timelines/tag/${tag}?limit=20`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
              if (resp.ok) return (await resp.json()).map((s: any) => normalizePost(s, 'mastodon'));
              return [];
            } catch { return []; }
          })());
        }
        const tagResults = await Promise.all(tagFetchers);
        posts.push(...tagResults.flat());
      } else if (col.type === 'rss' && col.query) {
        try {
          const items = await fetchFeed(col.query);
          const feedTitle = col.title.replace(/^RSS: /, '');
          posts.push(...items.slice(0, 30).map(item => rssItemToPost(item, feedTitle)));
        } catch (e) {
          console.error(`Failed to fetch RSS ${col.query}:`, e);
        }
      } else if (col.type === 'user' && col.query) {
        // Try Bluesky first (handles with dots), then Mastodon (handles with @)
        if (bskyClient && (col.query.includes('.') || !col.query.includes('@'))) try { posts.push(...(await bskyClient.getAuthorFeed(col.query)).feed.map(p => normalizePost(p, 'bluesky'))); } catch {}
        if (mastoClient && col.query.includes('@')) try {
          const a = await mastoClient.getAccountByHandle(col.query);
          posts.push(...(await mastoClient.getAccountStatuses(a.id)).map(s => normalizePost(s, 'mastodon')));
        } catch {}
      } else if (col.type === 'local' && mastoClient) {
        try {
          const token = mastoClient.getAccessToken();
          const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v1/timelines/public?local=true&limit=40`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (resp.ok) posts.push(...(await resp.json()).map((s: any) => normalizePost(s, 'mastodon')));
        } catch {}
      } else if (col.type === 'federated' && mastoClient) {
        try {
          const token = mastoClient.getAccessToken();
          const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v1/timelines/public?limit=40`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (resp.ok) posts.push(...(await resp.json()).map((s: any) => normalizePost(s, 'mastodon')));
        } catch {}
      } else if (col.type === 'list' && col.query && mastoClient) {
        try {
          const token = mastoClient.getAccessToken();
          if (token) {
            const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v1/timelines/list/${col.query}?limit=40`, { headers: { Authorization: `Bearer ${token}` } });
            if (resp.ok) posts.push(...(await resp.json()).map((s: any) => normalizePost(s, 'mastodon')));
          }
        } catch {}
      } else if (col.type === 'feed' && col.query && bskyEntry) {
        try {
          const agent = bskyEntry.oauthAgent ?? (bskyEntry.client as BlueskyClient).getAgent();
          const resp = await agent.api.app.bsky.feed.getFeed({ feed: col.query, limit: 50 });
          posts.push(...resp.data.feed.map(p => normalizePost(p, 'bluesky')));
        } catch {}
      } else if (col.type === 'keyword-monitor' && col.query) {
        const entries = parseKeywords(col.query);
        const matches = buildKeywordMatcher(entries);
        // Search all connected networks in parallel for keyword matches
        const searchTerms = entries.filter(e => !e.isRegex).map(e => e.value);
        const searchQuery = searchTerms.length > 0 ? searchTerms.join(' OR ') : entries[0]?.value ?? '';
        if (searchQuery) {
          const kwFetchers: Promise<UnifiedPost[]>[] = [];

          if (bskyClient) kwFetchers.push((async () => {
            try {
              const r = await bskyClient.searchPosts(searchQuery);
              return r.posts
                .map(p => ({ uri: p.uri, text: (p.record as any).text ?? '', author: { handle: p.author.handle, displayName: p.author.displayName, avatar: p.author.avatar }, createdAt: (p.record as any).createdAt ?? p.indexedAt, platform: 'bluesky' as const, likeCount: p.likeCount, repostCount: p.repostCount, isRepost: false, raw: p }))
                .filter(p => matches(p.text));
            } catch { return []; }
          })());

          if (mastoClient) {
            const token = mastoClient.getAccessToken();
            const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
            // Mastodon search doesn't support OR — search each term in parallel
            const terms = searchTerms.length > 0 ? searchTerms : [searchQuery];
            for (const term of terms) {
              kwFetchers.push((async () => {
                try {
                  const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v2/search?q=${encodeURIComponent(term)}&type=statuses&limit=20`, { headers });
                  if (!resp.ok) return [];
                  const data = await resp.json();
                  return (data.statuses ?? []).map((s: any) => normalizePost(s, 'mastodon')).filter((p: UnifiedPost) => matches(p.text));
                } catch { return []; }
              })());
            }
          }

          if (threadsClient) kwFetchers.push((async () => {
            try {
              const results = await threadsClient.keywordSearch(searchQuery, { searchType: 'RECENT', limit: 25 });
              return results.map(p => normalizePost(p, 'threads')).filter(p => matches(p.text));
            } catch { return []; }
          })());

          const kwResults = await Promise.all(kwFetchers);
          posts.push(...kwResults.flat());
        }
      } else if (col.type === 'threads-search' && col.query && threadsClient) {
        try {
          const results = await threadsClient.keywordSearch(col.query, { searchType: 'RECENT', limit: 50 });
          posts.push(...results.map(p => normalizePost(p, 'threads')));
        } catch (e) {
          console.error('Threads search column failed:', e);
        }
      }
    } catch (e) {
      console.error(`Failed to load column ${col.id}:`, e);
    }

    // Dedup by URI to avoid Svelte each_key_duplicate errors
    const seen = new Set<string>();
    const deduped = posts.filter(p => { if (seen.has(p.uri)) return false; seen.add(p.uri); return true; });
    columnPosts[col.id] = applyMuteFilter(sortPosts(deduped, 'newest'));
    columnLoading[col.id] = false;

    // Enable streaming for keyword-monitor columns
    if (col.type === 'keyword-monitor' && col.query) {
      // Clean up previous stream for this column (e.g. on refresh)
      const prevCleanup = streamCleanups.get(col.id);
      if (prevCleanup) prevCleanup();

      const entries = parseKeywords(col.query);
      const matches = buildKeywordMatcher(entries);

      const handleStreamEvent = (event: StreamEvent) => {
        if (event.type !== 'new-post') return;
        try {
          const normalized = normalizePost(event.payload, event.platform);
          if (!matches(normalized.text)) return;
          // Prepend to existing posts, dedup by URI
          const existing = columnPosts[col.id] ?? [];
          if (existing.some(p => p.uri === normalized.uri)) return;
          columnPosts[col.id] = [normalized, ...existing].slice(0, 200);
        } catch {}
      };

      const cleanups: (() => void)[] = [];
      // Subscribe to Mastodon public stream (catches federated + local)
      if (mastoClient) {
        const token = mastoClient.getAccessToken();
        if (token) {
          cleanups.push(streamManager.enableColumn({
            columnId: `${col.id}-masto`,
            platform: 'mastodon',
            instanceUrl: mastoClient.getInstanceUrl(),
            accessToken: token,
            streamType: 'public',
          }, handleStreamEvent));
        }
      }
      // Subscribe to Bluesky Jetstream firehose — unfiltered, keyword filter applied client-side
      if (bskyClient) {
        cleanups.push(streamManager.enableColumn({
          columnId: `${col.id}-bsky`,
          platform: 'bluesky',
          firehose: true,
        }, handleStreamEvent));
      }

      if (cleanups.length > 0) {
        streamCleanups.set(col.id, () => cleanups.forEach(fn => fn()));
      }
    }
  }

  function addColumn(type: ColumnType) {
    const id = `${type}-${Date.now()}`;
    let title = availableColumns.find(c => c.type === type)?.label ?? type;
    let query: string | undefined;

    if (type === 'search') {
      query = prompt('Search query:') ?? undefined;
      if (!query) return;
      title = `Search: ${query}`;
    } else if (type === 'hashtag') {
      query = prompt('Hashtag (without #):') ?? undefined;
      if (!query) return;
      title = `#${query}`;
    } else if (type === 'user') {
      query = prompt('User handle (e.g. alice.bsky.social):') ?? undefined;
      if (!query) return;
      title = `@${query}`;
    } else if (type === 'list') {
      query = prompt('Mastodon list ID (from /lists page):') ?? undefined;
      if (!query) return;
      title = `List: ${query}`;
    } else if (type === 'feed') {
      query = prompt('Bluesky feed URI (at://...):') ?? undefined;
      if (!query) return;
      title = `Feed: ${query.split('/').pop()}`;
    } else if (type === 'tag-group') {
      const groups = listTagGroups();
      if (groups.length === 0) {
        alert('No tag groups saved yet. Create one in Settings or use multiple hashtag columns.');
        return;
      }
      const name = prompt(`Tag groups: ${groups.map(g => g.name).join(', ')}\nEnter group name:`);
      if (!name) return;
      const group = groups.find(g => g.name.toLowerCase() === name.toLowerCase());
      if (!group) { alert(`Tag group "${name}" not found.`); return; }
      query = group.tags.join(',');
      title = `#${group.name}`;
    } else if (type === 'rss') {
      const feeds = listFeeds();
      if (feeds.length === 0) {
        const url = prompt('RSS feed URL:');
        if (!url) return;
        query = url;
        title = `RSS: ${new URL(url).hostname}`;
      } else {
        const name = prompt(`RSS feeds: ${feeds.map(f => f.title).join(', ')}\nEnter feed name or paste a new URL:`);
        if (!name) return;
        const feed = feeds.find(f => f.title.toLowerCase() === name.toLowerCase());
        if (feed) {
          query = feed.url;
          title = `RSS: ${feed.title}`;
        } else if (name.startsWith('http')) {
          query = name;
          title = `RSS: ${new URL(name).hostname}`;
        } else {
          alert(`Feed "${name}" not found.`);
          return;
        }
      }
    } else if (type === 'threads-search') {
      const input = prompt('Threads search query (e.g. #tech, AI, photography):');
      if (!input) return;
      query = input;
      title = `Threads: ${input.length > 20 ? input.slice(0, 20) + '...' : input}`;
    } else if (type === 'keyword-monitor') {
      const saved = listKeywordSets();
      let input: string | undefined;
      if (saved.length > 0) {
        input = prompt(`Saved: ${saved.map(s => s.name).join(', ')}\nEnter set name or keywords (comma-separated):`) ?? undefined;
      } else {
        input = prompt('Keywords to monitor (comma-separated, /regex/ supported):') ?? undefined;
      }
      if (!input) return;
      // Check if it matches a saved set name
      const set = saved.find(s => s.name.toLowerCase() === input!.toLowerCase());
      if (set) {
        query = set.keywords.map(k => k.isRegex ? `/${k.value}/` : k.value).join(',');
        title = `Monitor: ${set.name}`;
      } else {
        query = input;
        const keywords = parseKeywords(input);
        title = `Monitor: ${keywords.slice(0, 3).map(k => k.value).join(', ')}${keywords.length > 3 ? '...' : ''}`;
      }
    }

    columns = [...columns, { id, title, type, query }];

    saveColumns();
    showAddMenu = false;
    loadColumn(columns[columns.length - 1]);
  }

  function removeColumn(id: string) {
    columns = columns.filter(c => c.id !== id);
    delete columnPosts[id];
    // Clean up any active streams for this column
    const cleanup = streamCleanups.get(id);
    if (cleanup) { cleanup(); streamCleanups.delete(id); }
    saveColumns();
  }

  function handleColumnWidthChange(colId: string, width: number) {
    columns = columns.map(c => c.id === colId ? { ...c, width } : c);
    saveColumns();
  }

  function handleDragStart(colId: string, e: DragEvent) {
    draggedColumnId = colId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', colId);
    }
  }

  function handleDragOver(colId: string, e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(colId: string, e: DragEvent) {
    e.preventDefault();
    if (!draggedColumnId || draggedColumnId === colId) return;
    const fromIdx = columns.findIndex(c => c.id === draggedColumnId);
    const toIdx = columns.findIndex(c => c.id === colId);
    if (fromIdx < 0 || toIdx < 0) return;
    const moved = columns[fromIdx];
    const updated = [...columns];
    updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    columns = updated;
    saveColumns();
    draggedColumnId = null;
  }

  async function handleLike(post: UnifiedPost) {
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== post.platform) continue;
      try {
        if (post.platform === 'bluesky') {
          const raw = post.raw as any;
          await (entry.client as BlueskyClient).like(raw.post?.uri ?? raw.uri, raw.post?.cid ?? raw.cid);
        } else {
          const raw = post.raw as any;
          await (entry.client as MastodonClient).favourite(raw.id);
        }
        return;
      } catch (e) { console.error('Like failed:', e); }
    }
  }

  async function handleBoost(post: UnifiedPost) {
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== post.platform) continue;
      try {
        if (post.platform === 'bluesky') {
          const raw = post.raw as any;
          await (entry.client as BlueskyClient).repost(raw.post?.uri ?? raw.uri, raw.post?.cid ?? raw.cid);
        } else {
          const raw = post.raw as any;
          await (entry.client as MastodonClient).reblog(raw.id);
        }
        return;
      } catch (e) { console.error('Boost failed:', e); }
    }
  }
</script>

<svelte:head><title>CrispDeck — Deck</title><meta name="description" content="Multi-column TweetDeck-style view" /></svelte:head>

<div class="h-full flex flex-col">
  <!-- Deck header -->
  <div class="flex items-center justify-between px-4 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex-shrink-0">
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <Columns3 size={20} />
        <h1 class="text-lg font-bold">Deck</h1>
        <span class="text-xs text-[var(--color-text-muted)]">{columns.length} col</span>
      </div>
      <!-- Saved layouts -->
      {#if savedLayoutNames.length > 0}
        <select
          onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) loadLayoutByName(v); }}
          class="px-2 py-1 text-[10px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
        >
          <option value="">Load layout...</option>
          {#each savedLayoutNames as name}
            <option value={name}>{name}</option>
          {/each}
        </select>
      {/if}
      <button
        onclick={() => {
          const name = prompt('Layout name:');
          if (name) {
            saveLayout(name, columns);
            setActiveLayoutName(name);
            refreshLayoutList();
          }
        }}
        class="px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] rounded"
      >
        Save
      </button>
    </div>
    <div class="relative">
      <button
        onclick={() => showAddMenu = !showAddMenu}
        class="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md"
      >
        <Plus size={12} /> Add Column
      </button>
      {#if showAddMenu}
        <div class="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 py-1 min-w-[160px]">
          {#each availableColumns.filter(opt => {
            if (opt.type === 'local' || opt.type === 'federated' || opt.type === 'list') return hasMasto;
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
  {:else if accounts.length === 0}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <Columns3 size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
        <p class="text-[var(--color-text-muted)]">Add accounts in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> first.</p>
      </div>
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
      {#each columns as col (col.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="transition-all duration-200 {draggedColumnId === col.id || touchDragColumnId === col.id ? 'opacity-40 scale-[0.95]' : ''} {touchDropTargetId === col.id ? 'ring-2 ring-[var(--color-primary)] rounded-lg' : draggedColumnId && draggedColumnId !== col.id ? 'hover:ring-2 hover:ring-[var(--color-primary)]/30 hover:rounded-lg' : ''}"
          ontouchstart={(e) => handleTouchStart(col.id, e)}
        >
          <DeckColumn
            id={col.id}
            title={col.title}
            type={col.type}
            posts={columnPosts[col.id] ?? []}
            notificationGroups={columnNotifGroups[col.id] ?? []}
            loading={columnLoading[col.id] ?? false}
            streaming={streamCleanups.has(col.id)}
            width={col.width ?? 380}
            onrefresh={() => loadColumn(col)}
            onremove={() => removeColumn(col.id)}
            onlike={handleLike}
            onboost={handleBoost}
            onwidthchange={(w) => handleColumnWidthChange(col.id, w)}
            ondragstart={(e) => handleDragStart(col.id, e)}
            ondragover={(e) => handleDragOver(col.id, e)}
            ondrop={(e) => handleDrop(col.id, e)}
            ondragend={() => draggedColumnId = null}
          />
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
</div>

<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Columns3, Plus, Loader2 } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
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

  interface DeckColumnConfig {
    id: string;
    title: string;
    type: ColumnType;
    platform?: 'bluesky' | 'mastodon' | 'threads';
    query?: string; // for search/hashtag columns
    width?: number; // column width in pixels
  }

  // Drag-and-drop reorder state
  let draggedColumnId: string | null = $state(null);

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let showAddMenu = $state(false);
  let columns: DeckColumnConfig[] = $state([]);
  let columnPosts: Record<string, UnifiedPost[]> = $state({});
  let columnNotifGroups: Record<string, NotificationGroup[]> = $state({});
  let columnLoading: Record<string, boolean> = $state({});

  let clientEntries: Map<number, ClientEntry> = new Map();
  let streamCleanups: Map<string, () => void> = new Map();

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
  ];

  // Saved layouts
  let savedLayouts: Record<string, DeckColumnConfig[]> = $state({});

  function loadLayout(name: string) {
    const layout = savedLayouts[name];
    if (layout) {
      columns = [...layout];
      saveColumns();
      columns.forEach(col => loadColumn(col));
    }
  }

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;

      // Load saved column config or use defaults
      const saved = localStorage.getItem('crispdeck-deck-columns');
      columns = saved ? JSON.parse(saved) : defaultColumns;

      // Load saved layouts
      const layouts = localStorage.getItem('crispdeck-deck-layouts');
      if (layouts) savedLayouts = JSON.parse(layouts);

      // Load columns one by one (show as they load, don't block all)
      loading = false;
      for (const col of columns) {
        loadColumn(col); // fire and forget — each shows its own spinner
      }
    } catch (e) {
      console.error('Deck init failed:', e);
      loading = false;
    }

    // Auto-refresh every 3 minutes (not 2 — less aggressive)
    const interval = setInterval(() => {
      columns.forEach(col => loadColumn(col));
    }, 180000);
    return () => {
      clearInterval(interval);
      streamManager.disconnectAll();
      streamCleanups.clear();
    };
  });

  function saveColumns() {
    localStorage.setItem('crispdeck-deck-columns', JSON.stringify(columns));
  }

  async function loadColumn(col: DeckColumnConfig) {
    columnLoading[col.id] = true;
    const posts: UnifiedPost[] = [];

    // Collect ALL clients per platform (multi-account merge)
    const allBsky = [...clientEntries.entries()].filter(([id]) => accounts.find(a => a.id === id)?.platform === 'bluesky');
    const allMasto = [...clientEntries.entries()].filter(([id]) => accounts.find(a => a.id === id)?.platform === 'mastodon');
    const allThreads = [...clientEntries.entries()].filter(([id]) => accounts.find(a => a.id === id)?.platform === 'threads');
    // First client per platform (for single-client operations)
    const bskyEntry = allBsky[0]?.[1];
    const mastoEntry = allMasto[0]?.[1];
    const threadsEntry = allThreads[0]?.[1];
    const bskyClient = bskyEntry?.client as BlueskyClient | undefined;
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
            const r = await (entry.client as BlueskyClient).getTimeline();
            posts.push(...r.feed.map(p => ({ ...normalizePost(p, 'bluesky'), sourceAccount: acct?.handle })));
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
        if (bskyClient) try {
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
        if (bskyClient) try {
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
        // query is comma-separated tags
        const tags = col.query.split(',').filter(Boolean);
        for (const tag of tags) {
          if (bskyClient) try {
            const r = await bskyClient.searchPosts(`#${tag}`);
            for (const p of r.posts) posts.push({ uri: p.uri, text: (p.record as any).text ?? '', author: { handle: p.author.handle, displayName: p.author.displayName, avatar: p.author.avatar }, createdAt: (p.record as any).createdAt ?? p.indexedAt, platform: 'bluesky', likeCount: p.likeCount, repostCount: p.repostCount, isRepost: false, raw: p });
          } catch {}
          if (mastoClient) try {
            const token = mastoClient.getAccessToken();
            const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v1/timelines/tag/${tag}?limit=20`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (resp.ok) posts.push(...(await resp.json()).map((s: any) => normalizePost(s, 'mastodon')));
          } catch {}
        }
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
        // Search all connected networks for keyword matches
        const searchTerms = entries.filter(e => !e.isRegex).map(e => e.value);
        const searchQuery = searchTerms.length > 0 ? searchTerms.join(' OR ') : entries[0]?.value ?? '';
        if (searchQuery) {
          if (bskyClient) try {
            const r = await bskyClient.searchPosts(searchQuery);
            for (const p of r.posts) {
              const text = (p.record as any).text ?? '';
              if (matches(text)) {
                posts.push({ uri: p.uri, text, author: { handle: p.author.handle, displayName: p.author.displayName, avatar: p.author.avatar }, createdAt: (p.record as any).createdAt ?? p.indexedAt, platform: 'bluesky', likeCount: p.likeCount, repostCount: p.repostCount, isRepost: false, raw: p });
              }
            }
          } catch {}
          if (mastoClient) try {
            const token = mastoClient.getAccessToken();
            const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
            // Mastodon search doesn't support OR — search each term
            for (const term of (searchTerms.length > 0 ? searchTerms : [searchQuery])) {
              const resp = await fetch(`${mastoClient.getInstanceUrl()}/api/v2/search?q=${encodeURIComponent(term)}&type=statuses&limit=20`, { headers });
              if (resp.ok) {
                const data = await resp.json();
                for (const s of data.statuses ?? []) {
                  const normalized = normalizePost(s, 'mastodon');
                  if (matches(normalized.text)) posts.push(normalized);
                }
              }
            }
          } catch {}
          if (threadsClient) try {
            const results = await threadsClient.search(searchQuery, 'KEYWORD');
            for (const p of results) {
              const normalized = threadsClient.normalizePost(p);
              if (matches(normalized.text)) posts.push(normalized);
            }
          } catch {}
        }
      }
    } catch (e) {
      console.error(`Failed to load column ${col.id}:`, e);
    }

    columnPosts[col.id] = applyMuteFilter(sortPosts(posts, 'newest'));
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
      {#if Object.keys(savedLayouts).length > 0}
        <select
          onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) loadLayout(v); }}
          class="px-2 py-1 text-[10px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
        >
          <option value="">Load layout...</option>
          {#each Object.keys(savedLayouts) as name}
            <option value={name}>{name}</option>
          {/each}
        </select>
      {/if}
      <button
        onclick={() => {
          const name = prompt('Layout name:');
          if (name) {
            savedLayouts[name] = [...columns];
            localStorage.setItem('crispdeck-deck-layouts', JSON.stringify(savedLayouts));
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
          {#each availableColumns as opt}
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
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin" />
    </div>
  {:else if accounts.length === 0}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <Columns3 size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
        <p class="text-[var(--color-text-muted)]">Add accounts in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> first.</p>
      </div>
    </div>
  {:else}
    <div class="flex-1 flex overflow-x-auto">
      {#each columns as col (col.id)}
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
        />
      {/each}
    </div>
  {/if}
</div>

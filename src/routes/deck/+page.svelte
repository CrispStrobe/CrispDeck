<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Columns3, Plus, Loader2 } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import DeckColumn from '$lib/components/deck/DeckColumn.svelte';
  import type { ColumnType } from '$lib/components/deck/DeckColumn.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost, sortPosts } from '$lib/api/unified';
  import type { UnifiedPost, Account } from '$lib/types';

  interface DeckColumnConfig {
    id: string;
    title: string;
    type: ColumnType;
    platform?: 'bluesky' | 'mastodon';
    query?: string; // for search/hashtag columns
  }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let showAddMenu = $state(false);
  let columns: DeckColumnConfig[] = $state([]);
  let columnPosts: Record<string, UnifiedPost[]> = $state({});
  let columnLoading: Record<string, boolean> = $state({});

  let clientEntries: Map<number, ClientEntry> = new Map();

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
    return () => clearInterval(interval);
  });

  function saveColumns() {
    localStorage.setItem('crispdeck-deck-columns', JSON.stringify(columns));
  }

  async function loadColumn(col: DeckColumnConfig) {
    columnLoading[col.id] = true;
    const posts: UnifiedPost[] = [];

    // Pick ONE client per platform (no need to loop all accounts for each column)
    const bskyEntry = [...clientEntries.entries()].find(([id]) => accounts.find(a => a.id === id)?.platform === 'bluesky')?.[1];
    const mastoEntry = [...clientEntries.entries()].find(([id]) => accounts.find(a => a.id === id)?.platform === 'mastodon')?.[1];
    const bskyClient = bskyEntry?.client as BlueskyClient | undefined;
    const mastoClient = mastoEntry?.client as MastodonClient | undefined;
    const bskyAcct = accounts.find(a => a.platform === 'bluesky');
    const mastoAcct = accounts.find(a => a.platform === 'mastodon');

    try {
      // Direct loading — no loops, one API call per column
      if (col.type === 'timeline') {
        if (bskyClient) try { const r = await bskyClient.getTimeline(); posts.push(...r.feed.map(p => normalizePost(p, 'bluesky'))); } catch {}
        if (mastoClient) try { posts.push(...(await mastoClient.getHomeTimeline()).map(s => normalizePost(s, 'mastodon'))); } catch {}
      } else if (col.type === 'my-posts') {
        if (bskyClient && bskyAcct) try { posts.push(...(await bskyClient.getAuthorFeed(bskyAcct.handle)).feed.map(p => normalizePost(p, 'bluesky'))); } catch {}
        if (mastoClient && mastoAcct) try {
          const a = await mastoClient.getAccountByHandle(mastoAcct.handle);
          posts.push(...(await mastoClient.getAccountStatuses(a.id)).map(s => normalizePost(s, 'mastodon')));
        } catch {}
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
      } else if (col.type === 'notifications' && bskyClient) {
        try {
          const { notifications } = await bskyClient.getNotifications();
          for (const n of notifications.slice(0, 20)) {
            if ((n.record as any)?.text) posts.push({ uri: n.uri, text: `[${n.reason}] ${(n.record as any).text || ''}`, author: { handle: n.author.handle, displayName: n.author.displayName, avatar: n.author.avatar }, createdAt: n.indexedAt, platform: 'bluesky', isRepost: false, raw: n });
          }
        } catch {}
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
      }
    } catch (e) {
      console.error(`Failed to load column ${col.id}:`, e);
    }

    columnPosts[col.id] = sortPosts(posts, 'newest');
    columnLoading[col.id] = false;
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
    }

    columns = [...columns, { id, title, type, query }];

    saveColumns();
    showAddMenu = false;
    loadColumn(columns[columns.length - 1]);
  }

  function removeColumn(id: string) {
    columns = columns.filter(c => c.id !== id);
    delete columnPosts[id];
    saveColumns();
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
          loading={columnLoading[col.id] ?? false}
          onrefresh={() => loadColumn(col)}
          onremove={() => removeColumn(col.id)}
          onlike={handleLike}
          onboost={handleBoost}
        />
      {/each}
    </div>
  {/if}
</div>

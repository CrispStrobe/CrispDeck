<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { Columns3, Plus, Loader2 } from '@lucide/svelte';
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

  let clients: Map<number, BlueskyClient | MastodonClient> = new Map();

  const defaultColumns: DeckColumnConfig[] = [
    { id: 'timeline', title: 'Timeline', type: 'timeline' },
    { id: 'notifications', title: 'Notifications', type: 'notifications' },
    { id: 'mentions', title: 'Mentions', type: 'mentions' },
  ];

  const availableColumns: { type: ColumnType; label: string }[] = [
    { type: 'timeline', label: 'Timeline' },
    { type: 'my-posts', label: 'My Posts' },
    { type: 'mentions', label: 'Mentions' },
    { type: 'notifications', label: 'Notifications' },
    { type: 'search', label: 'Search...' },
    { type: 'hashtag', label: 'Hashtag...' },
    { type: 'user', label: 'User Feed...' },
  ];

  onMount(async () => {
    try {
      accounts = await listAccounts();
      await initClients();

      // Load saved column config or use defaults
      const saved = localStorage.getItem('crispdeck-deck-columns');
      columns = saved ? JSON.parse(saved) : defaultColumns;

      // Load all columns
      await Promise.all(columns.map(col => loadColumn(col)));
    } catch (e) {
      console.error('Deck init failed:', e);
    } finally {
      loading = false;
    }

    // Auto-refresh every 2 minutes
    const interval = setInterval(() => {
      columns.forEach(col => loadColumn(col));
    }, 120000);
    return () => clearInterval(interval);
  });

  async function initClients() {
    for (const acct of accounts) {
      try {
        const credsJson = await getDecryptedCredentials(acct.id);
        const creds = JSON.parse(credsJson);
        if (acct.platform === 'bluesky') {
          const client = new BlueskyClient(acct.handle, creds.app_password);
          await client.login();
          clients.set(acct.id, client);
        } else {
          clients.set(acct.id, new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          ));
        }
      } catch (e) {
        console.error(`Client init failed for ${acct.handle}:`, e);
      }
    }
  }

  function saveColumns() {
    localStorage.setItem('crispdeck-deck-columns', JSON.stringify(columns));
  }

  async function loadColumn(col: DeckColumnConfig) {
    columnLoading[col.id] = true;
    const posts: UnifiedPost[] = [];

    try {
      for (const [id, client] of clients) {
        const acct = accounts.find(a => a.id === id);
        if (!acct) continue;
        if (col.platform && acct.platform !== col.platform) continue;

        if (col.type === 'timeline') {
          if (acct.platform === 'bluesky') {
            const bsky = client as BlueskyClient;
            try {
              const r = await bsky.getTimeline();
              posts.push(...r.feed.map(p => normalizePost(p, 'bluesky')));
            } catch { /* auth may fail for timeline */ }
          } else {
            const masto = client as MastodonClient;
            try {
              const statuses = await masto.getHomeTimeline();
              posts.push(...statuses.map(s => normalizePost(s, 'mastodon')));
            } catch { /* auth may fail */ }
          }
        } else if (col.type === 'my-posts') {
          if (acct.platform === 'bluesky') {
            const bsky = client as BlueskyClient;
            const r = await bsky.getAuthorFeed(acct.handle);
            posts.push(...r.feed.map(p => normalizePost(p, 'bluesky')));
          } else {
            const masto = client as MastodonClient;
            const account = await masto.getAccountByHandle(acct.handle);
            const statuses = await masto.getAccountStatuses(account.id);
            posts.push(...statuses.map(s => normalizePost(s, 'mastodon')));
          }
        } else if (col.type === 'mentions') {
          if (acct.platform === 'bluesky') {
            const bsky = client as BlueskyClient;
            try {
              const { notifications } = await bsky.getNotifications();
              const mentionNotifs = notifications.filter(n => n.reason === 'mention' || n.reason === 'reply');
              for (const n of mentionNotifs) {
                if ((n.record as any)?.text) {
                  posts.push({
                    uri: n.uri,
                    text: (n.record as any).text,
                    author: { handle: n.author.handle, displayName: n.author.displayName, avatar: n.author.avatar },
                    createdAt: n.indexedAt,
                    platform: 'bluesky',
                    isRepost: false,
                    raw: n,
                  });
                }
              }
            } catch {}
          } else {
            const masto = client as MastodonClient;
            const token = masto.getAccessToken();
            if (token) {
              try {
                const resp = await fetch(
                  `${masto.getInstanceUrl()}/api/v1/notifications?types[]=mention&limit=40`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                if (resp.ok) {
                  const raw = await resp.json();
                  for (const n of raw) {
                    if (n.status) {
                      posts.push(normalizePost(n.status, 'mastodon'));
                    }
                  }
                }
              } catch {}
            }
          }
        } else if (col.type === 'notifications') {
          if (acct.platform === 'bluesky') {
            const bsky = client as BlueskyClient;
            try {
              const { notifications } = await bsky.getNotifications();
              for (const n of notifications.slice(0, 20)) {
                if ((n.record as any)?.text) {
                  posts.push({
                    uri: n.uri,
                    text: `[${n.reason}] ${(n.record as any).text || ''}`,
                    author: { handle: n.author.handle, displayName: n.author.displayName, avatar: n.author.avatar },
                    createdAt: n.indexedAt,
                    platform: 'bluesky',
                    isRepost: false,
                    raw: n,
                  });
                }
              }
            } catch {}
          }
        } else if (col.type === 'search' && col.query) {
          if (acct.platform === 'bluesky') {
            const bsky = client as BlueskyClient;
            try {
              const r = await bsky.searchPosts(col.query);
              for (const p of r.posts) {
                posts.push({
                  uri: p.uri,
                  text: (p.record as any).text ?? '',
                  author: { handle: p.author.handle, displayName: p.author.displayName, avatar: p.author.avatar },
                  createdAt: (p.record as any).createdAt ?? p.indexedAt,
                  platform: 'bluesky',
                  likeCount: p.likeCount,
                  repostCount: p.repostCount,
                  isRepost: false,
                  raw: p,
                });
              }
            } catch {}
          }
        } else if (col.type === 'hashtag' && col.query) {
          // Search for hashtag across platforms
          if (acct.platform === 'bluesky') {
            try {
              const r = await (client as BlueskyClient).searchPosts(`#${col.query}`);
              for (const p of r.posts) {
                posts.push({
                  uri: p.uri, text: (p.record as any).text ?? '',
                  author: { handle: p.author.handle, displayName: p.author.displayName, avatar: p.author.avatar },
                  createdAt: (p.record as any).createdAt ?? p.indexedAt,
                  platform: 'bluesky', likeCount: p.likeCount, repostCount: p.repostCount, isRepost: false, raw: p,
                });
              }
            } catch {}
          } else {
            const masto = client as MastodonClient;
            const token = masto.getAccessToken();
            if (token) {
              try {
                const resp = await fetch(
                  `${masto.getInstanceUrl()}/api/v1/timelines/tag/${col.query}?limit=40`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                if (resp.ok) {
                  const raw = await resp.json();
                  posts.push(...raw.map((s: any) => normalizePost(s, 'mastodon')));
                }
              } catch {}
            }
          }
        } else if (col.type === 'user' && col.query) {
          // Fetch a specific user's posts
          if (acct.platform === 'bluesky') {
            try {
              const r = await (client as BlueskyClient).getAuthorFeed(col.query);
              posts.push(...r.feed.map(p => normalizePost(p, 'bluesky')));
            } catch {}
          } else {
            try {
              const masto = client as MastodonClient;
              const account = await masto.getAccountByHandle(col.query);
              const statuses = await masto.getAccountStatuses(account.id);
              posts.push(...statuses.map(s => normalizePost(s, 'mastodon')));
            } catch {}
          }
        }
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
    for (const [id, client] of clients) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== post.platform) continue;
      try {
        if (post.platform === 'bluesky') {
          const raw = post.raw as any;
          await (client as BlueskyClient).like(raw.post?.uri ?? raw.uri, raw.post?.cid ?? raw.cid);
        } else {
          const raw = post.raw as any;
          await (client as MastodonClient).favourite(raw.id);
        }
        return;
      } catch (e) { console.error('Like failed:', e); }
    }
  }

  async function handleBoost(post: UnifiedPost) {
    for (const [id, client] of clients) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== post.platform) continue;
      try {
        if (post.platform === 'bluesky') {
          const raw = post.raw as any;
          await (client as BlueskyClient).repost(raw.post?.uri ?? raw.uri, raw.post?.cid ?? raw.cid);
        } else {
          const raw = post.raw as any;
          await (client as MastodonClient).reblog(raw.id);
        }
        return;
      } catch (e) { console.error('Boost failed:', e); }
    }
  }
</script>

<div class="h-full flex flex-col">
  <!-- Deck header -->
  <div class="flex items-center justify-between px-4 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex-shrink-0">
    <div class="flex items-center gap-2">
      <Columns3 size={20} />
      <h1 class="text-lg font-bold">Deck</h1>
      <span class="text-xs text-[var(--color-text-muted)]">{columns.length} columns</span>
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

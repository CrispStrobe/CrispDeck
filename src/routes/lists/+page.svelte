<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { List, Plus, Loader2, Trash2, Rss } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost, sortPosts } from '$lib/api/unified';
  import { getMastodonLists, createMastodonList } from '$lib/list-management';
  import Post from '$lib/components/Post.svelte';
  import { tryLoad, tryAction } from '$lib/page-error';
  import type { Account, UnifiedPost } from '$lib/types';
  import { getCached, setCache } from '$lib/view-cache';

  interface MastoList { id: string; title: string; repliesPolicy: string }
  interface BskyFeed { uri: string; displayName: string; description?: string; avatar?: string; likeCount?: number; creator: { handle: string } }
  interface BskyList { uri: string; cid: string; name: string; purpose: string; description?: string; avatar?: string; creator: { handle: string; displayName?: string }; listItemCount?: number }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let mastoLists: MastoList[] = $state([]);
  let bskyFeeds: BskyFeed[] = $state([]);
  let bskyLists: BskyList[] = $state([]);
  let selectedList: { type: 'mastodon'; id: string; title: string } | { type: 'bluesky'; uri: string; title: string } | null = $state(null);
  let listPosts: UnifiedPost[] = $state([]);
  let loadingPosts = $state(false);

  let clientEntries: Map<number, ClientEntry> = new Map();

  // Create list form
  let showCreateForm = $state(false);
  let newListTitle = $state('');

  // Feed search
  let feedSearch = $state('');
  let feedSearchResults: BskyFeed[] = $state([]);
  let searchingFeeds = $state(false);

  onMount(async () => {
    // Show cached lists instantly
    const cached = getCached<{ mastoLists: any[]; bskyFeeds: any[]; bskyLists: any[] }>('lists');
    if (cached) {
      mastoLists = cached.data.mastoLists;
      bskyFeeds = cached.data.bskyFeeds;
      bskyLists = cached.data.bskyLists;
      loading = false;
    }

    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      await loadLists();
      setCache('lists', { mastoLists, bskyFeeds, bskyLists });
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function loadLists() {
    await Promise.allSettled(Array.from(clientEntries).map(async ([id, entry]) => {
      const client = entry.client;
      const acct = accounts.find(a => a.id === id);
      if (!acct) return;

      if (acct.platform === 'mastodon') {
        const masto = client as MastodonClient;
        const token = masto.getAccessToken();
        if (token) {
          mastoLists = await getMastodonLists(masto.getInstanceUrl(), token) as MastoList[];
        }
      } else {
        const agent = entry.oauthAgent ?? (client as BlueskyClient).getAgent();
        const [feedResp, listResp] = await Promise.all([
          agent.api.app.bsky.feed.getSuggestedFeeds({ limit: 20 }),
          agent.api.app.bsky.graph.getLists({ actor: acct.handle, limit: 50 }),
        ]);
        bskyFeeds = (feedResp.data.feeds ?? []) as unknown as BskyFeed[];
        bskyLists = (listResp.data.lists ?? []) as unknown as BskyList[];
      }
    }));
  }

  async function selectMastoList(list: MastoList) {
    selectedList = { type: 'mastodon', id: list.id, title: list.title };
    loadingPosts = true;
    listPosts = [];
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== 'mastodon') continue;
      const masto = entry.client as MastodonClient;
      const token = masto.getAccessToken();
      if (!token) continue;
      try {
        const resp = await fetch(`${masto.getInstanceUrl()}/api/v1/timelines/list/${list.id}?limit=40`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const raw = await resp.json();
          listPosts = sortPosts(raw.map((s: any) => normalizePost(s, 'mastodon')), 'newest');
        }
      } catch (e) { console.error('Failed to load Mastodon list:', e); }
      break;
    }
    loadingPosts = false;
  }

  async function selectBskyFeed(feed: BskyFeed) {
    selectedList = { type: 'bluesky', uri: feed.uri, title: feed.displayName };
    loadingPosts = true;
    listPosts = [];
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== 'bluesky') continue;
      try {
        const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
        const resp = await agent.api.app.bsky.feed.getFeed({ feed: feed.uri, limit: 50 });
        listPosts = sortPosts(resp.data.feed.map(p => normalizePost(p, 'bluesky')), 'newest');
      } catch (e) { console.error('Failed to load Bluesky feed:', e); }
      break;
    }
    loadingPosts = false;
  }

  async function selectBskyList(list: BskyList) {
    selectedList = { type: 'bluesky', uri: list.uri, title: list.name };
    loadingPosts = true;
    listPosts = [];
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== 'bluesky') continue;
      try {
        const agent = entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
        const resp = await agent.api.app.bsky.feed.getListFeed({ list: list.uri, limit: 50 });
        listPosts = sortPosts(resp.data.feed.map(p => normalizePost(p, 'bluesky')), 'newest');
      } catch (e) { console.error('Failed to load Bluesky list feed:', e); }
      break;
    }
    loadingPosts = false;
  }

  async function searchFeeds() {
    if (!feedSearch.trim()) { feedSearchResults = []; return; }
    searchingFeeds = true;
    try {
      const resp = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.unspecced.getPopularFeedGenerators?query=${encodeURIComponent(feedSearch)}&limit=20`
      );
      if (resp.ok) {
        const data = await resp.json();
        feedSearchResults = (data.feeds ?? []) as unknown as BskyFeed[];
      }
    } catch (e) { console.error('Feed search failed:', e); }
    searchingFeeds = false;
  }

  async function createMastoList() {
    if (!newListTitle.trim()) return;
    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform !== 'mastodon') continue;
      const masto = entry.client as MastodonClient;
      const token = masto.getAccessToken();
      if (!token) continue;
      try {
        await createMastodonList(masto.getInstanceUrl(), token, newListTitle.trim());
        newListTitle = '';
        showCreateForm = false;
        await loadLists();
      } catch (e) { error = String(e); }
      break;
    }
  }
</script>

<svelte:head><title>CrispDeck — Lists &amp; Feeds</title></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center gap-2 mb-4">
    <List size={24} />
    <h1 class="text-2xl font-bold">Lists & Feeds</h1>
  </div>

  <!-- Sub-navigation tabs -->
  <div class="flex items-center gap-1 mb-4">
    <a href="/lists" class="px-4 py-2 text-sm font-medium border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">Lists</a>
    <a href="/starterpacks" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Starter Packs</a>
    <a href="/feed-builder" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Feed Builder</a>
  </div>

  <div class="flex items-center justify-between mb-6">
    <div></div>
    <button onclick={() => showCreateForm = !showCreateForm} class="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-primary)] text-white rounded-md">
      <Plus size={14} /> New List
    </button>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if showCreateForm}
    <div class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div class="flex items-center gap-2">
        <input type="text" bind:value={newListTitle} placeholder="List name..." class="flex-1 px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)]" />
        <button onclick={createMastoList} class="px-3 py-2 bg-[var(--color-mastodon)] text-white text-sm rounded-md">Create (Mastodon)</button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Sidebar: list of lists -->
      <div class="space-y-4">
        {#if mastoLists.length > 0}
          <div>
            <h3 class="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-2 flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-[var(--color-mastodon)]"></span> Mastodon Lists
            </h3>
            {#each mastoLists as list}
              <button onclick={() => selectMastoList(list)} class="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-[var(--color-surface-hover)] transition-colors {selectedList?.type === 'mastodon' && selectedList?.id === list.id ? 'bg-[var(--color-surface)] border border-[var(--color-border)]' : ''}">
                {list.title}
              </button>
            {/each}
          </div>
        {/if}
        {#if bskyLists.length > 0}
          <div>
            <h3 class="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-2 flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-[var(--color-bluesky)]"></span> Bluesky Lists
            </h3>
            {#each bskyLists as list}
              <button onclick={() => selectBskyList(list)} class="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-2 {selectedList?.type === 'bluesky' && selectedList?.uri === list.uri ? 'bg-[var(--color-surface)] border border-[var(--color-border)]' : ''}">
                {#if list.avatar}<img loading="lazy" src={list.avatar} alt="" class="w-5 h-5 rounded" />{/if}
                <div class="truncate">
                  <span class="truncate">{list.name}</span>
                  {#if list.listItemCount}<span class="text-[10px] text-[var(--color-text-muted)] ml-1">({list.listItemCount})</span>{/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
        {#if bskyFeeds.length > 0}
          <div>
            <h3 class="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-2 flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-[var(--color-bluesky)]"></span> Bluesky Feeds
            </h3>
            <!-- Feed search -->
            <form onsubmit={(e) => { e.preventDefault(); searchFeeds(); }} class="mb-2">
              <input type="text" bind:value={feedSearch} oninput={() => { if (!feedSearch.trim()) feedSearchResults = []; }} placeholder="Search feeds..." class="w-full px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] focus:outline-none" />
            </form>
            {#if feedSearchResults.length > 0}
              <div class="mb-2 border-b border-[var(--color-border)] pb-2">
                {#each feedSearchResults as feed}
                  <button onclick={() => selectBskyFeed(feed)} class="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-2">
                    {#if feed.avatar}<img loading="lazy" src={feed.avatar} alt="" class="w-4 h-4 rounded" />{/if}
                    <span class="truncate">{feed.displayName}</span>
                  </button>
                {/each}
              </div>
            {/if}
            {#each bskyFeeds as feed}
              <button onclick={() => selectBskyFeed(feed)} class="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-2 {selectedList?.type === 'bluesky' && selectedList?.uri === feed.uri ? 'bg-[var(--color-surface)] border border-[var(--color-border)]' : ''}">
                {#if feed.avatar}<img loading="lazy" src={feed.avatar} alt="" class="w-5 h-5 rounded" />{/if}
                <span class="truncate">{feed.displayName}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Main: list timeline -->
      <div class="lg:col-span-2">
        {#if selectedList}
          <h2 class="text-lg font-semibold mb-3">{selectedList.title}</h2>
          {#if loadingPosts}
            <div class="text-center py-8"><Loader2 size={24} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
          {:else if listPosts.length === 0}
            <p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No posts in this list.</p>
          {:else}
            <div class="space-y-3">
              {#each listPosts as post (post.uri)}
                <Post {post} />
              {/each}
            </div>
          {/if}
        {:else}
          <div class="text-center py-12 text-[var(--color-text-muted)]">
            <Rss size={48} class="mx-auto mb-4 opacity-50" />
            <p class="text-sm">Select a list or feed to view its timeline.</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

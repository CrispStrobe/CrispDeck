<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Search, Loader2, Inbox, HelpCircle, Image, User, Calendar, Bookmark, BookmarkCheck, X } from '@lucide/svelte';
  import { listSavedSearches, saveSearch, deleteSavedSearch, isSaved, type SavedSearch } from '$lib/saved-searches';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { ThreadsClient } from '$lib/api/threads';
  import { normalizePost } from '$lib/api/unified';
  import { searchMastodon, searchThreads, mergeSearchResults } from '$lib/universal-search';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account, Platform } from '$lib/types';

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let searching = $state(false);
  let error = $state('');
  let query = $state('');
  let results: UnifiedPost[] = $state([]);
  let hasSearched = $state(false);

  let showSearchHelp = $state(false);
  let savedSearches: SavedSearch[] = $state([]);
  let showSavedMenu = $state(false);
  let clientEntries: Map<number, ClientEntry> = new Map();

  function refreshSavedSearches() {
    savedSearches = listSavedSearches();
  }

  function handleSaveSearch() {
    if (!query.trim()) return;
    saveSearch(query.trim());
    refreshSavedSearches();
  }

  function handleLoadSavedSearch(q: string) {
    query = q;
    showSavedMenu = false;
    handleSearch();
  }

  function handleDeleteSavedSearch(id: string) {
    deleteSavedSearch(id);
    refreshSavedSearches();
  }

  function appendOperator(op: string) {
    query = (query.trim() + ' ' + op).trim();
  }

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      // Auto-search from URL params (e.g. /search?q=%23hashtag)
      const params = new URLSearchParams(window.location.search);
      const q = params.get('q');
      if (q) {
        query = q;
        await handleSearch();
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      refreshSavedSearches();
    }
  });

  async function handleSearch() {
    if (!query.trim()) return;
    searching = true;
    error = '';
    results = [];
    hasSearched = true;

    const resultsByPlatform = new Map<Platform, UnifiedPost[]>();
    const q = query.trim();

    const searchResults = await Promise.allSettled(accounts.map(async (acct) => {
      const entry = clientEntries.get(acct.id);
      if (!entry) return { platform: acct.platform, posts: [] as UnifiedPost[] };

      if (acct.platform === 'bluesky') {
        const bsky = entry.client as BlueskyClient;
        const resp = await bsky.searchPosts(q);
        return { platform: acct.platform, posts: resp.posts.map(post => ({
          uri: post.uri,
          text: (post.record as any).text ?? '',
          author: {
            handle: post.author.handle,
            displayName: post.author.displayName,
            avatar: post.author.avatar,
          },
          createdAt: (post.record as any).createdAt ?? post.indexedAt,
          platform: 'bluesky' as const,
          replyCount: post.replyCount,
          repostCount: post.repostCount,
          likeCount: post.likeCount,
          isRepost: false,
          embeds: post.embed,
          raw: post,
        })) };
      } else if (acct.platform === 'mastodon') {
        const masto = entry.client as MastodonClient;
        const token = masto.getAccessToken();
        if (!token) return { platform: acct.platform, posts: [] };
        const statuses = await searchMastodon(q, masto.getInstanceUrl(), token, 40);
        return { platform: acct.platform, posts: statuses.map((s: any) => normalizePost(s, 'mastodon')) };
      } else if (acct.platform === 'threads') {
        const threads = entry.client as ThreadsClient;
        const token = threads.getAccessToken?.();
        if (!token) return { platform: acct.platform, posts: [] };
        const threadsPosts = await searchThreads(q, token, 25);
        return { platform: acct.platform, posts: threadsPosts.map((p: any) => threads.normalizePost(p)) };
      }
      return { platform: acct.platform, posts: [] as UnifiedPost[] };
    }));

    for (const result of searchResults) {
      if (result.status === 'fulfilled' && result.value.posts.length > 0) {
        const p = result.value.platform;
        resultsByPlatform.set(p, [...(resultsByPlatform.get(p) ?? []), ...result.value.posts]);
      }
    }

    // Merge with engagement/recency scoring and URI dedup
    const merged = mergeSearchResults(resultsByPlatform);
    results = merged.posts;
    searching = false;
  }
</script>

<svelte:head><title>CrispDeck — Search</title><meta name="description" content="Search posts across all connected accounts" /></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Search size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.search.title}</h1>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  <!-- Search bar -->
  <form onsubmit={(e) => { e.preventDefault(); handleSearch(); }} class="mb-6">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={query}
        placeholder={i18n.t.search.placeholder}
        class="flex-1 px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]"
      />
      <button
        type="submit"
        disabled={searching || !query.trim() || accounts.length === 0}
        class="flex items-center gap-2 px-5 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
      >
        {#if searching}<Loader2 size={14} class="animate-spin" />{:else}<Search size={14} />{/if}
        {i18n.t.search.button}
      </button>
    </div>
    {#if accounts.length > 0}
      <p class="text-xs text-[var(--color-text-muted)] mt-2">
        Searching across {accounts.length} connected account{accounts.length > 1 ? 's' : ''} ({accounts.map(a => i18n.t.common[a.platform] ?? a.platform).join(', ')})
      </p>
    {/if}

    <!-- Quick filters + search help -->
    <div class="flex items-center gap-2 mt-2 flex-wrap">
      <button onclick={() => appendOperator('has:media')} class="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors">
        <Image size={10} /> Has media
      </button>
      <button onclick={() => { const me = accounts[0]?.handle; if (me) appendOperator(`from:${me}`); }} class="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors">
        <User size={10} /> From me
      </button>
      <button onclick={() => { const d = new Date(); d.setDate(d.getDate() - 7); appendOperator(`since:${d.toISOString().split('T')[0]}`); }} class="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors">
        <Calendar size={10} /> Past week
      </button>
      <button onclick={() => showSearchHelp = !showSearchHelp} class="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
        <HelpCircle size={10} /> Search syntax
      </button>
      <!-- Save search button -->
      {#if query.trim()}
        <button
          onclick={handleSaveSearch}
          class="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md transition-colors {isSaved(query.trim()) ? 'text-[var(--color-primary)] border-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)]'}"
        >
          {#if isSaved(query.trim())}<BookmarkCheck size={10} /> Saved{:else}<Bookmark size={10} /> Save search{/if}
        </button>
      {/if}
      <!-- Saved searches dropdown -->
      {#if savedSearches.length > 0}
        <div class="relative ml-auto">
          <button
            onclick={() => showSavedMenu = !showSavedMenu}
            class="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <Bookmark size={10} /> Saved ({savedSearches.length})
          </button>
          {#if showSavedMenu}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="fixed inset-0 z-40" onclick={() => showSavedMenu = false} onkeydown={() => {}}></div>
            <div class="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 py-1 min-w-[200px] max-h-48 overflow-y-auto">
              {#each savedSearches as s}
                <div class="flex items-center justify-between px-3 py-1.5 hover:bg-[var(--color-surface-hover)]">
                  <button onclick={() => handleLoadSavedSearch(s.query)} class="flex-1 text-left text-xs truncate">{s.query}</button>
                  <button onclick={() => handleDeleteSavedSearch(s.id)} class="ml-2 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                    <X size={10} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if showSearchHelp}
      <div class="mt-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-xs space-y-2">
        <div>
          <span class="font-medium text-[var(--color-bluesky)]">Bluesky</span>
          <div class="text-[var(--color-text-muted)] mt-1 space-y-0.5">
            <p><code class="bg-[var(--color-bg)] px-1 rounded">from:handle.bsky.social</code> — posts by a user</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">since:2026-01-01</code> — posts after date</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">until:2026-12-31</code> — posts before date</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">lang:en</code> — filter by language</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">has:media</code> — posts with images/video</p>
          </div>
        </div>
        <div>
          <span class="font-medium text-[var(--color-mastodon)]">Mastodon</span>
          <div class="text-[var(--color-text-muted)] mt-1 space-y-0.5">
            <p><code class="bg-[var(--color-bg)] px-1 rounded">from:@user@instance</code> — posts by a user</p>
            <p><code class="bg-[var(--color-bg)] px-1 rounded">#hashtag</code> — posts with hashtag</p>
            <p>Full-text search depends on server indexing</p>
          </div>
        </div>
        <div>
          <span class="font-medium" style="color: var(--color-threads, #666)">Threads</span>
          <div class="text-[var(--color-text-muted)] mt-1 space-y-0.5">
            <p>Plain keyword search only (no operators)</p>
            <p>Requires <code class="bg-[var(--color-bg)] px-1 rounded">threads_keyword_search</code> permission</p>
          </div>
        </div>
      </div>
    {/if}
  </form>

  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else if searching}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
      <p class="text-sm text-[var(--color-text-muted)] mt-2">{i18n.t.search.searching}</p>
    </div>
  {:else if hasSearched && results.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Inbox size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.search.noResults}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.search.noPostsFor.replace('{query}', query)}</p>
    </div>
  {:else if results.length > 0}
    <p class="text-sm text-[var(--color-text-muted)] mb-4">{results.length} results (ranked by engagement + recency)</p>
    <div class="space-y-3">
      {#each results as post (post.uri)}
        <Post {post} />
      {/each}
    </div>
  {:else if accounts.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Search size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.search.noAccounts}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">Add accounts in <a href="/settings" class="text-[var(--color-primary)] underline">Settings</a> to search.</p>
    </div>
  {:else}
    <!-- Pre-search suggestions -->
    <div class="text-center py-12">
      <Search size={40} class="text-[var(--color-text-muted)]/40 mx-auto mb-4" />
      <h3 class="text-base font-medium text-[var(--color-text-muted)] mb-3">Search across all your networks</h3>
      <div class="flex flex-wrap justify-center gap-2 max-w-md mx-auto">
        {#each ['#news', '#photography', '#tech', '#fediverse', '#art'] as tag}
          <button
            onclick={() => { query = tag; handleSearch(); }}
            class="px-3 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)]/50 transition-colors"
          >{tag}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>
